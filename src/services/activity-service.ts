export interface ActivityDayBucket {
  date: string;
  applications: number;
  outreach: number;
}

export interface ActivityStore {
  days: ActivityDayBucket[];
}

export interface ActivitySummaryCounts {
  today: number;
  week: number;
  month: number;
  total: number;
}

export interface JobHuntSummary {
  applications: ActivitySummaryCounts;
  outreach: ActivitySummaryCounts;
}

const ACTIVITY_STORE_KEY = 'jobHuntActivityStore';
const SYNC_ACTIVITY_STORE_KEY = 'syncJobHuntActivityStore';
const MAX_DAYS = 730;

const DEFAULT_ACTIVITY_STORE: ActivityStore = {
  days: [],
};

function getStorage<T>(keys: string[]): Promise<Record<string, T>> {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, (result) => resolve(result as Record<string, T>));
  });
}

function setStorage(items: Record<string, unknown>): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set(items, () => resolve());
  });
}

function getSyncStorage<T>(keys: string[]): Promise<Record<string, T>> {
  return new Promise((resolve) => {
    chrome.storage.sync.get(keys, (result) => resolve(result as Record<string, T>));
  });
}

function setSyncStorage(items: Record<string, unknown>): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.sync.set(items, () => resolve());
  });
}

function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getTodayKey(): string {
  return toDateKey(new Date());
}

function startOfWeekKey(date: Date): string {
  const copy = new Date(date);
  const day = copy.getDay();
  copy.setHours(0, 0, 0, 0);
  copy.setDate(copy.getDate() - day);
  return toDateKey(copy);
}

function startOfMonthKey(date: Date): string {
  return toDateKey(new Date(date.getFullYear(), date.getMonth(), 1));
}

function normalizeStore(store: ActivityStore): ActivityStore {
  return {
    days: [...store.days]
      .filter((item) => Boolean(item?.date))
      .map((item) => ({
        date: item.date,
        applications: Math.max(0, Math.floor(item.applications || 0)),
        outreach: Math.max(0, Math.floor(item.outreach || 0)),
      }))
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-MAX_DAYS),
  };
}

export async function loadActivityStore(): Promise<ActivityStore> {
  const result = await getStorage<ActivityStore>([ACTIVITY_STORE_KEY]);
  const localStore = result[ACTIVITY_STORE_KEY];
  if (localStore) return normalizeStore(localStore);

  const syncResult = await getSyncStorage<ActivityStore>([SYNC_ACTIVITY_STORE_KEY]);
  const syncStore = syncResult[SYNC_ACTIVITY_STORE_KEY];
  if (syncStore) {
    const normalized = normalizeStore(syncStore);
    await saveActivityStore(normalized);
    return normalized;
  }

  return { ...DEFAULT_ACTIVITY_STORE };
}

export async function saveActivityStore(store: ActivityStore): Promise<void> {
  const normalized = normalizeStore(store);
  await setStorage({ [ACTIVITY_STORE_KEY]: normalized });
  try {
    await setSyncStorage({ [SYNC_ACTIVITY_STORE_KEY]: normalized });
  } catch {
    // Ignore sync quota/account issues and keep local storage as the fallback.
  }
}

function incrementBucket(store: ActivityStore, field: 'applications' | 'outreach'): ActivityStore {
  const date = getTodayKey();
  const nextDays = [...store.days];
  const index = nextDays.findIndex((item) => item.date === date);

  if (index >= 0) {
    nextDays[index] = {
      ...nextDays[index],
      [field]: nextDays[index][field] + 1,
    };
  } else {
    nextDays.push({
      date,
      applications: field === 'applications' ? 1 : 0,
      outreach: field === 'outreach' ? 1 : 0,
    });
  }

  return normalizeStore({ days: nextDays });
}

export function recordApplication(store: ActivityStore): ActivityStore {
  return incrementBucket(store, 'applications');
}

export function recordOutreach(store: ActivityStore): ActivityStore {
  return incrementBucket(store, 'outreach');
}

function sumBuckets(store: ActivityStore, predicate: (date: string) => boolean, field: 'applications' | 'outreach'): number {
  return store.days
    .filter((item) => predicate(item.date))
    .reduce((acc, item) => acc + item[field], 0);
}

export function buildJobHuntSummary(store: ActivityStore): JobHuntSummary {
  const todayKey = getTodayKey();
  const weekKey = startOfWeekKey(new Date());
  const monthKey = startOfMonthKey(new Date());

  return {
    applications: {
      today: sumBuckets(store, (date) => date === todayKey, 'applications'),
      week: sumBuckets(store, (date) => date >= weekKey, 'applications'),
      month: sumBuckets(store, (date) => date >= monthKey, 'applications'),
      total: sumBuckets(store, () => true, 'applications'),
    },
    outreach: {
      today: sumBuckets(store, (date) => date === todayKey, 'outreach'),
      week: sumBuckets(store, (date) => date >= weekKey, 'outreach'),
      month: sumBuckets(store, (date) => date >= monthKey, 'outreach'),
      total: sumBuckets(store, () => true, 'outreach'),
    },
  };
}
