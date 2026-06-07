const MAX_TEXT_LENGTH = 12000;

const GOOGLE_TRANSLATE_DEFAULT_URL = 'https://translate.googleapis.com';
const GOOGLE_TRANSLATE_CHUNK_LENGTH = 4000;
const LANGUAGE_CODES = new Map([
  ['auto', 'auto'],
  ['chinese', 'zh-CN'],
  ['simplified chinese', 'zh-CN'],
  ['traditional chinese', 'zh-TW'],
  ['english', 'en'],
  ['japanese', 'ja'],
  ['korean', 'ko'],
  ['spanish', 'es'],
  ['french', 'fr'],
  ['german', 'de'],
  ['portuguese', 'pt'],
  ['russian', 'ru']
]);

function resolveGoogleLanguageCode(language, fallback = 'auto') {
  if (typeof language !== 'string' || !language.trim()) {
    return fallback;
  }

  const normalized = language.trim().toLowerCase();
  return LANGUAGE_CODES.get(normalized) || normalized;
}

function chunkText(text, maxLength) {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks = [];
  let remaining = text;

  while (remaining.length > maxLength) {
    const slice = remaining.slice(0, maxLength + 1);
    const breakAt = Math.max(
      slice.lastIndexOf('\n'),
      slice.lastIndexOf('。'),
      slice.lastIndexOf('！'),
      slice.lastIndexOf('？'),
      slice.lastIndexOf('.'),
      slice.lastIndexOf('!'),
      slice.lastIndexOf('?'),
      slice.lastIndexOf(' ')
    );
    const chunkEnd = breakAt > Math.floor(maxLength * 0.5) ? breakAt + 1 : maxLength;
    chunks.push(remaining.slice(0, chunkEnd).trim());
    remaining = remaining.slice(chunkEnd).trim();
  }

  if (remaining) {
    chunks.push(remaining);
  }

  return chunks;
}

function parseGoogleTranslatePayload(payload) {
  if (!Array.isArray(payload?.[0])) {
    return '';
  }

  return payload[0]
    .map((segment) => (Array.isArray(segment) && typeof segment[0] === 'string' ? segment[0] : ''))
    .join('')
    .trim();
}

export async function parseRequestBody(req) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > 256_000) {
      const error = new Error('Request body is too large');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('Request body must be valid JSON');
    error.statusCode = 400;
    throw error;
  }
}

export function normalizeInputText(text) {
  if (typeof text !== 'string') {
    const error = new Error('Text is required');
    error.statusCode = 400;
    throw error;
  }

  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) {
    const error = new Error('Text is required');
    error.statusCode = 400;
    throw error;
  }

  if (normalized.length > MAX_TEXT_LENGTH) {
    const error = new Error(`Text must be ${MAX_TEXT_LENGTH} characters or fewer`);
    error.statusCode = 400;
    throw error;
  }

  return normalized;
}

