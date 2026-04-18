import { useRef, useEffect, type KeyboardEvent, type ChangeEvent } from 'react';

interface InputBarProps {
  value: string;
  onChange: (val: string) => void;
  onSend: () => void;
  onReadPage: () => void;
  onAnalyzeJob: () => void;
  onSaveToSheet: () => void;
  isLoading: boolean;
  isReadingPage: boolean;
  isExtractingJob: boolean;
  hasPageContext: boolean;
  canSaveToSheet: boolean;
}

export default function InputBar({
  value,
  onChange,
  onSend,
  onReadPage,
  onAnalyzeJob,
  onSaveToSheet,
  isLoading,
  isReadingPage,
  isExtractingJob,
  hasPageContext,
  canSaveToSheet,
}: InputBarProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const maxH = 96; // ~4 lines
    el.style.height = Math.min(el.scrollHeight, maxH) + 'px';
  }, [value]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!isLoading && value.trim()) onSend();
    }
  };

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value);
  };

  const canSend = !isLoading && value.trim().length > 0;
  const canAnalyzeJob = !isLoading && !isReadingPage && hasPageContext;

  return (
    <div className="border-t border-gray-200 bg-white px-3 pt-2 pb-3">
      <div className="flex flex-col gap-2">
        {/* Textarea row */}
        <div className="flex items-end gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 focus-within:border-blue-400 focus-within:ring-1 focus-within:ring-blue-400 transition-all">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder="Ask about this job, write a cold email..."
            rows={1}
            className="flex-1 bg-transparent text-sm text-gray-900 placeholder-gray-400 resize-none outline-none min-h-[20px] max-h-24 leading-5"
            disabled={isLoading}
          />
          {/* Send button */}
          <button
            onClick={onSend}
            disabled={!canSend}
            className={`flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-all ${
              canSend
                ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-sm'
                : 'bg-gray-200 text-gray-400 cursor-not-allowed'
            }`}
            title="Send message (Enter)"
          >
            {isLoading ? (
              <svg
                className="w-4 h-4 animate-spin"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z"
                />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                />
              </svg>
            )}
          </button>
        </div>

        {/* Quick actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={onReadPage}
            disabled={isReadingPage}
            className={`self-start flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-all ${
              isReadingPage
                ? 'border-blue-200 text-blue-400 bg-blue-50 cursor-not-allowed'
                : 'border-gray-200 text-gray-600 hover:border-blue-300 hover:text-blue-600 hover:bg-blue-50 bg-white'
            }`}
          >
            {isReadingPage ? (
              <>
                <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
                </svg>
                Reading...
              </>
            ) : (
              <>
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
                Read Page
              </>
            )}
          </button>

          <button
            onClick={onAnalyzeJob}
            disabled={!canAnalyzeJob}
            className={`self-start flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-all ${
              canAnalyzeJob
                ? 'border-blue-200 text-blue-700 bg-blue-50 hover:bg-blue-100 hover:border-blue-300'
                : 'border-gray-200 text-gray-400 bg-gray-50 cursor-not-allowed'
            }`}
            title={hasPageContext ? 'Analyze current job page' : 'Read page first to analyze'}
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-6m3 6V7m3 10v-3m2 5H7a2 2 0 01-2-2V7a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V17a2 2 0 01-2 2z" />
            </svg>
            Analyze Job
          </button>

          <button
            onClick={onSaveToSheet}
            disabled={!canSaveToSheet || isExtractingJob}
            className={`self-start flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-all ${
              canSaveToSheet && !isExtractingJob
                ? 'border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 hover:border-emerald-300'
                : 'border-gray-200 text-gray-400 bg-gray-50 cursor-not-allowed'
            }`}
            title="Extract fields and save this job to your Google Sheet"
          >
            {isExtractingJob ? (
              <>
                <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
                </svg>
                Extracting...
              </>
            ) : (
              <>
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-6m3 6V7m3 10v-3m2 5H7a2 2 0 01-2-2V7a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V17a2 2 0 01-2 2z" />
                </svg>
                Save to Sheet
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
