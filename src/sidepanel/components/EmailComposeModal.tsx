import { useState } from 'react';
import type { EmailDraft, OutreachEmailType } from '../../types/email';
import EmailTypeSelector from './EmailTypeSelector';
import EmailPreview from './EmailPreview';

interface EmailComposeModalProps {
  isOpen: boolean;
  draft: EmailDraft | null;
  resumeVersions: string[];
  emailType: OutreachEmailType;
  emailTypeConfidence?: number | null;
  recipientSuggestions?: string[];
  isBusy: boolean;
  onClose: () => void;
  onEmailTypeChange: (type: OutreachEmailType) => void;
  onRegenerate: () => void;
  onMakeShorter: () => void;
  onMakeLonger: () => void;
  onMoreFormal: () => void;
  onMoreCasual: () => void;
  onChange: (draft: EmailDraft) => void;
  onSend: () => void;
  onSaveDraft: () => void;
}

export default function EmailComposeModal({
  isOpen,
  draft,
  resumeVersions,
  emailType,
  emailTypeConfidence,
  recipientSuggestions = [],
  isBusy,
  onClose,
  onEmailTypeChange,
  onRegenerate,
  onMakeShorter,
  onMakeLonger,
  onMoreFormal,
  onMoreCasual,
  onChange,
  onSend,
  onSaveDraft,
}: EmailComposeModalProps) {
  const [showCcBcc, setShowCcBcc] = useState(false);

  if (!isOpen || !draft) return null;

  const update = <K extends keyof EmailDraft>(key: K, value: EmailDraft[K]) => {
    onChange({ ...draft, [key]: value });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 px-3 py-4">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white shadow-xl max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3">
          <h3 className="text-sm font-semibold text-gray-900">Compose Gmail Message</h3>
          <button
            onClick={onClose}
            disabled={isBusy}
            className="rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-3 px-4 py-4">
          <EmailTypeSelector
            value={emailType}
            confidence={emailTypeConfidence}
            disabled={isBusy}
            onChange={onEmailTypeChange}
          />

          <EmailPreview
            draft={draft}
            disabled={isBusy}
            onRegenerate={onRegenerate}
            onMakeShorter={onMakeShorter}
            onMakeLonger={onMakeLonger}
            onMoreFormal={onMoreFormal}
            onMoreCasual={onMoreCasual}
          />

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-700">To</span>
            <input
              value={draft.to}
              onChange={(e) => update('to', e.target.value)}
              placeholder="recruiter@company.com"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-xs outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
            />
            {recipientSuggestions.length > 0 && (
              <div className="mt-2">
                <p className="text-[11px] text-gray-500">Suggested from job page:</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {recipientSuggestions.map((email) => (
                    <button
                      key={email}
                      type="button"
                      onClick={() => update('to', email)}
                      className={`rounded-full border px-2 py-0.5 text-[11px] ${
                        draft.to.trim().toLowerCase() === email.toLowerCase()
                          ? 'border-blue-300 bg-blue-50 text-blue-700'
                          : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      {email}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </label>

          <button
            onClick={() => setShowCcBcc((v) => !v)}
            className="text-xs text-blue-700 hover:text-blue-800"
          >
            {showCcBcc ? 'Hide CC/BCC' : 'Add CC/BCC'}
          </button>

          {showCcBcc && (
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-gray-700">CC</span>
                <input
                  value={draft.cc ?? ''}
                  onChange={(e) => update('cc', e.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-xs outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-gray-700">BCC</span>
                <input
                  value={draft.bcc ?? ''}
                  onChange={(e) => update('bcc', e.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-xs outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
                />
              </label>
            </div>
          )}

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-700">Subject</span>
            <input
              value={draft.subject}
              onChange={(e) => update('subject', e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-xs outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
            />
          </label>

          <div className="flex items-center justify-between">
            <label className="inline-flex items-center gap-2 text-xs text-gray-700">
              <input
                type="checkbox"
                checked={draft.isHtml}
                onChange={(e) => update('isHtml', e.target.checked)}
                className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              Rich text (HTML)
            </label>

            <label className="inline-flex items-center gap-2 text-xs text-gray-700">
              <input
                type="checkbox"
                checked={draft.attachResume}
                onChange={(e) => update('attachResume', e.target.checked)}
                className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              Attach Resume
            </label>
          </div>

          {draft.attachResume && (
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-gray-700">Resume Version</span>
              <select
                value={draft.resumeVersion ?? resumeVersions[0] ?? 'default'}
                onChange={(e) => update('resumeVersion', e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-xs outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 bg-white"
              >
                {resumeVersions.map((version) => (
                  <option key={version} value={version}>
                    {version}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-700">Body</span>
            <textarea
              value={draft.body}
              onChange={(e) => update('body', e.target.value)}
              rows={11}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-xs outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 resize-y"
            />
          </label>
        </div>

        <div className="sticky bottom-0 z-10 flex items-center justify-end gap-2 border-t border-gray-200 bg-white px-4 py-3">
          <button
            onClick={onSaveDraft}
            disabled={isBusy}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
              isBusy ? 'cursor-not-allowed border-gray-200 bg-gray-100 text-gray-400' : 'border-gray-200 text-gray-700 hover:bg-gray-50'
            }`}
          >
            Save as Draft
          </button>
          <button
            onClick={onSend}
            disabled={isBusy}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold text-white ${
              isBusy ? 'cursor-not-allowed bg-blue-300' : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {isBusy ? 'Sending...' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}
