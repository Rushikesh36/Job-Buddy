import type { OutreachEmailType } from '../types/email';

function hasAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

export interface EmailTypeDetectionResult {
  emailType: OutreachEmailType;
  confidence: number;
}

export function detectEmailTypeWithConfidence(input: string): EmailTypeDetectionResult {
  const text = input.toLowerCase();

  if (hasAny(text, [/referral/, /refer me/, /employee referral/, /can you refer/])) {
    return { emailType: 'referral-request', confidence: 0.94 };
  }

  if (hasAny(text, [/thank you/, /post interview/, /after interview/, /thanks for the interview/])) {
    return { emailType: 'thank-you-post-interview', confidence: 0.92 };
  }

  if (hasAny(text, [/follow up/, /no response/, /nudge/, /follow-up/])) {
    return { emailType: 'follow-up', confidence: 0.9 };
  }

  if (hasAny(text, [/linkedin/]) && hasAny(text, [/connection request/, /connect note/, /connect message/])) {
    return { emailType: 'linkedin-connection', confidence: 0.93 };
  }

  if (hasAny(text, [/linkedin/]) && hasAny(text, [/after connection/, /connected/, /post connection/, /dm/])) {
    return { emailType: 'linkedin-post-connection', confidence: 0.89 };
  }

  if (hasAny(text, [/informational/, /coffee chat/, /learn about/, /networking/])) {
    return { emailType: 'networking-informational', confidence: 0.9 };
  }

  if (hasAny(text, [/cold email/, /reach out/, /outreach/])) {
    return { emailType: 'cold-recruiter', confidence: 0.88 };
  }

  return { emailType: 'cold-recruiter', confidence: 0.6 };
}

export function detectEmailTypeFromPrompt(input: string): OutreachEmailType {
  return detectEmailTypeWithConfidence(input).emailType;
}
