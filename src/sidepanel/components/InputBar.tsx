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
              <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z" />
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
            <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
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
              <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2V17zm4 0h-2V7h2V17zm4 0h-2v-4h2V17z" />
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
            <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
              <path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z" />
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
