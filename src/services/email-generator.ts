import type { EmailDraft, GeneratedEmailRecord, OutreachEmailType } from '../types/email';
import { buildEmailSystemPrompt } from '../prompts/email-system-prompt';
import { detectEmailTypeWithConfidence } from '../prompts/email-type-detector';
import { extractEmailCandidates } from './gmail-service';

const GENERATED_EMAILS_KEY = 'generatedEmails';

interface GenerateSmartEmailInput {
  userIntentText: string;
  emailType?: OutreachEmailType;
  source: 'scanner' | 'manual' | 'chat';
  pageTitle?: string;
  pageUrl?: string;
  pageText?: string;
  companyName?: string;
  roleTitle?: string;
  recruiterName?: string;
  recipientCandidates?: string[];
  chatContext?: string;
  memoryContext?: string;
  resumeVersion?: string;
  additionalInstructions?: string;
  runPrompt: (prompt: string) => Promise<string>;
}

function generateId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function parseGeneratedEmail(raw: string): { subject: string; body: string } {
  const normalized = raw.trim();
  const subjectMatch = normalized.match(/^\s*subject\s*:\s*(.+)$/im);
  const subject = subjectMatch?.[1]?.trim() || 'Job Application Follow-up';
  const body = normalized
    .replace(/^\s*subject\s*:\s*.+$/im, '')
    .trim();

  return {
    subject,
    body: body || normalized,
  };
}

function pickRecipient(candidates: string[]): string {
  if (candidates.length === 0) return '';
  const preferred = candidates.find((email) => /(recruit|talent|career|jobs|hiring|hr)/i.test(email));
  return preferred ?? candidates[0];
}

async function loadGeneratedEmails(): Promise<GeneratedEmailRecord[]> {
  return new Promise((resolve) => {
    chrome.storage.local.get([GENERATED_EMAILS_KEY], (result) => {
      resolve((result[GENERATED_EMAILS_KEY] as GeneratedEmailRecord[] | undefined) ?? []);
    });
  });
}

async function saveGeneratedEmails(records: GeneratedEmailRecord[]): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [GENERATED_EMAILS_KEY]: records }, () => resolve());
  });
}

async function storeGeneratedEmailRecord(record: GeneratedEmailRecord): Promise<void> {
  const existing = await loadGeneratedEmails();
  const merged = [record, ...existing].slice(0, 500);
  await saveGeneratedEmails(merged);
}

export async function generateSmartEmailDraft(input: GenerateSmartEmailInput): Promise<{
  draft: EmailDraft;
  emailType: OutreachEmailType;
  detectionConfidence: number;
}> {
  const detection = detectEmailTypeWithConfidence(input.userIntentText);
  const resolvedType = input.emailType ?? detection.emailType;

  const contextLines = [
    `User intent: ${input.userIntentText}`,
    input.companyName ? `Company: ${input.companyName}` : '',
    input.roleTitle ? `Role: ${input.roleTitle}` : '',
    input.recruiterName ? `Recipient Name: ${input.recruiterName}` : '',
    input.pageTitle ? `Page Title: ${input.pageTitle}` : '',
    input.pageUrl ? `Page URL: ${input.pageUrl}` : '',
  ].filter(Boolean);

  const systemPrompt = buildEmailSystemPrompt({
    emailType: resolvedType,
    pageContext: [contextLines.join('\n'), input.pageText ?? ''].filter(Boolean).join('\n\n'),
    chatContext: input.chatContext,
    memoryContext: input.memoryContext,
    additionalInstructions: [
      'Generate one high-quality outreach email tailored to the provided context.',
      input.additionalInstructions,
    ].filter(Boolean).join(' '),
  });

  const raw = await input.runPrompt(systemPrompt);
  const parsed = parseGeneratedEmail(raw);

  const extractedFromPage = extractEmailCandidates(input.pageText);
  const combinedCandidates = [
    ...(input.recipientCandidates ?? []),
    ...extractedFromPage,
  ];
  const to = pickRecipient(Array.from(new Set(combinedCandidates.map((item) => item.trim().toLowerCase()).filter(Boolean))));

  const draft: EmailDraft = {
    to,
    subject: parsed.subject,
    body: parsed.body,
    attachResume: true,
    resumeVersion: input.resumeVersion,
    isHtml: false,
  };

  void storeGeneratedEmailRecord({
    id: generateId(),
    createdAt: new Date().toISOString(),
    type: resolvedType,
    company: input.companyName,
    role: input.roleTitle,
    to,
    subject: parsed.subject,
    source: input.source,
  });

  return {
    draft,
    emailType: resolvedType,
    detectionConfidence: input.emailType ? 1 : detection.confidence,
  };
}
