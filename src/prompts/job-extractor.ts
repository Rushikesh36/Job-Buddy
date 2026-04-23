import type { JobData, JobExtractionFields, VisaSponsorship } from '../types/job';

// Lines from NUworks/Symplicity innerText that are UI chrome, not content.
const UI_NOISE = new Set([
  'save', 'apply', 'follow', 'share', 'report', 'new', 'view application',
  'view full profile', 'matching qualifications',
  'see how your profile matches with this job',
  'additional job details', 'job description', 'required qualifications',
  'application process', 'about this employer', 'related resources',
  'position type', 'compensation', 'location', 'desired skills', 'job number',
  'hours per week', 'workplace type', 'transportation', 'hiring status',
  'number of openings', 'job length', 'compensation currency type',
  'targeted academic majors', 'desired experience level',
  'campus country', 'degree level', 'minimum grade point average',
  'applicant type', 'application deadline',
]);

function isNoiseLine(line: string): boolean {
  const lower = line.toLowerCase().trim();
  if (UI_NOISE.has(lower)) return true;
  if (/^\d+[dhwm]$/.test(lower)) return true;
  if (/^(new|verified)$/.test(lower)) return true;
  if (/^add .+ to my saved list$/i.test(lower)) return true;
  if (/^not qualified$/i.test(lower)) return true;
  return false;
}

function buildLabelValueMap(lines: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  const LABELS: Record<string, string> = {
    'compensation': 'salary', 'salary': 'salary', 'pay': 'salary',
    'location': 'location', 'work location': 'location',
    'job number': 'jobId', 'job id': 'jobId', 'job #': 'jobId',
    'requisition id': 'jobId', 'posting id': 'jobId',
  };
  for (let i = 0; i < lines.length - 1; i++) {
    const key = LABELS[lines[i].toLowerCase().trim()];
    if (key && lines[i + 1]) map[key] = lines[i + 1].trim();
  }
  return map;
}

