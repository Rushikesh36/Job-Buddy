import type { PageContext } from '../lib/types';

const MAX_TEXT_LENGTH = 15000;

function extractPageContext(): PageContext {
  const metaDescEl = document.querySelector<HTMLMetaElement>(
    'meta[name="description"]'
  );
  const metaDescription = metaDescEl?.getAttribute('content') ?? '';

  const rawText = document.body?.innerText ?? '';
  const textContent = rawText.trim().slice(0, MAX_TEXT_LENGTH);

  return {
    url: window.location.href,
    title: document.title,
    metaDescription,
    textContent,
    extractedAt: new Date().toISOString(),
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'GET_PAGE_CONTENT') {
    try {
      const ctx = extractPageContext();
      sendResponse({ success: true, data: ctx });
    } catch (err) {
      sendResponse({
        success: false,
        error: err instanceof Error ? err.message : 'Extraction failed',
      });
    }
    return true; // keep channel open for async sendResponse
  }
});
