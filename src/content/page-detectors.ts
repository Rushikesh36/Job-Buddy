import {
  type NUworksDetectionResult,
  type NUworksJobListingSignal,
  type NUworksPlatformType,
} from '../types/scanner';

const SCANNER_DEBUG_MODE_STORAGE_KEY = 'scannerDebugMode';

const JOB_LISTING_SELECTORS = [
  'table.list tbody tr',
  '.job-listing-row',
  '[data-job-id]',
  '[class*="job-list"]',
  '[class*="posting"]',
  'table.list',
];

const PAGINATION_SELECTORS = [
  '.pagination',
  '.pager',
  'nav[aria-label*="page"]',
  '[class*="pagination"]',
  '.page-numbers',
];

function countPostingLinks(): number {
  const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'));
  return links.filter((link) => {
    const href = link.href.toLowerCase();
    const text = (link.textContent ?? '').trim();
    return (
      text.length > 5 &&
      text.length < 200 &&
      (href.includes('job') || href.includes('posting') || href.includes('detail') || href.includes('position'))
    );
  }).length;
}

function detectPlatform(url: string, title: string): { platform: NUworksPlatformType; indicators: string[] } {
  const host = window.location.hostname.toLowerCase();
  const normalizedUrl = url.toLowerCase();
  const normalizedTitle = title.toLowerCase();
  const indicators: string[] = [];

  if (host.includes('symplicity.com') || normalizedUrl.includes('northeastern-csm.symplicity.com')) {
    indicators.push('host:symplicity');
    return { platform: 'symplicity', indicators };
  }

  if (host.includes('joinhandshake.com') || normalizedUrl.includes('handshake')) {
    indicators.push('host:handshake');
    return { platform: 'handshake', indicators };
  }

  if (
    normalizedUrl.includes('nuworks.northeastern.edu') ||
    normalizedUrl.includes('nuwks') ||
    normalizedTitle.includes('nuworks')
  ) {
    indicators.push('keyword:nuworks');
    return { platform: 'custom', indicators };
  }

  return { platform: 'unknown', indicators };
}

export function isNUworksPage(): boolean {
  const url = window.location.href.toLowerCase();
  const title = document.title.toLowerCase();

  return (
    url.includes('nuworks.northeastern.edu') ||
    url.includes('northeastern-csm.symplicity.com') ||
    url.includes('nuwks') ||
    title.includes('nuworks')
  );
}

export function collectDomSignals(): NUworksJobListingSignal {
  const hasStructuredList = JOB_LISTING_SELECTORS.some((selector) => Boolean(document.querySelector(selector)));
  const jobLikeElementCount = document.querySelectorAll('[class*="job" i], [class*="posting" i]').length;
  const hasPagination = PAGINATION_SELECTORS.some((selector) => Boolean(document.querySelector(selector)));
  const tableRowCount = document.querySelectorAll('table tbody tr').length;

  return {
    hasStructuredList,
    jobLikeElementCount,
    postingLinkCount: countPostingLinks(),
    hasPagination,
    tableRowCount,
  };
}

export function isJobListingPage(signals = collectDomSignals()): boolean {
  let confidence = 0;

  if (signals.hasStructuredList) confidence += 2;
  if (signals.jobLikeElementCount >= 4) confidence += 1;
  if (signals.postingLinkCount >= 3) confidence += 1;
  if (signals.tableRowCount >= 4) confidence += 1;
  if (signals.hasPagination) confidence += 1;

  return confidence >= 2;
}

async function loadScannerDebugMode(): Promise<boolean> {
  return new Promise((resolve) => {
    chrome.storage.local.get([SCANNER_DEBUG_MODE_STORAGE_KEY], (result) => {
      resolve(Boolean(result[SCANNER_DEBUG_MODE_STORAGE_KEY]));
    });
  });
}

function logDetectionDebug(detection: NUworksDetectionResult): void {
  console.group('[JobBuddy][NUworks] Detection Debug');
  console.log('Result:', detection);
  console.log('Body classes:', document.body?.className ?? '(none)');
  console.log('Top containers sample:',
    Array.from(document.querySelectorAll('main, table, section, [class*="job" i], [class*="posting" i]'))
      .slice(0, 8)
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        id: el.id || '(none)',
        className: (el.className || '(none)').toString(),
      }))
  );
  console.groupEnd();
}

export async function detectNUworksPlatform(): Promise<NUworksDetectionResult> {
  const url = window.location.href;
  const title = document.title;
  const nuworksFlag = isNUworksPage();
  const { platform, indicators } = detectPlatform(url, title);
  const signals = collectDomSignals();

  const result: NUworksDetectionResult = {
    isNUworksPage: nuworksFlag,
    isJobListingPage: isJobListingPage(signals),
    platform,
    indicators,
    signals,
    url,
    title,
    detectedAt: new Date().toISOString(),
  };

  if (!nuworksFlag && platform !== 'unknown') {
    result.indicators.push('platform:non-nuworks-host');
  }

  const debugMode = await loadScannerDebugMode();
  if (debugMode) {
    logDetectionDebug(result);
  }

  return result;
}
