import { useEffect, useRef } from 'react';
import type { ChatMessage } from '../../lib/types';
import MessageBubble from './MessageBubble';

const SUGGESTED_PROMPTS = [
  'Analyze this job description and match it to my profile',
  'Write a cold email to the hiring manager',
  'What questions should I prepare for this company?',
  'Draft a cover letter for this role',
];

interface ChatWindowProps {
  messages: ChatMessage[];
  isLoading: boolean;
  onSuggestedPrompt: (prompt: string) => void;
}

export default function ChatWindow({
  messages,
  isLoading,
  onSuggestedPrompt,
}: ChatWindowProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const showWelcome = messages.length === 0;

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto px-3 py-3 scroll-smooth"
    >
      {showWelcome ? (
        <div className="flex flex-col items-center justify-center h-full min-h-[200px] gap-4 text-center">
          {/* Logo mark */}
          <div className="w-12 h-12 rounded-2xl bg-blue-600 flex items-center justify-center shadow-md">
            <span className="text-white text-xl font-bold tracking-tight">J</span>
          </div>
          <div>
            <h2 className="text-base font-semibold text-gray-900 mb-0.5">
              JobBuddy AI
            </h2>
            <p className="text-xs text-gray-500 max-w-[200px]">
              Your personal job application assistant. Try one of these:
            </p>
          </div>
          <div className="flex flex-col gap-2 w-full max-w-[280px]">
            {SUGGESTED_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                onClick={() => onSuggestedPrompt(prompt)}
                className="text-left text-xs text-gray-700 bg-white border border-gray-200 rounded-xl px-3 py-2.5 hover:border-blue-300 hover:text-blue-700 hover:bg-blue-50 transition-all shadow-sm"
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <>
          {messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}
          {/* Loading indicator: three dots */}
          {isLoading && messages[messages.length - 1]?.role === 'user' && (
            <div className="flex justify-start mb-3">
              <div className="bg-gray-100 rounded-xl rounded-bl-sm px-4 py-3 flex gap-1 items-center">
                {[0, 150, 300].map((delay) => (
                  <span
                    key={delay}
                    className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce"
                    style={{ animationDelay: `${delay}ms` }}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}
      <div ref={bottomRef} />
    </div>
  );
}
