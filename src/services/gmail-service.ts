import type { EmailDetectionResult, EmailDraft, GmailSendResult, SentEmail } from '../types/email';
import { getValidGoogleAccessToken } from './google-auth';

const SENT_EMAILS_KEY = 'sentEmails';
const EMAIL_REGEX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

function toBase64Url(str: string): string {
  return btoa(unescape(encodeURIComponent(str)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function normalizeBodyToHtml(body: string, isHtml: boolean): string {
  if (isHtml) return body;

  const escaped = body
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  return escaped.replace(/\n/g, '<br/>');
}

function createMimeMessage(draft: EmailDraft): string {
  const headers = [
    `To: ${draft.to}`,
    draft.cc ? `Cc: ${draft.cc}` : '',
    draft.bcc ? `Bcc: ${draft.bcc}` : '',
    `Subject: ${draft.subject}`,
    'Content-Type: text/html; charset=utf-8',
    'MIME-Version: 1.0',
  ]
    .filter(Boolean)
    .join('\r\n');

  const resumeNote = draft.attachResume && draft.resumeVersion
    ? `<br/><br/><p style="color:#6b7280;font-size:12px;">Resume version selected: ${draft.resumeVersion}</p>`
    : '';

  const htmlBody = `${normalizeBodyToHtml(draft.body, draft.isHtml)}${resumeNote}`;
  return `${headers}\r\n\r\n${htmlBody}`;
}

async function gmailFetch<T>(args: {
  accessToken: string;
  url: string;
  method: 'POST';
  body: unknown;
}): Promise<T> {
  const response = await fetch(args.url, {
    method: args.method,
    headers: {
      Authorization: `Bearer ${args.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args.body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => 'Unknown Gmail API error');
    throw new Error(`Gmail API error (${response.status}): ${text}`);
  }

  return (await response.json()) as T;
}

function normalizeSubject(text: string): string {
  return text.replace(/^subject\s*:\s*/i, '').trim();
}

function uniqueEmails(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const normalized = value.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function scoreEmailPreference(email: string): number {
  const positive = /(recruit|talent|career|jobs|hiring|hr)/i;
  const negative = /(no-?reply|donotreply|support|help|privacy|legal|webmaster)/i;
  let score = 0;
  if (positive.test(email)) score += 3;
  if (negative.test(email)) score -= 4;
  return score;
}

function pickPreferredEmail(emails: string[]): string {
  if (emails.length === 0) return '';
  return [...emails].sort((a, b) => scoreEmailPreference(b) - scoreEmailPreference(a))[0];
}

export function extractEmailCandidates(text?: string): string[] {
  if (!text) return [];
  const matches = text.match(EMAIL_REGEX) ?? [];
  return uniqueEmails(matches);
}

function extractSubject(content: string): string {
  const line = content.match(/^\s*subject\s*:\s*(.+)$/im)?.[1]?.trim();
  if (line) return normalizeSubject(line);

  const fallback = content.split('\n')[0]?.trim() || '';
  if (fallback.toLowerCase().startsWith('hi ') || fallback.toLowerCase().startsWith('hello ')) {
    return 'Follow-up regarding opportunity';
  }

  return fallback.slice(0, 90) || 'Job application follow-up';
}

function extractTo(content: string, pageText?: string): string {
  const line = content.match(/^\s*to\s*:\s*([^\n]+)$/im)?.[1]?.trim();
  if (line) return line;

  const bodyCandidates = extractEmailCandidates(content);
  const preferredBody = pickPreferredEmail(bodyCandidates);
  if (preferredBody) return preferredBody;

  const pageCandidates = extractEmailCandidates(pageText);
  const preferredPage = pickPreferredEmail(pageCandidates);
  if (preferredPage) return preferredPage;

  return '';
}

function extractBody(content: string): string {
  let body = content.replace(/^\s*subject\s*:\s*.+$/gim, '');
  body = body.replace(/^\s*to\s*:\s*.+$/gim, '');
  body = body.trim();
  return body;
}

function looksLikeEmail(content: string, previousUserMessage?: string): boolean {
  if (/^\s*subject\s*:/im.test(content) || /^\s*to\s*:/im.test(content)) return true;
  if (/dear\s+|hi\s+|hello\s+/i.test(content) && /(best|regards|sincerely|thanks),?/i.test(content)) return true;

  const userAsked = previousUserMessage ?? '';
  if (/email|outreach|cold email|cover letter|message recruiter|write to/i.test(userAsked)) return true;

  return false;
}

export function detectEmailDraft(args: {
  assistantContent: string;
  previousUserMessage?: string;
  pageText?: string;
  resumeVersion?: string;
}): EmailDetectionResult {
  const subject = extractSubject(args.assistantContent);
  const to = extractTo(args.assistantContent, args.pageText);
  const body = extractBody(args.assistantContent);

  return {
    isEmailLike: looksLikeEmail(args.assistantContent, args.previousUserMessage),
    draft: {
      to,
      subject,
      body,
      attachResume: false,
      resumeVersion: args.resumeVersion,
      isHtml: false,
    },
  };
}

async function loadSentEmails(): Promise<SentEmail[]> {
  return new Promise((resolve) => {
    chrome.storage.local.get([SENT_EMAILS_KEY], (result) => {
      resolve((result[SENT_EMAILS_KEY] as SentEmail[] | undefined) ?? []);
    });
  });
}

async function saveSentEmails(emails: SentEmail[]): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [SENT_EMAILS_KEY]: emails }, () => resolve());
  });
}

export async function sendEmailViaGmail(args: {
  clientId: string;
  clientSecret?: string;
  draft: EmailDraft;
  relatedJobUrl?: string;
  relatedCompany?: string;
}): Promise<SentEmail> {
  if (!args.draft.to.trim()) {
    throw new Error('Recipient email is required.');
  }

  const accessToken = await getValidGoogleAccessToken(args.clientId, args.clientSecret);
  const mime = createMimeMessage(args.draft);

  const result = await gmailFetch<GmailSendResult>({
    accessToken,
    url: 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
    method: 'POST',
    body: {
      raw: toBase64Url(mime),
    },
  });

  const sentEmail: SentEmail = {
    id: result.id,
    threadId: result.threadId,
    to: args.draft.to,
    subject: args.draft.subject,
    sentAt: new Date().toISOString(),
    relatedJobUrl: args.relatedJobUrl,
    relatedCompany: args.relatedCompany,
    resumeVersion: args.draft.resumeVersion,
  };

  const existing = await loadSentEmails();
  const merged = [sentEmail, ...existing].slice(0, 500);
  await saveSentEmails(merged);

  return sentEmail;
}

export async function saveGmailDraft(args: {
  clientId: string;
  clientSecret?: string;
  draft: EmailDraft;
}): Promise<GmailSendResult> {
  if (!args.draft.to.trim()) {
    throw new Error('Recipient email is required to save draft.');
  }

  const accessToken = await getValidGoogleAccessToken(args.clientId, args.clientSecret);
  const mime = createMimeMessage(args.draft);

  return gmailFetch<GmailSendResult>({
    accessToken,
    url: 'https://gmail.googleapis.com/gmail/v1/users/me/drafts',
    method: 'POST',
    body: {
      message: {
        raw: toBase64Url(mime),
      },
    },
  });
}
