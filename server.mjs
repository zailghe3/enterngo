import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseRequestBody, translateText, extractTextFromHtml } from './src/translator.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const publicDir = join(__dirname, 'public');

const PORT = Number.parseInt(process.env.PORT || '3000', 10);
const TARGET_URL = 'https://chat.intern-ai.org.cn/internthinker/go-game/';
const ALLOWED_FETCH_ORIGINS = new Set(['https://chat.intern-ai.org.cn']);

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8'
};

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  res.end(JSON.stringify(payload));
}

function sendMethodNotAllowed(res) {
  sendJson(res, 405, { error: 'Method not allowed' });
}

function getProviderStatus() {
  return {
    targetUrl: TARGET_URL,
    serverFetchAuthConfigured: Boolean(process.env.TARGET_SESSION_COOKIE),
    googleTranslateConfigured: true,
    libreTranslateConfigured: Boolean(process.env.LIBRETRANSLATE_URL),
    openAiCompatibleConfigured: Boolean(process.env.TRANSLATION_API_URL && process.env.TRANSLATION_API_KEY),
    openXLabCredentialsConfigured: Boolean(process.env.OPENXLAB_AK && process.env.OPENXLAB_SK)
  };
}

async function handleTranslate(req, res) {
  if (req.method !== 'POST') {
    sendMethodNotAllowed(res);
    return;
  }

  try {
    const body = await parseRequestBody(req);
    const result = await translateText({
      text: body.text,
      targetLanguage: body.targetLanguage || 'English',
      provider: body.provider || 'auto',
      sourceLanguage: body.sourceLanguage || 'auto',
      fetchImpl: fetch,
      env: process.env
    });
    sendJson(res, 200, result);
  } catch (error) {
    sendJson(res, error.statusCode || 500, { error: error.message || 'Unable to translate text' });
  }
}

async function handleFetchPage(req, res) {
  if (req.method !== 'GET') {
    sendMethodNotAllowed(res);
    return;
  }

  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  const target = new URL(requestUrl.searchParams.get('url') || TARGET_URL);

  if (!ALLOWED_FETCH_ORIGINS.has(target.origin)) {
    sendJson(res, 400, { error: `Fetching is restricted to ${[...ALLOWED_FETCH_ORIGINS].join(', ')}` });
    return;
  }

  const headers = {
    'user-agent': 'enterngo-translator/0.1 (+https://github.com/)'
  };

  if (process.env.TARGET_SESSION_COOKIE) {
    headers.cookie = process.env.TARGET_SESSION_COOKIE;
  }

  try {
    const response = await fetch(target, { headers, redirect: 'follow' });
    const html = await response.text();
    sendJson(res, response.ok ? 200 : response.status, {
      url: target.toString(),
      status: response.status,
      ok: response.ok,
      authenticated: Boolean(process.env.TARGET_SESSION_COOKIE),
      extractedText: extractTextFromHtml(html),
      htmlLength: html.length
    });
  } catch (error) {
    sendJson(res, 502, { error: `Unable to fetch target app: ${error.message}` });
  }
}

async function serveStatic(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  const decodedPath = decodeURIComponent(requestUrl.pathname);
  const safePath = normalize(decodedPath).replace(/^\.\.(?:[/\\]|$)/, '');
  const relativePath = safePath === '/' ? '/index.html' : safePath;
  const filePath = join(publicDir, relativePath);

  if (!filePath.startsWith(publicDir)) {
    sendJson(res, 403, { error: 'Forbidden' });
    return;
  }

  try {
    const file = await readFile(filePath);
    res.writeHead(200, {
      'content-type': contentTypes[extname(filePath)] || 'application/octet-stream',
      'cache-control': 'no-cache'
    });
    res.end(file);
  } catch {
    const fallback = await readFile(join(publicDir, 'index.html'));
    res.writeHead(200, { 'content-type': contentTypes['.html'], 'cache-control': 'no-cache' });
    res.end(fallback);
  }
}

const server = createServer(async (req, res) => {
  if (req.url.startsWith('/api/config')) {
    sendJson(res, 200, getProviderStatus());
    return;
  }

  if (req.url.startsWith('/api/translate')) {
    await handleTranslate(req, res);
    return;
  }

  if (req.url.startsWith('/api/fetch-page')) {
    await handleFetchPage(req, res);
    return;
  }

  await serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`EnterNGo translator running at http://localhost:${PORT}`);
});
