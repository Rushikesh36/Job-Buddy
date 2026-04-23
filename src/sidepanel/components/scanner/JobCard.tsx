import type { RawJobListing, ScoredJob } from '../../../types/scanner';

interface JobCardProps {
  job: RawJobListing | ScoredJob;
  index: number;
  actionsDisabled?: boolean;
  onSaveJobToSheet?: (job: RawJobListing | ScoredJob) => void;
  onGenerateEmail?: (job: RawJobListing | ScoredJob) => void;
  onChatAboutJob?: (job: RawJobListing | ScoredJob) => void;
}

function shorten(value: string, max = 110): string {
  if (!value) return '';
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

export default function JobCard({
  job,
  index,
  actionsDisabled,
  onSaveJobToSheet,
  onGenerateEmail,
  onChatAboutJob,
}: JobCardProps) {
  const scored = 'matchScore' in job;
  const applied = job.appliedStatus === 'applied';

  const scoreColor = !scored
    ? 'text-gray-600 bg-gray-50 border-gray-200'
    : job.matchScore >= 7
      ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
      : job.matchScore >= 4
        ? 'text-amber-700 bg-amber-50 border-amber-200'
        : 'text-red-700 bg-red-50 border-red-200';

  return (
    <article className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-blue-600">Result #{index + 1}</p>
          <h4 className="mt-0.5 text-sm font-semibold text-gray-900">{job.title || 'Untitled role'}</h4>
          {job.isNew && (
            <span className="mt-1 inline-flex rounded-full border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700">
              NEW
            </span>
          )}
        </div>
        <div className="flex flex-col items-end gap-1">
          <span
            className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
              applied
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border-red-200 bg-red-50 text-red-700'
            }`}
          >
            {applied ? 'Applied' : 'Not Applied'}
          </span>
          {scored && (
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${scoreColor}`}>
              {job.matchScore}/10
            </span>
          )}
          {job.jobId && (
            <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[10px] font-medium text-gray-600">
              {job.jobId}
            </span>
          )}
        </div>
      </div>

      <div className="mt-2 space-y-1">
        <p className="text-xs text-gray-700">
          <span className="font-medium">Company:</span> {job.company || 'Unknown'}
        </p>
        <p className="text-xs text-gray-700">
          <span className="font-medium">Location:</span> {job.location || 'Unknown'}
        </p>
      </div>

      {job.rawText && (
        <p className="mt-2 rounded-lg bg-gray-50 px-2 py-1.5 text-[11px] leading-4 text-gray-600">
          {shorten(job.rawText, 220)}
        </p>
      )}

      {scored && (
        <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] text-slate-700 space-y-1">
          <p>
            <span className="font-semibold">Reason:</span> {job.matchReason || 'No reason provided.'}
          </p>
          {job.matchingSkills.length > 0 && (
            <p>
              <span className="font-semibold">Matches:</span> {job.matchingSkills.slice(0, 5).join(', ')}
            </p>
          )}
        </div>
      )}

      <div className="mt-2 flex items-center justify-end gap-2">
        {onChatAboutJob && (
          <button
            disabled={actionsDisabled}
            onClick={() => onChatAboutJob(job)}
            className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors ${
              actionsDisabled
                ? 'cursor-not-allowed border border-gray-200 bg-gray-100 text-gray-400'
                : 'border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
            }`}
          >
            Chat
          </button>
        )}
        {onGenerateEmail && (
          <button
            disabled={actionsDisabled}
            onClick={() => onGenerateEmail(job)}
            className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors ${
              actionsDisabled
                ? 'cursor-not-allowed border border-gray-200 bg-gray-100 text-gray-400'
                : 'border border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100'
            }`}
          >
            Email
          </button>
        )}
        {onSaveJobToSheet && (
          <button
            disabled={actionsDisabled}
            onClick={() => onSaveJobToSheet(job)}
            className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors ${
              actionsDisabled
                ? 'cursor-not-allowed border border-gray-200 bg-gray-100 text-gray-400'
                : 'border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100'
            }`}
          >
            Save
          </button>
        )}
        {job.detailUrl && (
          <a
            href={job.detailUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-medium text-blue-700 hover:bg-blue-100"
          >
            Open Posting
          </a>
        )}
      </div>
    </article>
  );
}
