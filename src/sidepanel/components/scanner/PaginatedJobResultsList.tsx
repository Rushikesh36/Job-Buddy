import { useState, useMemo } from 'react';
import type { RawJobListing, ScoredJob } from '../../../types/scanner';
import JobResultsList from './JobResultsList';

interface PaginatedJobResultsListProps {
  jobs: Array<RawJobListing | ScoredJob>;
  emptyMessage?: string;
  actionsDisabled?: boolean;
  pageSize?: number;
  onSaveJobToSheet?: (job: RawJobListing | ScoredJob) => void;
  onGenerateEmail?: (job: RawJobListing | ScoredJob) => void;
  onChatAboutJob?: (job: RawJobListing | ScoredJob) => void;
}

export default function PaginatedJobResultsList({
  jobs,
  emptyMessage,
  actionsDisabled,
  pageSize = 10,
  onSaveJobToSheet,
  onGenerateEmail,
  onChatAboutJob,
}: PaginatedJobResultsListProps) {
  const [currentPage, setCurrentPage] = useState(0);

  const totalPages = useMemo(() => Math.ceil(jobs.length / pageSize), [jobs.length, pageSize]);

  const paginatedJobs = useMemo(() => {
    const start = currentPage * pageSize;
    const end = start + pageSize;
    return jobs.slice(start, end);
  }, [jobs, currentPage, pageSize]);

  // Reset to first page if current page is out of bounds
  if (currentPage >= totalPages && totalPages > 0) {
    setCurrentPage(0);
  }

  if (jobs.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-3 py-4 text-xs text-gray-600">
        {emptyMessage ?? 'No jobs found.'}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <JobResultsList
        jobs={paginatedJobs}
        emptyMessage={emptyMessage}
        actionsDisabled={actionsDisabled}
        onSaveJobToSheet={onSaveJobToSheet}
        onGenerateEmail={onGenerateEmail}
        onChatAboutJob={onChatAboutJob}
      />

      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-gray-200 pt-2">
          <div className="text-xs text-gray-500">
            Page {currentPage + 1} of {totalPages} ({jobs.length} total)
          </div>

          <div className="flex gap-1">
            <button
              onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
              disabled={currentPage === 0}
              className="rounded border border-gray-300 bg-white px-2 py-1 text-xs hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              ← Prev
            </button>

            <div className="flex items-center gap-1">
              {Array.from({ length: totalPages }, (_, i) => (
                <button
                  key={i}
                  onClick={() => setCurrentPage(i)}
                  className={`w-6 rounded text-xs ${
                    i === currentPage
                      ? 'border border-blue-500 bg-blue-50 font-medium text-blue-700'
                      : 'border border-gray-300 bg-white hover:bg-gray-50'
                  }`}
                >
                  {i + 1}
                </button>
              ))}
            </div>

            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={currentPage === totalPages - 1}
              className="rounded border border-gray-300 bg-white px-2 py-1 text-xs hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
