import type {
  NUworksDetectionResult,
  NUworksEnrichProgress,
  NUworksPageExtractionResult,
  RawJobListing,
  NUworksScanProgress,
  ScoredJob,
  ScoringProgress,
} from '../../../types/scanner';
import { useState } from 'react';
import PaginatedJobResultsList from './PaginatedJobResultsList';
import JobResultsList from './JobResultsList';

interface ScannerTabProps {
  detection: NUworksDetectionResult | null;
  extraction: NUworksPageExtractionResult | null;
  isScanning: boolean;
  scanProgress: NUworksScanProgress | null;
  isEnriching: boolean;
  enrichProgress: NUworksEnrichProgress | null;
  isScoring: boolean;
  scoringProgress: ScoringProgress | null;
  scoredJobs: ScoredJob[];
  allScoredJobs: ScoredJob[];
  isBusy: boolean;
  scanNewOnly: boolean;
  showProfileFitOnly: boolean;
  dateFilter: 'all' | '24h' | '3d' | '7d';
  newJobsCount: number;
  skippedProcessedCount: number;
  lastScanDate: string | null;
  onToggleScanNewOnly: (enabled: boolean) => void;
  onToggleProfileFitOnly: (enabled: boolean) => void;
  onDateFilterChange: (value: 'all' | '24h' | '3d' | '7d') => void;
  onScanCurrentPage: () => void;
  onEnrichTopJobs: () => void;
  onEnrichTest30Jobs: () => void;
  onScoreJobs: () => void;
  onSaveJobToSheet: (job: RawJobListing | ScoredJob) => void;
  onGenerateEmail: (job: RawJobListing | ScoredJob) => void;
  onChatAboutJob: (job: RawJobListing | ScoredJob) => void;
  onSaveAllToSheet: () => void;
  onExportCsv: () => void;
}

function DetectionBadge({ detection }: { detection: NUworksDetectionResult | null }) {
  if (!detection) {
    return (
      <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[10px] font-medium text-gray-600">
        Not scanned yet
      </span>
    );
  }

  if (!detection.isNUworksPage) {
    return (
      <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
        Not NUworks
      </span>
    );
  }

  return (
    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
      NUworks ({detection.platform})
    </span>
  );
}