export function extractTextFromHtml(html) {
  if (typeof html !== 'string') {
    return '';
  }

  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildPrompt(text, targetLanguage) {
  return [
    `Translate the following AI Go player's thinking into ${targetLanguage}.`,
    'Preserve Go terms such as sente, gote, joseki, ko, territory, influence, liberty, and byo-yomi when they are already conventional in English.',
    'Return only the translation.',
    '',
    text
  ].join('\n');
}

async function translateWithGoogleTranslate({ text, sourceLanguage, targetLanguage, fetchImpl, env }) {
  const baseUrl = env.GOOGLE_TRANSLATE_URL || GOOGLE_TRANSLATE_DEFAULT_URL;
  const source = resolveGoogleLanguageCode(sourceLanguage, 'auto');
  const target = resolveGoogleLanguageCode(targetLanguage, 'en');
  const translatedChunks = [];
  const raw = [];

  for (const chunk of chunkText(text, GOOGLE_TRANSLATE_CHUNK_LENGTH)) {
    const url = new URL('/translate_a/single', baseUrl);
    url.searchParams.set('client', 'gtx');
    url.searchParams.set('sl', source);
    url.searchParams.set('tl', target);
    url.searchParams.append('dt', 't');
    url.searchParams.set('q', chunk);

    const response = await fetchImpl(url);

    if (!response.ok) {
      throw new Error(`Google Translate failed with HTTP ${response.status}`);
    }

    const payload = await response.json();
    raw.push(payload);
    translatedChunks.push(parseGoogleTranslatePayload(payload));
  }

  return {
    provider: 'google-translate',
    translatedText: translatedChunks.filter(Boolean).join('\n\n'),
    raw: raw.length === 1 ? raw[0] : raw
  };
}

async function translateWithLibreTranslate({ text, sourceLanguage, targetLanguage, fetchImpl, env }) {
  const baseUrl = env.LIBRETRANSLATE_URL;
  if (!baseUrl) {
    return null;
  }

  const response = await fetchImpl(new URL('/translate', baseUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      q: text,
      source: sourceLanguage === 'auto' ? 'auto' : sourceLanguage,
      target: targetLanguage.toLowerCase().startsWith('en') ? 'en' : targetLanguage,
      format: 'text',
      api_key: env.LIBRETRANSLATE_API_KEY || undefined
    })
  });

  if (!response.ok) {
    throw new Error(`LibreTranslate failed with HTTP ${response.status}`);
  }

  const payload = await response.json();
  return {
    provider: 'libretranslate',
    translatedText: payload.translatedText || '',
    raw: payload
  };
}

async function translateWithOpenAiCompatible({ text, targetLanguage, fetchImpl, env }) {
  if (!env.TRANSLATION_API_URL || !env.TRANSLATION_API_KEY) {
    return null;
  }

  const response = await fetchImpl(env.TRANSLATION_API_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.TRANSLATION_API_KEY}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: env.TRANSLATION_MODEL || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a precise translator specializing in Go/Baduk/Weiqi commentary.' },
        { role: 'user', content: buildPrompt(text, targetLanguage) }
      ],
      temperature: 0.1
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Translation API failed with HTTP ${response.status}: ${errorText.slice(0, 200)}`);
  }

  const payload = await response.json();
  return {
    provider: 'openai-compatible',
    translatedText: payload.choices?.[0]?.message?.content?.trim() || '',
    raw: payload
  };
}

export async function translateText({ text, targetLanguage = 'English', sourceLanguage = 'auto', provider = 'auto', fetchImpl = fetch, env = process.env }) {
  const normalizedText = normalizeInputText(text);
  const providerName = provider.toLowerCase();

  if (providerName === 'google-translate' || providerName === 'google') {
    return translateWithGoogleTranslate({ text: normalizedText, sourceLanguage, targetLanguage, fetchImpl, env });
  }

  if (providerName === 'libretranslate') {
    const result = await translateWithLibreTranslate({ text: normalizedText, sourceLanguage, targetLanguage, fetchImpl, env });
    if (!result) {
      const error = new Error('LIBRETRANSLATE_URL is not configured');
      error.statusCode = 400;
      throw error;
    }
    return result;
  }

  if (providerName === 'openai-compatible') {
    const result = await translateWithOpenAiCompatible({ text: normalizedText, targetLanguage, fetchImpl, env });
    if (!result) {
      const error = new Error('TRANSLATION_API_URL and TRANSLATION_API_KEY are not configured');
      error.statusCode = 400;
      throw error;
    }
    return result;
  }

  const providerErrors = [];

  try {
    return await translateWithGoogleTranslate({ text: normalizedText, sourceLanguage, targetLanguage, fetchImpl, env });
  } catch (error) {
    providerErrors.push(`Google Translate: ${error.message}`);
  }

  const openAiCompatible = await translateWithOpenAiCompatible({ text: normalizedText, targetLanguage, fetchImpl, env });
  if (openAiCompatible) {
    return openAiCompatible;
  }

  const libreTranslate = await translateWithLibreTranslate({ text: normalizedText, sourceLanguage, targetLanguage, fetchImpl, env });
  if (libreTranslate) {
    return libreTranslate;
  }

  return {
    provider: 'local-preview',
    translatedText: normalizedText,
    warning: `Automatic translation is unavailable. ${providerErrors.join('; ') || 'No translation provider could be reached.'}`
  };
}
