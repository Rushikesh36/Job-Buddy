import type { JobData, JobExtractionFields, VisaSponsorship } from '../types/job';

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
