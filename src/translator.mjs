const MAX_TEXT_LENGTH = 12000;

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
    warning: 'No translation provider is configured yet. Set TRANSLATION_API_URL plus TRANSLATION_API_KEY, or LIBRETRANSLATE_URL, to enable automatic English translation.'
  };
}
