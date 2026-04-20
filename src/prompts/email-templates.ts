import type { OutreachEmailType } from '../types/email';

export interface EmailTemplateDefinition {
  type: OutreachEmailType;
  label: string;
  goal: string;
  tone: string;
  maxWords?: number;
  maxChars?: number;
  timing?: string;
  structure: string[];
  rules: string[];
  starterSubjectPattern?: string;
}

export const EMAIL_TEMPLATE_DEFINITIONS: Record<OutreachEmailType, EmailTemplateDefinition> = {
  'cold-recruiter': {
    type: 'cold-recruiter',
    label: 'Cold Email to Recruiter',
    goal: 'Get a response and ideally a referral or interview.',
    tone: 'Professional, concise, confident but not arrogant.',
    maxWords: 150,
    structure: [
      'Subject with role + one differentiator.',
      'Hook line tied to specific company signal.',
      '2-3 sentences of role-fit value proposition.',
      '1 concrete proof point.',
      'Exactly one call to action.',
      'Formal signature block.',
    ],
    rules: [
      'Do not start with pleasantries like "I hope this email finds you well."',
      'Do not use generic filler like "I am passionate" or "I am excited."',
      'Mirror language from the JD tech stack where possible.',
      'Lead with value to them, not what you want.',
      'Include one specific personalization signal.',
    ],
    starterSubjectPattern: '[Role] - MSCS @ Northeastern | 3+ Yrs @ WebMD',
  },
  'follow-up': {
    type: 'follow-up',
    label: 'Follow-Up (No Response)',
    goal: 'Nudge politely without sounding repetitive or pushy.',
    tone: 'Brief, casual, respectful.',
    maxWords: 80,
    timing: '5-7 days after previous email.',
    structure: [
      'Subject starts with Re: original subject.',
      'One short reminder sentence.',
      'One new update/value signal since prior note.',
      'One clear CTA line.',
      'Short casual signature.',
    ],
    rules: [
      'Keep it in the same thread.',
      'Avoid phrases like "just circling back" or "touching base."',
      'Add exactly one new point of value.',
      'Second follow-up should be even shorter.',
    ],
    starterSubjectPattern: 'Re: [Original Subject]',
  },
  'linkedin-connection': {
    type: 'linkedin-connection',
    label: 'LinkedIn Connection Request',
    goal: 'Get connection accepted and open conversation.',
    tone: 'Human, casual, non-salesy.',
    maxChars: 300,
    structure: [
      'One short self-intro with strongest credential.',
      'One specific reference to their company/work.',
      'Simple connect ask (no direct job ask).',
    ],
    rules: [
      'Must be under 300 characters.',
      'Do not ask for a job in this note.',
      'Avoid over-formal tone.',
    ],
  },
  'linkedin-post-connection': {
    type: 'linkedin-post-connection',
    label: 'LinkedIn Message After Connection',
    goal: 'Move from LinkedIn chat to call/email.',
    tone: 'Conversational and specific.',
    maxWords: 150,
    structure: [
      'Thank them for connecting.',
      'Reference specific company/product/team detail.',
      'Tie your background to their work.',
      'Ask for 15-minute chat with scheduling flexibility.',
      'Casual signature.',
    ],
    rules: [
      'Keep message practical and skimmable.',
      'Use one clear CTA only.',
    ],
  },
  'thank-you-post-interview': {
    type: 'thank-you-post-interview',
    label: 'Thank You / Post-Interview',
    goal: 'Reinforce candidacy with thoughtful specificity.',
    tone: 'Warm and professional.',
    maxWords: 150,
    timing: 'Send within 2-4 hours after interview.',
    structure: [
      'Thank them and reference one specific discussion point.',
      'Connect that topic to your relevant experience.',
      'Forward-looking close toward next steps.',
      'Formal signature.',
    ],
    rules: [
      'Reference exactly one concrete interview detail.',
      'Do not sound generic or templated.',
    ],
    starterSubjectPattern: 'Thanks for the conversation, [Name]',
  },
  'networking-informational': {
    type: 'networking-informational',
    label: 'Networking / Informational Interview',
    goal: 'Build relationship and learn about team/domain.',
    tone: 'Curious, respectful of time.',
    maxWords: 120,
    structure: [
      'Shared context intro (alum, domain, role overlap).',
      'One specific question about team/stack/problem.',
      'Request for short chat with flexible format.',
      'Simple signature.',
    ],
    rules: [
      'Ask one concrete question only.',
      'This is not a direct job ask.',
    ],
  },
  'referral-request': {
    type: 'referral-request',
    label: 'Referral Request',
    goal: 'Request a referral from an existing connection.',
    tone: 'Direct, appreciative, low-friction.',
    maxWords: 130,
    structure: [
      'Direct ask with specific role/company.',
      'One-line fit summary tied to role stack.',
      'Bullet-friendly assets: job link, resume, portfolio.',
      'Optional one-liner they can reuse.',
      'Graceful opt-out sentence.',
      'Signature.',
    ],
    rules: [
      'Make it easy for referrer to act quickly.',
      'Include all needed context in one message.',
      'Show appreciation regardless of outcome.',
    ],
    starterSubjectPattern: 'Would you be open to referring me for [Role] at [Company]?',
  },
};

export function getEmailTemplateDefinition(type: OutreachEmailType): EmailTemplateDefinition {
  return EMAIL_TEMPLATE_DEFINITIONS[type];
}