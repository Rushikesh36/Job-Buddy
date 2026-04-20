import { getJobCacheKey } from './scan-cache';
import type { ProcessedJobRegistry, ProcessedJobRegistryEntry, RawJobListing, ScoredJob } from '../types/scanner';

const PROCESSED_REGISTRY_KEY = 'nuworksProcessedJobRegistry';

function createEmptyRegistry(): ProcessedJobRegistry {
  return {
    version: 1,
    lastUpdated: new Date().toISOString(),
    entries: {},
  };
}

function loadRawRegistry(): Promise<ProcessedJobRegistry> {
  return new Promise((resolve) => {
    chrome.storage.local.get([PROCESSED_REGISTRY_KEY], (result) => {
      const stored = result[PROCESSED_REGISTRY_KEY] as ProcessedJobRegistry | undefined;
      if (!stored || typeof stored !== 'object' || stored.version !== 1 || !stored.entries) {
        resolve(createEmptyRegistry());
        return;
      }
      resolve(stored);
    });
  });
}

function saveRawRegistry(registry: ProcessedJobRegistry): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [PROCESSED_REGISTRY_KEY]: registry }, () => resolve());
  });
}

function upsertEntry(
  entries: Record<string, ProcessedJobRegistryEntry>,
  job: RawJobListing,
  nowIso: string
): ProcessedJobRegistryEntry | null {
  const jobKey = getJobCacheKey(job);
  if (!jobKey) return null;

  const existing = entries[jobKey];
  const next: ProcessedJobRegistryEntry = {
    jobKey,
    title: job.title || existing?.title || 'Untitled',
    company: job.company || existing?.company || 'Unknown',
    jobId: job.jobId || existing?.jobId,
    detailUrl: job.detailUrl || existing?.detailUrl,
    scannedAt: existing?.scannedAt || nowIso,
    lastSeenAt: nowIso,
    scoredAt: existing?.scoredAt,
    shortlistedAt: existing?.shortlistedAt,
  };

  entries[jobKey] = next;
  return next;
}

export async function loadProcessedJobRegistry(): Promise<ProcessedJobRegistry> {
  return loadRawRegistry();
}

export async function markJobsScanned(jobs: RawJobListing[]): Promise<void> {
  if (jobs.length === 0) return;

  const nowIso = new Date().toISOString();
  const registry = await loadRawRegistry();

  for (const job of jobs) {
    upsertEntry(registry.entries, job, nowIso);
  }

  registry.lastUpdated = nowIso;
  await saveRawRegistry(registry);
}

export async function markJobsShortlisted(jobs: Array<RawJobListing | ScoredJob>): Promise<void> {
  if (jobs.length === 0) return;

  const nowIso = new Date().toISOString();
  const registry = await loadRawRegistry();

  for (const job of jobs) {
    const entry = upsertEntry(registry.entries, job, nowIso);
    if (!entry) continue;
    entry.scoredAt = nowIso;
    entry.shortlistedAt = nowIso;
  }

  registry.lastUpdated = nowIso;
  await saveRawRegistry(registry);
}

export async function filterOutFullyProcessedJobs(jobs: RawJobListing[]): Promise<{ jobs: RawJobListing[]; skippedCount: number }> {
  if (jobs.length === 0) {
    return { jobs, skippedCount: 0 };
  }

  const registry = await loadRawRegistry();
  let skippedCount = 0;

  const pending = jobs.filter((job) => {
    const jobKey = getJobCacheKey(job);
    if (!jobKey) return true;
    const entry = registry.entries[jobKey];
    const fullyProcessed = Boolean(entry?.scoredAt && entry?.shortlistedAt);
    if (fullyProcessed) {
      skippedCount += 1;
      return false;
    }
    return true;
  });

  return {
    jobs: pending,
    skippedCount,
  };
}
