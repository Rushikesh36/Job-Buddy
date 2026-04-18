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
