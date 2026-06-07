# EnterNGo

EnterNGo is a small web app for translating the visible reasoning/thinking text from the InternThinker Go player at <https://chat.intern-ai.org.cn/internthinker/go-game/> into English.

## What this MVP does

- Opens a side-by-side translator UI.
- Lets you paste the Go AI's thinking text from the source app.
- Can fetch the target page server-side if you provide an authenticated session cookie.
- Translates through either:
  - an OpenAI-compatible chat-completions endpoint, or
  - a LibreTranslate endpoint.
- Shows a local preview/warning when no translation provider is configured, so the UI remains usable during setup.

## Run locally

```bash
npm start
```

Then open <http://localhost:3000>.

## Configuration

All configuration is optional for local UI development, but real translation needs at least one provider.

### Translation through an OpenAI-compatible endpoint

```bash
TRANSLATION_API_URL="https://your-provider.example/v1/chat/completions" \
TRANSLATION_API_KEY="your-api-key" \
TRANSLATION_MODEL="your-model" \
npm start
```

This works with services that accept OpenAI-style `messages` payloads and return `choices[0].message.content`.

### Translation through LibreTranslate

```bash
LIBRETRANSLATE_URL="https://libretranslate.example" \
LIBRETRANSLATE_API_KEY="optional-key" \
npm start
```

### Authenticated target-page fetch

If the InternThinker Go page requires a login, fetch the page in your browser, copy the relevant session cookie value, and run:

```bash
TARGET_SESSION_COOKIE="name=value; another_name=another_value" npm start
```

The server only allows fetches from `https://chat.intern-ai.org.cn`.

### OpenXLab credentials

If OpenXLab gives you API access that can reach a model endpoint, store those credentials outside the client:

```bash
OPENXLAB_AK="your-access-key" OPENXLAB_SK="your-secret-key" npm start
```

This repo currently exposes whether those credentials are configured, but does not assume a specific OpenXLab SDK route. Once the exact OpenXLab endpoint is confirmed, wire it to `src/translator.mjs` as another server-side provider so secrets never enter browser JavaScript.

## Test

```bash
npm test
npm run lint
```
