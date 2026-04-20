import type { PageContext } from '../lib/types';
import { detectNUworksPlatform } from './page-detectors';
import type { NUworksEnrichTopJobsPayload } from '../lib/types';
import type { NUworksScanAllPagesPayload } from '../lib/types';
import { extractNUworksJobsFromCurrentPage, scanNUworksAllPages, enrichNUworksTopJobs } from './nuworks-scanner';

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

  if (message?.type === 'NUWORKS_DETECT_PAGE') {
    void detectNUworksPlatform()
      .then((result) => {
        sendResponse({ success: true, data: result });
      })
      .catch((err) => {
        sendResponse({
          success: false,
          error: err instanceof Error ? err.message : 'NUworks detection failed',
        });
      });

    return true;
  }

  if (message?.type === 'NUWORKS_EXTRACT_CURRENT_PAGE') {
    void extractNUworksJobsFromCurrentPage()
      .then((result) => {
        sendResponse({ success: true, data: result });
      })
      .catch((err) => {
        sendResponse({
          success: false,
          error: err instanceof Error ? err.message : 'NUworks extraction failed',
        });
      });

    return true;
  }

  if (message?.type === 'NUWORKS_SCAN_ALL_PAGES') {
    const payload = (message?.payload ?? {}) as NUworksScanAllPagesPayload;
    void scanNUworksAllPages(payload.nativePostedDateFilter)
      .then((result) => {
        sendResponse({ success: true, data: result });
      })
      .catch((err) => {
        sendResponse({
          success: false,
          error: err instanceof Error ? err.message : 'NUworks all-pages scan failed',
        });
      });

    return true;
  }

  if (message?.type === 'NUWORKS_ENRICH_TOP_JOBS') {
    const payload = (message?.payload ?? {}) as NUworksEnrichTopJobsPayload;
    void enrichNUworksTopJobs(payload.jobs ?? [], payload.topN)
      .then((result) => {
        sendResponse({ success: true, data: result });
      })
      .catch((err) => {
        sendResponse({
          success: false,
          error: err instanceof Error ? err.message : 'NUworks job enrichment failed',
        });
      });

    return true;
  }
});
