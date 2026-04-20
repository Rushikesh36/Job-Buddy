import { getValidGoogleAccessToken } from './google-auth';
import { DEFAULT_SHEETS_CONFIG, SHEETS_HEADERS, type JobData, type SheetsConfig } from '../types/job';

const SHEETS_CONFIG_KEY = 'sheetsConfig';
const SHEET_NAME = 'Applications';

interface SpreadsheetDetails {
  sheets?: Array<{
    properties?: {
      title?: string;
    };
  }>;
  spreadsheetUrl?: string;
}

interface ValuesResponse {
  values?: string[][];
}

export type AppliedJobLookup = Record<string, true>;

function normalizeLookupPart(value: string): string {
  return value.trim().toLowerCase();
}

function buildLookupKeys(parts: { jobId?: string; jobUrl?: string; title?: string; company?: string }): string[] {
  const keys: string[] = [];
  const jobId = normalizeLookupPart(parts.jobId ?? '');
  const jobUrl = normalizeLookupPart(parts.jobUrl ?? '');
  const title = normalizeLookupPart(parts.title ?? '');
  const company = normalizeLookupPart(parts.company ?? '');

  if (jobId) keys.push(`id:${jobId}`);
  if (jobUrl && jobUrl !== 'n/a') keys.push(`url:${jobUrl}`);
  if (title && company) keys.push(`tc:${title}::${company}`);

  return keys;
}

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

export function normalizeSpreadsheetId(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';

  const fromUrl = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (fromUrl?.[1]) {
    return fromUrl[1];
  }

  return trimmed;
}

export async function loadSheetsConfig(): Promise<SheetsConfig> {
  const result = await getStorage<SheetsConfig>([SHEETS_CONFIG_KEY]);
  const stored = result[SHEETS_CONFIG_KEY];
  if (!stored) return { ...DEFAULT_SHEETS_CONFIG };

  const dedupedVersions = Array.from(new Set(stored.resumeVersions || DEFAULT_SHEETS_CONFIG.resumeVersions))
    .map((item) => item.trim())
    .filter(Boolean);

  return {
    spreadsheetId: stored.spreadsheetId,
    resumeVersions: dedupedVersions.length ? dedupedVersions : [...DEFAULT_SHEETS_CONFIG.resumeVersions],
  };
}

export async function saveSheetsConfig(config: SheetsConfig): Promise<void> {
  await setStorage({
    [SHEETS_CONFIG_KEY]: {
      spreadsheetId: config.spreadsheetId,
      resumeVersions: Array.from(new Set(config.resumeVersions.map((item) => item.trim()).filter(Boolean))),
    },
  });
}

