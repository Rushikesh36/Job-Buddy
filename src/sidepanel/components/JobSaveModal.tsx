import { useMemo } from 'react';
import type { ChangeEvent } from 'react';
import { JOB_STATUS_OPTIONS, VISA_SPONSORSHIP_OPTIONS, type JobData } from '../../types/job';

interface JobSaveModalProps {
  isOpen: boolean;
  draft: JobData | null;
  resumeVersions: string[];
  isSaving: boolean;
  onClose: () => void;
  onChange: (next: JobData) => void;
  onSave: () => void;
}

export default function JobSaveModal({
  isOpen,
  draft,
  resumeVersions,
  isSaving,
  onClose,
  onChange,
  onSave,
}: JobSaveModalProps) {
  const versionOptions = useMemo(() => {
    return resumeVersions.length ? resumeVersions : ['default'];
  }, [resumeVersions]);

  if (!isOpen || !draft) return null;

  const updateField = <K extends keyof JobData>(field: K, value: JobData[K]) => {
    onChange({ ...draft, [field]: value });
  };

  const handleRequirementChange = (index: number, e: ChangeEvent<HTMLInputElement>) => {
    const next = [...draft.keyRequirements];
    next[index] = e.target.value;
    updateField('keyRequirements', next);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 px-3 py-4">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white shadow-xl max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3">
          <h3 className="text-sm font-semibold text-gray-900">Save Job to Google Sheets</h3>
          <button
            onClick={onClose}
            disabled={isSaving}
            className="rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
            aria-label="Close modal"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-3 px-4 py-4">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-700">Date Applied</span>
            <input
              type="date"
              value={draft.dateApplied.slice(0, 10)}
              onChange={(e) => updateField('dateApplied', new Date(e.target.value).toISOString())}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-xs outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
            />
          </label>

          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-gray-700">Company</span>
              <input
                value={draft.company}
                onChange={(e) => updateField('company', e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-xs outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-medium text-gray-700">Role</span>
              <input
                value={draft.role}
                onChange={(e) => updateField('role', e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-xs outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
              />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-gray-700">Location</span>
              <input
                value={draft.location}
                onChange={(e) => updateField('location', e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-xs outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-medium text-gray-700">Job ID</span>
              <input
                value={draft.jobId}
                onChange={(e) => updateField('jobId', e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-xs outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
              />
            </label>
          </div>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-700">Job URL</span>
            <input
              value={draft.jobUrl}
              onChange={(e) => updateField('jobUrl', e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-xs outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-700">Salary Range</span>
            <input
              value={draft.salaryRange}
              onChange={(e) => updateField('salaryRange', e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-xs outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
            />
          </label>

          <div className="grid grid-cols-3 gap-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-gray-700">Visa Sponsorship</span>
              <select
                value={draft.visaSponsorship}
                onChange={(e) => updateField('visaSponsorship', e.target.value as JobData['visaSponsorship'])}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-xs outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 bg-white"
              >
                {VISA_SPONSORSHIP_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-medium text-gray-700">ATS Score</span>
              <input
                type="number"
                min={0}
                max={10}
                step={0.1}
                value={draft.atsScore}
                onChange={(e) => updateField('atsScore', Number(e.target.value))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-xs outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-medium text-gray-700">Status</span>
              <select
                value={draft.status}
                onChange={(e) => updateField('status', e.target.value as JobData['status'])}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-xs outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 bg-white"
              >
                {JOB_STATUS_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-700">Resume Version Used</span>
            <select
              value={draft.resumeVersion}
              onChange={(e) => updateField('resumeVersion', e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-xs outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 bg-white"
            >
              {versionOptions.map((version) => (
                <option key={version} value={version}>
                  {version}
                </option>
              ))}
            </select>
          </label>

          <div>
            <span className="mb-1 block text-xs font-medium text-gray-700">Key Requirements (Top 5)</span>
            <div className="space-y-2">
              {[0, 1, 2, 3, 4].map((idx) => (
                <input
                  key={idx}
                  value={draft.keyRequirements[idx] ?? ''}
                  onChange={(e) => handleRequirementChange(idx, e)}
                  placeholder={`Requirement ${idx + 1}`}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-xs outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
                />
              ))}
            </div>
          </div>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-700">Notes</span>
            <textarea
              value={draft.notes}
              onChange={(e) => updateField('notes', e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-xs outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 resize-y"
              placeholder="Optional notes"
            />
          </label>
        </div>

        <div className="sticky bottom-0 z-10 flex items-center justify-end gap-2 border-t border-gray-200 bg-white px-4 py-3">
          <button
            onClick={onClose}
            disabled={isSaving}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={onSave}
            disabled={isSaving}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold text-white ${
              isSaving ? 'bg-blue-300 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {isSaving ? 'Saving...' : 'Save to Sheet'}
          </button>
        </div>
      </div>
    </div>
  );
}