export default function ScannerTab({
  detection,
  extraction,
  isScanning,
  scanProgress,
  isEnriching,
  enrichProgress,
  isScoring,
  scoringProgress,
  scoredJobs,
  allScoredJobs,
  isBusy,
  scanNewOnly,
  showProfileFitOnly,
  dateFilter,
  newJobsCount,
  skippedProcessedCount,
  lastScanDate,
  onToggleScanNewOnly,
  onToggleProfileFitOnly,
  onDateFilterChange,
  onScanCurrentPage,
  onEnrichTopJobs,
  onEnrichTest30Jobs,
  onScoreJobs,
  onSaveJobToSheet,
  onGenerateEmail,
  onChatAboutJob,
  onSaveAllToSheet,
  onExportCsv,
}: ScannerTabProps) {
  const [expandedProfileFit, setExpandedProfileFit] = useState(true);
  const [expandedCurrentPageResults, setExpandedCurrentPageResults] = useState(true);
  const [expandedAllJobs, setExpandedAllJobs] = useState(false);
  
  const jobs = extraction?.jobs ?? [];
  const diagnostics = extraction?.diagnostics;

  return (
    <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
      <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">NUworks Job Scanner</h3>
            <p className="mt-0.5 text-xs text-gray-500">Extract jobs from the current NUworks listing page.</p>
          </div>
          <DetectionBadge detection={detection} />
        </div>

        <button
          onClick={onScanCurrentPage}
          disabled={isScanning || isBusy}
          className={`mt-3 w-full rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
            isScanning || isBusy
              ? 'cursor-not-allowed bg-gray-100 text-gray-400'
              : 'bg-blue-600 text-white hover:bg-blue-700'
          }`}
        >
          {isScanning ? 'Scanning NUworks pages...' : 'Scan NUworks (All Pages)'}
        </button>

        <label className="mt-2 inline-flex items-center gap-2 text-[11px] text-gray-700">
          <input
            type="checkbox"
            checked={scanNewOnly}
            onChange={(e) => onToggleScanNewOnly(e.target.checked)}
            disabled={isBusy}
            className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          Scan New Only
        </label>

        <div className="mt-2">
          <label className="block text-[11px] font-medium text-gray-700">Posted Within</label>
          <select
            value={dateFilter}
            onChange={(e) => onDateFilterChange(e.target.value as 'all' | '24h' | '3d' | '7d')}
            disabled={isBusy}
            className="mt-1 w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-[11px] text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
          >
            <option value="all">All Dates</option>
            <option value="24h">Last 24 Hours</option>
            <option value="3d">Last 3 Days</option>
            <option value="7d">Last 7 Days</option>
          </select>
        </div>

        <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-700">
          <p>{newJobsCount} new jobs since last scan</p>
          <p className="mt-0.5">{skippedProcessedCount} fully processed jobs skipped</p>
          {lastScanDate && (
            <p className="mt-0.5 text-slate-500">
              Last scan: {new Date(lastScanDate).toLocaleString()}
            </p>
          )}
        </div>

        {isScanning && scanProgress && (
          <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-[11px] text-blue-700">
            <p>
              Scanning page {Math.max(1, scanProgress.page)}
              {scanProgress.totalPages ? `/${scanProgress.totalPages}` : ''}
            </p>
            <p className="mt-0.5">Found {scanProgress.jobsFound} jobs so far</p>
          </div>
        )}

        <div className="mt-2 grid grid-cols-2 gap-2">
          <button
            onClick={onEnrichTopJobs}
            disabled={isEnriching || isBusy || jobs.length === 0}
            className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
              isEnriching || isBusy || jobs.length === 0
                ? 'cursor-not-allowed bg-gray-100 text-gray-400'
                : 'bg-violet-600 text-white hover:bg-violet-700'
            }`}
          >
            {isEnriching ? 'Enriching...' : 'Enrich All'}
          </button>
          <button
            onClick={onEnrichTest30Jobs}
            disabled={isEnriching || isBusy || jobs.length === 0}
            className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
              isEnriching || isBusy || jobs.length === 0
                ? 'cursor-not-allowed bg-gray-100 text-gray-400'
                : 'bg-orange-600 text-white hover:bg-orange-700'
            }`}
          >
            {isEnriching ? 'Enriching...' : 'Test: 30 Jobs'}
          </button>
        </div>

        {isEnriching && enrichProgress && (
          <div className="mt-3 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-[11px] text-violet-700">
            Enriching {enrichProgress.current}/{enrichProgress.total} jobs
          </div>
        )}

        <button
          onClick={onScoreJobs}
          disabled={isScoring || isBusy || jobs.length === 0}
          className={`mt-2 w-full rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
            isScoring || isBusy || jobs.length === 0
              ? 'cursor-not-allowed bg-gray-100 text-gray-400'
              : 'bg-emerald-600 text-white hover:bg-emerald-700'
          }`}
        >
          {isScoring ? 'Scoring jobs...' : 'Score and Rank Jobs'}
        </button>

        {isScoring && scoringProgress && (
          <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] text-emerald-700">
            Scoring batch {scoringProgress.batchIndex}/{scoringProgress.totalBatches} • {scoringProgress.scored}/{scoringProgress.total} complete
          </div>
        )}

        {detection && (
          <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-[11px] text-gray-600">
            <p>
              Listing page: <span className="font-medium text-gray-800">{detection.isJobListingPage ? 'Yes' : 'No'}</span>
            </p>
            {detection.indicators.length > 0 && (
              <p className="mt-1">
                Indicators: <span className="font-medium text-gray-800">{detection.indicators.join(', ')}</span>
              </p>
            )}
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <button
          onClick={() => setExpandedCurrentPageResults(!expandedCurrentPageResults)}
          className="flex w-full items-center justify-between rounded p-1 transition-colors hover:bg-gray-50"
        >
          <div className="flex items-center gap-2">
            <svg
              className={`h-4 w-4 transform text-gray-600 transition-transform ${
                expandedCurrentPageResults ? 'rotate-90' : 'rotate-0'
              }`}
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path d="M6.3 2.841A1.5 1.5 0 004.787 4.5v10.5a1.5 1.5 0 001.513 1.659h4.5a1.5 1.5 0 001.513-1.659v-10.5a1.5 1.5 0 00-1.513-1.659h-4.5z" />
            </svg>
            <h4 className="text-xs font-semibold text-gray-900">Current Page Results</h4>
            <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700">
              {jobs.length} found
            </span>
          </div>
        </button>

        {expandedCurrentPageResults && (
          <div className="mt-3">
            {diagnostics && (
              <p className="mb-2 text-[11px] text-gray-500">
                Strategy: {diagnostics.strategyUsed} • Deduped: {diagnostics.deduplicatedCount}
              </p>
            )}

            <JobResultsList
              jobs={jobs}
              actionsDisabled={isBusy}
              onSaveJobToSheet={onSaveJobToSheet}
              onGenerateEmail={onGenerateEmail}
              onChatAboutJob={onChatAboutJob}
            />
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <button
          onClick={() => setExpandedProfileFit(!expandedProfileFit)}
          className="flex w-full items-center justify-between hover:bg-gray-50 p-1 rounded transition-colors"
        >
          <div className="flex items-center gap-2">
            <svg
              className={`h-4 w-4 text-gray-600 transform transition-transform ${
                expandedProfileFit ? 'rotate-90' : 'rotate-0'
              }`}
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path d="M6.3 2.841A1.5 1.5 0 004.787 4.5v10.5a1.5 1.5 0 001.513 1.659h4.5a1.5 1.5 0 001.513-1.659v-10.5a1.5 1.5 0 00-1.513-1.659h-4.5z"/>
            </svg>
            <h4 className="text-xs font-semibold text-gray-900">Profile-Fit Jobs</h4>
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
              {scoredJobs.length}
            </span>
          </div>
        </button>

        {expandedProfileFit && (
          <div className="mt-3 space-y-3">
            <label className="inline-flex items-center gap-2 text-[11px] text-gray-700">
              <input
                type="checkbox"
                checked={showProfileFitOnly}
                onChange={(e) => onToggleProfileFitOnly(e.target.checked)}
                disabled={isBusy}
                className="h-3.5 w-3.5 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
              />
              Show Profile-Fit Jobs Only
            </label>

            <PaginatedJobResultsList
              jobs={scoredJobs}
              pageSize={10}
              actionsDisabled={isBusy}
              onSaveJobToSheet={onSaveJobToSheet}
              onGenerateEmail={onGenerateEmail}
              onChatAboutJob={onChatAboutJob}
              emptyMessage="No profile-fit scored jobs yet. Run Score and Rank Jobs after scanning."
            />
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <button
          onClick={() => setExpandedAllJobs(!expandedAllJobs)}
          className="flex w-full items-center justify-between hover:bg-gray-50 p-1 rounded transition-colors"
        >
          <div className="flex items-center gap-2">
            <svg
              className={`h-4 w-4 text-gray-600 transform transition-transform ${
                expandedAllJobs ? 'rotate-90' : 'rotate-0'
              }`}
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path d="M6.3 2.841A1.5 1.5 0 004.787 4.5v10.5a1.5 1.5 0 001.513 1.659h4.5a1.5 1.5 0 001.513-1.659v-10.5a1.5 1.5 0 00-1.513-1.659h-4.5z"/>
            </svg>
            <h4 className="text-xs font-semibold text-gray-900">All Scored Jobs</h4>
            <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700">
              {allScoredJobs.length}
            </span>
          </div>
        </button>

        {expandedAllJobs && (
          <div className="mt-3">
            <PaginatedJobResultsList
              jobs={allScoredJobs}
              pageSize={10}
              actionsDisabled={isBusy}
              onSaveJobToSheet={onSaveJobToSheet}
              onGenerateEmail={onGenerateEmail}
              onChatAboutJob={onChatAboutJob}
              emptyMessage="No scored jobs yet. Run Score and Rank Jobs after scanning."
            />
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <h4 className="text-xs font-semibold text-gray-900">Batch Actions</h4>
        
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            onClick={onSaveAllToSheet}
            disabled={isBusy || allScoredJobs.length === 0}
            className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
              isBusy || allScoredJobs.length === 0
                ? 'cursor-not-allowed border border-gray-200 bg-gray-100 text-gray-400'
                : 'border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100'
            }`}
          >
            Save All to Sheet
          </button>
          <button
            onClick={onExportCsv}
            disabled={isBusy || allScoredJobs.length === 0}
            className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
              isBusy || allScoredJobs.length === 0
                ? 'cursor-not-allowed border border-gray-200 bg-gray-100 text-gray-400'
                : 'border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
            }`}
          >
            Export CSV
          </button>
        </div>
      </section>
    </div>
  );
}
