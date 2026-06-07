import test from 'node:test';
import assert from 'node:assert/strict';

import { extractTextFromHtml, normalizeInputText, translateText } from '../src/translator.mjs';

test('extractTextFromHtml removes script/style tags and decodes common entities', () => {
  const html = '<main><h1>AI&nbsp;thinking</h1><script>alert(1)</script><style>body{}</style><p>Black &amp; White</p></main>';
  assert.equal(extractTextFromHtml(html), 'AI thinking Black & White');
});

test('normalizeInputText trims and rejects blank text', () => {
  assert.equal(normalizeInputText('  move at Q16\n'), 'move at Q16');
  assert.throws(() => normalizeInputText('   '), /Text is required/);
});

test('translateText returns local preview when no provider is configured', async () => {
  const result = await translateText({
    text: '黑棋应该先手压迫白棋。',
    env: {},
    fetchImpl: async () => {
      throw new Error('fetch should not be called');
    }
  });

  assert.equal(result.provider, 'local-preview');
  assert.match(result.warning, /No translation provider/);
});

test('translateText can call an OpenAI-compatible endpoint', async () => {
  const result = await translateText({
    text: '黑棋应该先手压迫白棋。',
    provider: 'openai-compatible',
    env: {
      TRANSLATION_API_URL: 'https://example.test/v1/chat/completions',
      TRANSLATION_API_KEY: 'test-key',
      TRANSLATION_MODEL: 'test-model'
    },
    fetchImpl: async (url, options) => {
      assert.equal(String(url), 'https://example.test/v1/chat/completions');
      assert.equal(options.method, 'POST');
      assert.equal(options.headers.authorization, 'Bearer test-key');
      const body = JSON.parse(options.body);
      assert.equal(body.model, 'test-model');
      assert.match(body.messages[1].content, /Go player's thinking/);
      return Response.json({ choices: [{ message: { content: 'Black should pressure White in sente.' } }] });
    }
  });

  assert.equal(result.provider, 'openai-compatible');
  assert.equal(result.translatedText, 'Black should pressure White in sente.');
});