async function googleFetch<T>(args: {
  accessToken: string;
  url: string;
  method?: 'GET' | 'POST' | 'PUT';
  body?: unknown;
}): Promise<T> {
  const response = await fetch(args.url, {
    method: args.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${args.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: args.body ? JSON.stringify(args.body) : undefined,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown Google API error');
    throw new Error(`Google Sheets API error (${response.status}): ${errorText}`);
  }

  return (await response.json()) as T;
}

async function ensureSheetAndHeaders(accessToken: string, spreadsheetId: string): Promise<void> {
  const details = await googleFetch<SpreadsheetDetails>({
    accessToken,
    url: `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties.title`,
  });

  const hasSheet = (details.sheets || []).some((sheet) => sheet.properties?.title === SHEET_NAME);

  if (!hasSheet) {
    await googleFetch<{ replies: unknown[] }>({
      accessToken,
      url: `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
      method: 'POST',
      body: {
        requests: [
          {
            addSheet: {
              properties: { title: SHEET_NAME },
            },
          },
        ],
      },
    });
  }

  const headerValues = await googleFetch<ValuesResponse>({
    accessToken,
    url: `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(`${SHEET_NAME}!A1:M1`)}`,
  });

  const currentHeaders = headerValues.values?.[0] ?? [];
  const headersMatch = SHEETS_HEADERS.every((header, index) => currentHeaders[index] === header);

  if (!headersMatch) {
    await googleFetch<{ updatedRange: string }>({
      accessToken,
      url: `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(`${SHEET_NAME}!A1:M1`)}?valueInputOption=RAW`,
      method: 'PUT',
      body: {
        values: [Array.from(SHEETS_HEADERS)],
      },
    });
  }
}

export async function createNewSpreadsheet(clientId: string): Promise<{ spreadsheetId: string; spreadsheetUrl: string }> {
  const accessToken = await getValidGoogleAccessToken(clientId);

  const response = await googleFetch<{ spreadsheetId: string; spreadsheetUrl: string }>({
    accessToken,
    url: 'https://sheets.googleapis.com/v4/spreadsheets',
    method: 'POST',
    body: {
      properties: {
        title: `JobBuddy Tracker ${new Date().toISOString().slice(0, 10)}`,
      },
      sheets: [{ properties: { title: SHEET_NAME } }],
    },
  });

  await ensureSheetAndHeaders(accessToken, response.spreadsheetId);

  return {
    spreadsheetId: response.spreadsheetId,
    spreadsheetUrl: response.spreadsheetUrl,
  };
}

export async function createNewSpreadsheetWithSecret(args: {
  clientId: string;
  clientSecret?: string;
}): Promise<{ spreadsheetId: string; spreadsheetUrl: string }> {
  const accessToken = await getValidGoogleAccessToken(args.clientId, args.clientSecret);

  const response = await googleFetch<{ spreadsheetId: string; spreadsheetUrl: string }>({
    accessToken,
    url: 'https://sheets.googleapis.com/v4/spreadsheets',
    method: 'POST',
    body: {
      properties: {
        title: `JobBuddy Tracker ${new Date().toISOString().slice(0, 10)}`,
      },
      sheets: [{ properties: { title: SHEET_NAME } }],
    },
  });

  await ensureSheetAndHeaders(accessToken, response.spreadsheetId);

  return {
    spreadsheetId: response.spreadsheetId,
    spreadsheetUrl: response.spreadsheetUrl,
  };
}

function toSheetRow(job: JobData): string[] {
  return [
    job.dateApplied,
    job.company,
    job.role,
    job.location,
    job.jobId,
    job.jobUrl,
    job.keyRequirements.slice(0, 5).join(' | '),
    job.salaryRange,
    job.visaSponsorship,
    String(job.atsScore),
    job.resumeVersion,
    job.status,
    job.notes,
  ];
}

export async function appendJobToSheet(args: {
  clientId: string;
  clientSecret?: string;
  spreadsheetId: string;
  jobData: JobData;
}): Promise<{ spreadsheetUrl: string }> {
  const accessToken = await getValidGoogleAccessToken(args.clientId, args.clientSecret);

  await ensureSheetAndHeaders(accessToken, args.spreadsheetId);

  await googleFetch<{ updates: { updatedRange: string } }>({
    accessToken,
    url: `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(args.spreadsheetId)}/values/${encodeURIComponent(`${SHEET_NAME}!A:M`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    method: 'POST',
    body: {
      values: [toSheetRow(args.jobData)],
    },
  });

  const details = await googleFetch<SpreadsheetDetails>({
    accessToken,
    url: `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(args.spreadsheetId)}?fields=spreadsheetUrl`,
  });

  return {
    spreadsheetUrl:
      details.spreadsheetUrl ?? `https://docs.google.com/spreadsheets/d/${encodeURIComponent(args.spreadsheetId)}`,
  };
}

export async function markJobAsEmailed(args: {
  clientId: string;
  clientSecret?: string;
  spreadsheetId: string;
  jobUrl: string;
}): Promise<boolean> {
  if (!args.jobUrl.trim()) return false;

  const accessToken = await getValidGoogleAccessToken(args.clientId, args.clientSecret);
  await ensureSheetAndHeaders(accessToken, args.spreadsheetId);

  const rows = await googleFetch<ValuesResponse>({
    accessToken,
    url: `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(args.spreadsheetId)}/values/${encodeURIComponent(`${SHEET_NAME}!A2:M`)}`,
  });

  const values = rows.values ?? [];
  const matchIndex = values.findIndex((row) => (row[5] ?? '').trim() === args.jobUrl.trim());
  if (matchIndex === -1) return false;

  const rowNumber = matchIndex + 2;
  const row = values[matchIndex];
  const currentStatus = row[11] ?? 'Saved';
  const currentNotes = row[12] ?? '';

  const status = currentStatus === 'Saved' ? 'Applied' : currentStatus;
  const noteStamp = `Emailed (${new Date().toISOString().slice(0, 10)})`;
  const notes = currentNotes.includes(noteStamp)
    ? currentNotes
    : [currentNotes, noteStamp].filter(Boolean).join(' | ');

  await googleFetch<{ updatedRange: string }>({
    accessToken,
    url: `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(args.spreadsheetId)}/values/${encodeURIComponent(`${SHEET_NAME}!L${rowNumber}:M${rowNumber}`)}?valueInputOption=USER_ENTERED`,
    method: 'PUT',
    body: {
      values: [[status, notes]],
    },
  });

  return true;
}

export async function loadAppliedJobLookup(args: {
  clientId: string;
  clientSecret?: string;
  spreadsheetId: string;
}): Promise<AppliedJobLookup> {
  const accessToken = await getValidGoogleAccessToken(args.clientId, args.clientSecret);
  await ensureSheetAndHeaders(accessToken, args.spreadsheetId);

  const rows = await googleFetch<ValuesResponse>({
    accessToken,
    url: `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(args.spreadsheetId)}/values/${encodeURIComponent(`${SHEET_NAME}!A2:M`)}`,
  });

  const appliedLookup: AppliedJobLookup = {};
  const values = rows.values ?? [];

  for (const row of values) {
    const status = normalizeLookupPart(row[11] ?? 'saved');
    const isApplied = status === 'applied' || status === 'interviewing' || status === 'rejected' || status === 'offer';
    if (!isApplied) continue;

    const keys = buildLookupKeys({
      title: row[2] ?? '',
      company: row[1] ?? '',
      jobId: row[4] ?? '',
      jobUrl: row[5] ?? '',
    });

    for (const key of keys) {
      appliedLookup[key] = true;
    }
  }

  return appliedLookup;
}
