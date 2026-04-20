import type { OutreachEmailType } from '../types/email';
import { getEmailTemplateDefinition } from './email-templates';

const FULL_PROFILE_CONTEXT = `Name: Rushikesh Wani
Location: Boston, MA
Portfolio: rushikeshwani.dev
Current Status: MSCS student at Northeastern University, Khoury College of Computer Sciences (4.0 GPA, graduating May 2027)
Seeking: Fall 2026 Co-op (Backend-leaning Full Stack SWE or ML/AI Engineering)
Visa: F-1 student visa (eligible for CPT/OPT, will need H-1B sponsorship long-term)

PROFESSIONAL EXPERIENCE:
- 3+ years as Software Engineer at WebMD / Medscape (Physicians Interactive India / Aptus Health)
- Built and maintained healthcare web platforms serving millions of users
- Led Vue 2 to Vue 3 migration across the codebase
- Implemented Server-Side Rendering improving page load and SEO
- Built a cross-domain page builder used across multiple Medscape properties
- Designed CSS token architecture for consistent design system
- Set up monitoring infrastructure using Grafana and Prometheus
- Tech: Vue.js, Node.js, Express, MongoDB

EDUCATION:
- M.S. Computer Science, Northeastern University (4.0 GPA, May 2027)
- B.E., D.Y. Patil RAIT, University of Mumbai

TECHNICAL SKILLS:
- Languages: JavaScript, TypeScript, Python, SQL, R
- Frontend: Vue.js, React, Tailwind CSS, HTML/CSS
- Backend: Node.js, Express, FastAPI
- Databases: MongoDB, MySQL, SQLite, ChromaDB
- Tools: Git, Docker, Podman, Webpack, Vite, Grafana, Prometheus
- AI/ML: Claude API, OpenAI API, LangChain, RAG, Vector Databases

KEY PROJECTS:
1) JobBuddy AI: Chrome extension with AI agent for job applications
2) MedPod: privacy-first local lab report interpreter (Red Hat hackathon, 3rd place)
3) PulseOps: real-time infrastructure monitoring dashboard
4) Full ETL pipeline: CSV to SQLite to MongoDB to MySQL star schema
5) HelpCamp: COVID crisis assistance platform

STRENGTHS TO HIGHLIGHT:
- Rare combo: 3 years production experience + top-tier grad school (4.0 GPA)
- Healthcare domain expertise at WebMD scale
- Full stack with strong frontend/backend, actively building ML skills
- Ships real products: hackathon winner and deployed projects
- International perspective: India + US experience

WHAT NOT TO FRAME INCORRECTLY:
- Not a fresh grad with zero experience
- Not frontend-only
- Not tutorial-only; builds and ships real systems`;

const UNIVERSAL_EMAIL_RULES = `RULES FOR ALL EMAILS:
1. Never start with "I hope this email finds you well".
2. Never use "I am passionate" or "I am excited".
3. Never use "Dear Hiring Manager" if a better name/reference is available.
4. Never use em dashes; use commas or periods.
5. Never exceed the selected email type word/character limit.
6. Never be generic; include at least one specific personalization signal.
7. Always lead with value, not desire.
8. Always include exactly one clear CTA.
9. Always include signature:
   Formal: Best, Rushikesh Wani | MSCS @ Northeastern (4.0) | 3+ Years SWE @ WebMD | rushikeshwani.dev
   Casual: Rushikesh | rushikeshwani.dev
10. Never mention number of GitHub repositories.
11. Match tone to company stage: startup casual, enterprise professional.
12. If healthcare/healthtech role, highlight WebMD experience.
13. If AI/ML role, highlight MedPod and JobBuddy AI.
14. If frontend-heavy role, lead with Vue migration + SSR.
15. If backend-heavy role, lead with Node/Express/MongoDB at scale + monitoring infra.
16. If Boston-based role, mention local presence.
17. Keep paragraphs short (2-3 sentences max).
18. Use numbers where possible (3 years, millions of users, 4.0 GPA, 3rd place).`;

const SUBJECT_RULES = `SUBJECT LINE RULES:
- Include role title when role is specific.
- Include one differentiator: MSCS @ Northeastern OR 3+ Yrs @ WebMD OR 4.0 GPA.
- Keep under 60 characters when possible.
- No ALL CAPS, no exclamation marks, no emojis.
- For follow-ups, always use Re: existing subject.`;

export function buildEmailSystemPrompt(args: {
  emailType: OutreachEmailType;
  pageContext?: string;
  chatContext?: string;
  memoryContext?: string;
  additionalInstructions?: string;
}): string {
  const template = getEmailTemplateDefinition(args.emailType);

  const templateBlock = [
    `EMAIL TYPE: ${template.label}`,
    `GOAL: ${template.goal}`,
    `TONE: ${template.tone}`,
    template.maxWords ? `MAX WORDS: ${template.maxWords}` : '',
    template.maxChars ? `MAX CHARS: ${template.maxChars}` : '',
    template.timing ? `TIMING: ${template.timing}` : '',
    'STRUCTURE:',
    ...template.structure.map((line, index) => `${index + 1}. ${line}`),
    'TYPE-SPECIFIC RULES:',
    ...template.rules.map((rule, index) => `${index + 1}. ${rule}`),
    template.starterSubjectPattern ? `SUBJECT PATTERN: ${template.starterSubjectPattern}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return `You are JobBuddy AI's outreach-email generator. Generate one high-quality, personalized email draft.

${FULL_PROFILE_CONTEXT}

${UNIVERSAL_EMAIL_RULES}

${SUBJECT_RULES}

${templateBlock}

CONTEXT SIGNALS:
PAGE CONTEXT:
${args.pageContext?.trim() || 'N/A'}

CHAT CONTEXT:
${args.chatContext?.trim() || 'N/A'}

MEMORY CONTEXT:
${args.memoryContext?.trim() || 'N/A'}

OUTPUT CONTRACT:
- Return plain text email only.
- First line must be: Subject: ...
- Then email body.
- Keep to the selected template's constraints.
- If required personalization context is missing, make a reasonable best effort and keep placeholders minimal.

ADDITIONAL INSTRUCTIONS:
${args.additionalInstructions?.trim() || 'N/A'}`;
}
