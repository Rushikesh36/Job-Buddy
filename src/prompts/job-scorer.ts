import type { RawJobListing } from '../types/scanner';

interface SimplifiedJobForScoring {
  jobId: string;
  title: string;
  company: string;
  location: string;
  type: string;
  description: string;
}

function sanitizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function toSimplifiedScoringJobs(jobs: RawJobListing[]): SimplifiedJobForScoring[] {
  return jobs.map((job) => ({
    jobId: job.jobId || job.detailUrl || `${job.title}::${job.company}`,
    title: sanitizeText(job.title),
    company: sanitizeText(job.company),
    location: sanitizeText(job.location),
    type: sanitizeText(job.jobType),
    description: sanitizeText(job.description || job.rawText).slice(0, 1000),
  }));
}

export function buildJobScoringPrompt(args: {
  candidateProfileText: string;
  jobs: SimplifiedJobForScoring[];
}): string {
  return `You are a career matching assistant. Score each job against this candidate profile.

## Candidate Profile
${args.candidateProfileText}

## Candidate Preferences
- Target: Fall 2026 Co-op
- Looking for: Backend-leaning Full Stack SWE, ML/AI Engineering
- Visa status: F-1 (needs CPT/OPT authorization)
- Location: Boston, MA (prefer local, open to remote)

## Jobs to Score
${JSON.stringify(args.jobs, null, 2)}

For EACH job, respond with a JSON array of objects in this shape:
[
  {
    "jobId": "...",
    "matchScore": 8,
    "matchReason": "...",
    "matchingSkills": ["..."],
    "missingSkills": ["..."],
    "visaFlag": "green",
    "actionItems": ["..."]
  }
]

Scoring guidelines:
- 9-10: Near perfect match, apply immediately
- 7-8: Strong match, should apply
- 5-6: Decent match
- 3-4: Weak match, significant skill gaps
- 1-2: Not relevant

visaFlag:
- green: No citizenship/clearance requirement mentioned
- yellow: Ambiguous work authorization language
- red: Requires citizenship, permanent residency, or security clearance

IMPORTANT: Only respond with the JSON array. No markdown, no explanation outside the JSON.`;
}
