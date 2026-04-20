import type { RawJobListing, ScoredJob, NUworksPageExtractionResult } from '../types/scanner';

interface ScannerStatePersistence {
  version: 1;
  scannedJobs: RawJobListing[];
  scoredJobs: ScoredJob[];
  currentPageExtraction: NUworksPageExtractionResult | null;
  savedAt: string;
}

const SCANNER_STATE_KEY = 'nuworksScannerStatePersistence';

export async function loadScannerState(): Promise<{
  scannedJobs: RawJobListing[];
  scoredJobs: ScoredJob[];
  currentPageExtraction: NUworksPageExtractionResult | null;
} | null> {
  return new Promise((resolve) => {
    chrome.storage.local.get([SCANNER_STATE_KEY], (result) => {
      const state = (result[SCANNER_STATE_KEY] as ScannerStatePersistence) ?? null;
      if (!state) {
        resolve(null);
        return;
      }

      resolve({
        scannedJobs: state.scannedJobs ?? [],
        scoredJobs: state.scoredJobs ?? [],
        currentPageExtraction: state.currentPageExtraction ?? null,
      });
    });
  });
}

export async function saveScannerState(
  scannedJobs: RawJobListing[],
  scoredJobs: ScoredJob[],
  currentPageExtraction: NUworksPageExtractionResult | null
): Promise<void> {
  const state: ScannerStatePersistence = {
    version: 1,
    scannedJobs,
    scoredJobs,
    currentPageExtraction,
    savedAt: new Date().toISOString(),
  };

  return new Promise((resolve) => {
    chrome.storage.local.set({ [SCANNER_STATE_KEY]: state }, () => resolve());
  });
}

export async function clearScannerState(): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.remove([SCANNER_STATE_KEY], () => resolve());
  });
}
