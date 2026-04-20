export interface EmailDraft {
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  attachResume: boolean;
  resumeVersion?: string;
  isHtml: boolean;
}

export interface SentEmail {
  id: string;
  threadId: string;
  to: string;
  subject: string;
  sentAt: string;
  relatedJobUrl?: string;
  relatedCompany?: string;
  resumeVersion?: string;
}

export interface GmailSendResult {
  id: string;
  threadId: string;
}

export interface EmailDetectionResult {
  isEmailLike: boolean;
  draft: EmailDraft;
}

export type OutreachEmailType =
  | 'cold-recruiter'
  | 'follow-up'
  | 'linkedin-connection'
  | 'linkedin-post-connection'
  | 'thank-you-post-interview'
  | 'networking-informational'
  | 'referral-request';

export interface GeneratedEmailRecord {
  id: string;
  createdAt: string;
  type: OutreachEmailType;
  company?: string;
  role?: string;
  to: string;
  subject: string;
  source: 'scanner' | 'manual' | 'chat';
}
