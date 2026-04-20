import type { ScoredJob } from '../types/scanner';

const SCANNER_SHORTLIST_KEY = 'nuworksApplyShortlist';

export interface ScannerShortlistCache {
  createdAt: string;
  sourceUrl: string;
  jobs: ScoredJob[];
}

export async function loadScannerShortlist(): Promise<ScannerShortlistCache | null> {
  return new Promise((resolve) => {
    chrome.storage.local.get([SCANNER_SHORTLIST_KEY], (result) => {
      resolve((result[SCANNER_SHORTLIST_KEY] as ScannerShortlistCache) ?? null);
    });
  });
}

export async function saveScannerShortlist(cache: ScannerShortlistCache): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [SCANNER_SHORTLIST_KEY]: cache }, () => resolve());
  });
}

export async function clearScannerShortlist(): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.remove([SCANNER_SHORTLIST_KEY], () => resolve());
  });
}