function extractRequirementsFromLines(lines: string[]): string[] {
  const headingIdx = lines.findIndex((l) =>
    /^(?:what we(?:'re)? looking for|minimum qualifications?|basic qualifications?|qualifications?|requirements?)/i.test(l.trim())
  );
  const section = headingIdx >= 0 ? lines.slice(headingIdx + 1) : lines;
  const results: string[] = [];
  for (const line of section) {
    const clean = line.replace(/^[\s•\-*–—►▪·]+/, '').trim();
    if (clean.length > 15 && clean.length < 200) {
      results.push(clean);
      if (results.length === 5) break;
    }
  }
  return results;
}

function extractVisaFromText(text: string): VisaSponsorship {
  if (/will\s+not\s+sponsor|does\s+not\s+sponsor|no\s+visa\s+sponsor/i.test(text)) return 'No';
  if (/must\s+be\s+authorized\s+to\s+work.{0,60}without\s+sponsorship/i.test(text)) return 'No';
  if (/\bsponsors?\b|\bh.?1b\b|\bopt\b|\bcpt\b/i.test(text)) return 'Yes';
  if (/must\s+be\s+authorized|authorized\s+to\s+work/i.test(text)) return 'Unknown';
  return 'Unknown';
}

export function parseJobFromPage(params: {
  text: string;
  url: string;
  pageTitle: string;
  analysisText: string;
  resumeVersion: string;
}): JobData {
  const { text, url, analysisText, resumeVersion } = params;
  const allLines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const meaningful = allLines.filter((l) => !isNoiseLine(l) && l.length > 1);

  const role = meaningful[0] ?? '';

  let company = '';
  const aboutIdx = allLines.findIndex((l) => /^about this employer$/i.test(l));
  if (aboutIdx >= 0) {
    for (let i = aboutIdx + 1; i < allLines.length; i++) {
      const c = allLines[i].trim();
      if (c && !isNoiseLine(c) && c.length > 1) { company = c; break; }
    }
  }
  if (!company) {
    for (let i = 1; i < Math.min(6, meaningful.length); i++) {
      if (/\b(inc\.?|llc\.?|corp\.?|ltd\.?|co\.?|company|technologies|systems|solutions|labs?|group|institute|university|bank|health|services)\b/i.test(meaningful[i])) {
        company = meaningful[i]; break;
      }
    }
  }

  const lv = buildLabelValueMap(allLines);
  const requirements = extractRequirementsFromLines(allLines);

  let jobId = lv['jobId'] ?? '';
  if (!jobId) {
    const m = url.match(/\/jobs?\/detail\/([a-f0-9]{10,})/i) ?? url.match(/[?&](?:job_id|id|jid)=([^&]+)/i);
    jobId = m?.[1] ?? '';
  }

  return {
    dateApplied: new Date().toISOString(),
    company: company || 'N/A',
    role: role || 'N/A',
    location: lv['location'] || 'N/A',
    jobId: jobId || 'N/A',
    jobUrl: url,
    keyRequirements: requirements,
    salaryRange: lv['salary'] || 'N/A',
    visaSponsorship: extractVisaFromText(text),
    atsScore: parseAtsScore(analysisText),
    resumeVersion,
    status: 'Saved',
    notes: '',
  };
}

export function buildJobExtractionPrompt(pageContent: string): string {
  return `Extract the following fields from this job posting as a JSON object. If a field is not found, use "N/A":
{
  "company_name": "",
  "role_title": "",
  "location": "",
  "job_id": "",
  "key_requirements": ["", "", "", "", ""],
  "salary_range": "",
  "visa_sponsorship": "Yes | No | Unknown",
  "remote_hybrid_onsite": ""
}

Return only JSON. Do not wrap in markdown.

Job posting content:
${pageContent}`;
}

function sanitizeVisa(value: string): VisaSponsorship {
  if (value === 'Yes' || value === 'No' || value === 'Unknown') return value;

  const lower = value.toLowerCase();
  if (lower.includes('yes')) return 'Yes';
  if (lower.includes('no')) return 'No';
  return 'Unknown';
}

function parseAtsScore(analysisText: string): number {
  const match = analysisText.match(/ATS Match Score:\s*(\d+(?:\.\d+)?)\s*\/\s*10/i);
  if (!match) return 0;

  const value = Number(match[1]);
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(10, Math.round(value * 10) / 10));
}

function parseJsonFromText(content: string): JobExtractionFields {
  const fencedMatch = content.match(/```json\s*([\s\S]*?)\s*```/i);
  const candidate = fencedMatch?.[1] ?? content;

  const firstBrace = candidate.indexOf('{');
  const lastBrace = candidate.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || firstBrace >= lastBrace) {
    throw new Error('LLM did not return valid JSON for job extraction.');
  }

  const jsonString = candidate.slice(firstBrace, lastBrace + 1);
  return JSON.parse(jsonString) as JobExtractionFields;
}

export function toJobDraft(params: {
  extractedRaw: string;
  jobUrl: string;
  analysisText: string;
  resumeVersion: string;
}): JobData {
  const parsed = parseJsonFromText(params.extractedRaw);

  return {
    dateApplied: new Date().toISOString(),
    company: parsed.company_name || 'N/A',
    role: parsed.role_title || 'N/A',
    location: parsed.location || 'N/A',
    jobId: parsed.job_id || 'N/A',
    jobUrl: params.jobUrl,
    keyRequirements: (parsed.key_requirements || []).filter(Boolean).slice(0, 5),
    salaryRange: parsed.salary_range || 'N/A',
    visaSponsorship: sanitizeVisa(parsed.visa_sponsorship || 'Unknown'),
    atsScore: parseAtsScore(params.analysisText),
    resumeVersion: params.resumeVersion,
    status: 'Saved',
    notes: '',
  };
}
