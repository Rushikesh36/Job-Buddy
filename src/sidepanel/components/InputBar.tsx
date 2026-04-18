import { useRef, useEffect, type KeyboardEvent, type ChangeEvent } from 'react';

interface InputBarProps {
  value: string;
  onChange: (val: string) => void;
  onSend: () => void;
  onReadPage: () => void;
  onAnalyzeJob: () => void;
  onSaveToSheet: () => void;
  onComposeEmail: () => void;
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
  onComposeEmail,
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
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M16.6915026,12.4744748 L3.50612381,13.2599618 C3.19218622,13.2599618 3.03521743,13.4170592 3.03521743,13.5741566 L1.15159189,20.0151496 C0.8376543,20.8006365 0.99,21.89 1.77946707,22.52 C2.41,22.99 3.50612381,23.1 4.13399899,22.8429026 L21.714504,14.0454487 C22.6563168,13.5741566 23.1272231,12.6315722 22.6563168,11.5741566 L4.13399899,1.16619694 C3.34915502,0.9 2.40734225,0.9 1.77946707,1.4429026 C0.994623095,2.0271654 0.837654299,3.1165974 1.15159189,3.90208769 L3.03521743,10.3430836 C3.03521743,10.5 3.19218622,10.6571007 3.50612381,10.6571007 L16.6915026,11.4425824 C16.6915026,11.4425824 17.1624089,11.4425824 17.1624089,12.0274145 C17.1624089,12.4744748 16.6915026,12.4744748 16.6915026,12.4744748 Z" />
              </svg>
            )}
          </button>
        </div>

        {/* Quick actions */}
        <div className="flex items-center gap-3 justify-center">
          {/* Read Page Button */}
          <button
            onClick={onReadPage}
            disabled={isReadingPage}
            className={`relative group flex items-center justify-center w-12 h-12 rounded-full transition-all duration-300 ${
              isReadingPage
                ? 'bg-gradient-to-br from-blue-400 to-cyan-400 text-white shadow-md cursor-not-allowed'
                : 'bg-gradient-to-br from-blue-500 to-cyan-500 text-white hover:shadow-lg hover:scale-110 active:scale-95 shadow-md'
            }`}
            title="Read Page"
          >
            {isReadingPage ? (
              <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
              </svg>
            ) : (
              <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
            )}
            <span className="absolute bottom-full mb-2 px-2 py-1 bg-gray-900 text-white text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
              Read Page
            </span>
          </button>

          {/* Analyze Job Button */}
          <button
            onClick={onAnalyzeJob}
            disabled={!canAnalyzeJob}
            className={`relative group flex items-center justify-center w-12 h-12 rounded-full transition-all duration-300 ${
              canAnalyzeJob
                ? 'bg-gradient-to-br from-purple-500 to-indigo-500 text-white hover:shadow-lg hover:scale-110 active:scale-95 shadow-md'
                : 'bg-gray-300 text-gray-500 cursor-not-allowed'
            }`}
            title="Analyze Job"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="absolute bottom-full mb-2 px-2 py-1 bg-gray-900 text-white text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
              Analyze Job
            </span>
          </button>

          {/* Save to Sheet Button */}
          <button
            onClick={onSaveToSheet}
            disabled={!canSaveToSheet || isExtractingJob}
            className={`relative group flex items-center justify-center w-12 h-12 rounded-full transition-all duration-300 ${
              canSaveToSheet && !isExtractingJob
                ? 'bg-gradient-to-br from-emerald-500 to-teal-500 text-white hover:shadow-lg hover:scale-110 active:scale-95 shadow-md'
                : 'bg-gray-300 text-gray-500 cursor-not-allowed'
            }`}
            title="Save to Sheet"
          >
            {isExtractingJob ? (
              <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
              </svg>
            ) : (
              <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            )}
            <span className="absolute bottom-full mb-2 px-2 py-1 bg-gray-900 text-white text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
              Save to Sheet
            </span>
          </button>

          {/* Compose Email Button */}
          <button
            onClick={onComposeEmail}
            className="relative group flex items-center justify-center w-12 h-12 rounded-full transition-all duration-300 bg-gradient-to-br from-red-500 to-pink-500 text-white hover:shadow-lg hover:scale-110 active:scale-95 shadow-md"
            title="Compose Email"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            <span className="absolute bottom-full mb-2 px-2 py-1 bg-gray-900 text-white text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
              Compose Email
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
