import type { RawJobListing, ScoredJob, ScoringProgress, VisaFlag } from '../types/scanner';
import { buildJobScoringPrompt, toSimplifiedScoringJobs } from '../prompts/job-scorer';

export interface ScoreJobsInput {
  jobs: RawJobListing[];
  candidateProfileText: string;
  runPrompt: (prompt: string) => Promise<string>;
  onProgress?: (progress: ScoringProgress) => void;
  onPartialResults?: (jobs: ScoredJob[]) => void;
}

interface ScoreEntry {
  jobId: string;
  matchScore: number;
  matchReason: string;
  matchingSkills: string[];
  missingSkills: string[];
  visaFlag: VisaFlag;
  actionItems: string[];
}

const BATCH_SIZE = 10;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeJsonArray(raw: string): unknown[] {
  const fenced = raw.match(/```json\s*([\s\S]*?)\s*```/i)?.[1] ?? raw;
  const firstBracket = fenced.indexOf('[');
  const lastBracket = fenced.lastIndexOf(']');
  if (firstBracket === -1 || lastBracket === -1 || firstBracket >= lastBracket) return [];

  try {
    const parsed = JSON.parse(fenced.slice(firstBracket, lastBracket + 1));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function sanitizeVisaFlag(value: string): VisaFlag {
  if (value === 'green' || value === 'yellow' || value === 'red') return value;
  const lower = value.toLowerCase();
  if (lower.includes('green')) return 'green';
  if (lower.includes('red')) return 'red';
  return 'yellow';
}

function normalizeScoreEntry(raw: unknown): ScoreEntry | null {
  if (!raw || typeof raw !== 'object') return null;

  const candidate = raw as Record<string, unknown>;
  const jobId = String(candidate.jobId ?? '').trim();
  if (!jobId) return null;

  const scoreNum = Number(candidate.matchScore ?? 0);
  const matchScore = Number.isFinite(scoreNum) ? Math.max(1, Math.min(10, Math.round(scoreNum))) : 1;

  return {
    jobId,
    matchScore,
    matchReason: String(candidate.matchReason ?? '').trim(),
    matchingSkills: Array.isArray(candidate.matchingSkills)
      ? candidate.matchingSkills.map((item) => String(item).trim()).filter(Boolean)
      : [],
    missingSkills: Array.isArray(candidate.missingSkills)
      ? candidate.missingSkills.map((item) => String(item).trim()).filter(Boolean)
      : [],
    visaFlag: sanitizeVisaFlag(String(candidate.visaFlag ?? 'yellow')),
    actionItems: Array.isArray(candidate.actionItems)
      ? candidate.actionItems.map((item) => String(item).trim()).filter(Boolean)
      : [],
  };
}

export async function scoreJobsInBatches(input: ScoreJobsInput): Promise<ScoredJob[]> {
  const total = input.jobs.length;
  if (!total) return [];

  const totalBatches = Math.ceil(total / BATCH_SIZE);
  const scored: ScoredJob[] = [];

  for (let i = 0; i < total; i += BATCH_SIZE) {
    const batchIndex = Math.floor(i / BATCH_SIZE) + 1;
    const batch = input.jobs.slice(i, i + BATCH_SIZE);
    const simplifiedBatch = toSimplifiedScoringJobs(batch);

    const prompt = buildJobScoringPrompt({
      candidateProfileText: input.candidateProfileText,
      jobs: simplifiedBatch,
    });

    console.log(`[Scorer] Batch ${batchIndex}/${totalBatches}: Sending ${batch.length} jobs to LLM`);
    const response = await input.runPrompt(prompt);
    console.log(`[Scorer] Batch ${batchIndex}/${totalBatches}: Got response (${response.length} chars)`);
    
    const parsedScores = safeJsonArray(response)
      .map(normalizeScoreEntry)
      .filter((item): item is ScoreEntry => Boolean(item));
    
    console.log(`[Scorer] Batch ${batchIndex}/${totalBatches}: Parsed ${parsedScores.length} / ${batch.length} scores`);

    const scoreByJobId = new Map(parsedScores.map((entry) => [entry.jobId, entry]));

    batch.forEach((job) => {
      const lookupId = job.jobId || job.detailUrl || `${job.title}::${job.company}`;
      const score = scoreByJobId.get(lookupId);

      if (score) {
        scored.push({
          ...job,
          ...score,
        });
        return;
      }

      scored.push({
        ...job,
        matchScore: 5,
        matchReason: 'Fallback score due to parsing mismatch for this batch.',
        matchingSkills: [],
        missingSkills: [],
        visaFlag: 'yellow',
        actionItems: [],
      });
    });

    input.onPartialResults?.([...scored].sort((a, b) => b.matchScore - a.matchScore));

    input.onProgress?.({
      scored: Math.min(i + batch.length, total),
      total,
      batchIndex,
      totalBatches,
    });

    if (i + BATCH_SIZE < total) {
      await sleep(1000);
    }
  }

  return scored.sort((a, b) => b.matchScore - a.matchScore);
}
