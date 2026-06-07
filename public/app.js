const sourceText = document.querySelector('#sourceText');
const translationOutput = document.querySelector('#translationOutput');
const translateButton = document.querySelector('#translateButton');
const fetchPageButton = document.querySelector('#fetchPageButton');
const providerSelect = document.querySelector('#providerSelect');
const statusList = document.querySelector('#statusList');

function renderStatus(config) {
  const items = [
    ['Target app', config.targetUrl],
    ['Authenticated fetch', config.serverFetchAuthConfigured ? 'Configured' : 'Needs TARGET_SESSION_COOKIE'],
    ['OpenAI-compatible translation', config.openAiCompatibleConfigured ? 'Configured' : 'Needs API URL + key'],
    ['LibreTranslate', config.libreTranslateConfigured ? 'Configured' : 'Needs LibreTranslate URL'],
    ['OpenXLab keys', config.openXLabCredentialsConfigured ? 'Configured' : 'Optional / not wired yet']
  ];

  statusList.innerHTML = items
    .map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`)
    .join('');
}

async function loadConfig() {
  const response = await fetch('/api/config');
  renderStatus(await response.json());
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || `Request failed with HTTP ${response.status}`);
  }

  return data;
}

translateButton.addEventListener('click', async () => {
  translateButton.disabled = true;
  translationOutput.textContent = 'Translating…';

  try {
    const result = await postJson('/api/translate', {
      text: sourceText.value,
      provider: providerSelect.value,
      targetLanguage: 'English'
    });

    translationOutput.textContent = result.warning
      ? `${result.translatedText}\n\n⚠ ${result.warning}`
      : result.translatedText;
  } catch (error) {
    translationOutput.textContent = `Unable to translate: ${error.message}`;
  } finally {
    translateButton.disabled = false;
  }
});

fetchPageButton.addEventListener('click', async () => {
  fetchPageButton.disabled = true;

  try {
    const response = await fetch('/api/fetch-page');
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || `Fetch failed with HTTP ${response.status}`);
    }

    sourceText.value = data.extractedText || `Fetched ${data.htmlLength} bytes, but no text could be extracted.`;
  } catch (error) {
    sourceText.value = `Unable to fetch target page text. ${error.message}\n\nOpen the Go app manually and paste the thinking text here.`;
  } finally {
    fetchPageButton.disabled = false;
  }
});

loadConfig().catch((error) => {
  statusList.innerHTML = `<div><dt>Status</dt><dd>Unable to load config: ${error.message}</dd></div>`;
});
