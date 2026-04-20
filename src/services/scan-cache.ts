import type { RawJobListing, ScanCache } from '../types/scanner';

const SCAN_CACHE_KEY = 'nuworksScanCache';

export function getJobCacheKey(job: RawJobListing): string {
  return job.jobId || job.detailUrl || `${job.title}::${job.company}`;
}

export async function loadScanCache(): Promise<ScanCache | null> {
  return new Promise((resolve) => {
    chrome.storage.local.get([SCAN_CACHE_KEY], (result) => {
      resolve((result[SCAN_CACHE_KEY] as ScanCache) ?? null);
    });
  });
}

export async function saveScanCache(cache: ScanCache): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [SCAN_CACHE_KEY]: cache }, () => resolve());
  });
}

export function markJobsByCache(jobs: RawJobListing[], previousCache: ScanCache | null): { allJobs: RawJobListing[]; newCount: number } {
  const seen = new Set(previousCache?.jobsSeen ?? []);
  let newCount = 0;

  const allJobs = jobs.map((job) => {
    const key = getJobCacheKey(job);
    const isNew = key ? !seen.has(key) : false;
    if (isNew) newCount += 1;
    return { ...job, isNew };
  });

  return { allJobs, newCount };
}

export function buildScanCache(lastScanUrl: string, jobs: RawJobListing[]): ScanCache {
  const normalizedJobs = jobs.map((job) => ({ ...job, isNew: false }));
  const jobsSeen = normalizedJobs.map(getJobCacheKey).filter(Boolean);

  return {
    lastScanDate: new Date().toISOString(),
    lastScanUrl,
    jobsSeen,
    results: normalizedJobs,
  };
}
