import type { RawJobListing, ScoredJob } from '../../../types/scanner';
import JobCard from './JobCard';

interface JobResultsListProps {
  jobs: Array<RawJobListing | ScoredJob>;
  emptyMessage?: string;
  actionsDisabled?: boolean;
  onSaveJobToSheet?: (job: RawJobListing | ScoredJob) => void;
  onGenerateEmail?: (job: RawJobListing | ScoredJob) => void;
  onChatAboutJob?: (job: RawJobListing | ScoredJob) => void;
}

export default function JobResultsList({
  jobs,
  emptyMessage,
  actionsDisabled,
  onSaveJobToSheet,
  onGenerateEmail,
  onChatAboutJob,
}: JobResultsListProps) {
  if (jobs.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-3 py-4 text-xs text-gray-600">
        {emptyMessage ?? 'No jobs found on this page yet.'}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {jobs.map((job, index) => {
        const key = job.jobId || job.detailUrl || `${job.title}-${index}`;
        return (
          <JobCard
            key={key}
            job={job}
            index={index}
            actionsDisabled={actionsDisabled}
            onSaveJobToSheet={onSaveJobToSheet}
            onGenerateEmail={onGenerateEmail}
            onChatAboutJob={onChatAboutJob}
          />
        );
      })}
    </div>
  );
}
