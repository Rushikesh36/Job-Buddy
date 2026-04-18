import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ChatMessage } from '../../lib/types';
import { useState } from 'react';

interface MessageBubbleProps {
  message: ChatMessage;
}

// ── Job analysis parser ────────────────────────────────────────────────────────

interface Skill {
  text: string;
  has: boolean;
}

interface JobAnalysis {
  company: string;
  role: string;
  skills: Skill[];
  atsScore: number | null;
  atsNote: string;
  profileMatchQuality: string;
  profileMatchNote: string;
  applyDecision: string;
  applyNote: string;
  recruiterReachoutDecision: string;
  recruiterReachoutNote: string;
  tailorResumeDecision: string;
  tailorResumeNote: string;
  salary: string;
  unpaidCheck: string;
  unpaidNote: string;
}

function isJobAnalysis(content: string): boolean {
  return content.includes('**Company:**') && content.includes('**Role:**');
}

function parseJobAnalysis(content: string): JobAnalysis {
  const company = content.match(/\*\*Company:\*\*\s*(.+)/)?.[1]?.trim() ?? '';
  const role = content.match(/\*\*Role:\*\*\s*(.+)/)?.[1]?.trim() ?? '';

  // Skills block: everything between "Key Skills Required:" and next "**" section
  const skillsBlock = content.match(/\*\*Key Skills Required:\*\*\n([\s\S]*?)(?=\n\*\*ATS)/)?.[1] ?? '';
  const skills: Skill[] = skillsBlock
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const has = line.includes('✓');
      // strip leading list marker and the checkmark/cross symbol
      const text = line.replace(/^[-*]\s*/, '').replace(/✓|✗/g, '').trim();
      return { text, has };
    })
    .filter((s) => s.text.length > 0);

  // ATS score
  const atsScoreMatch = content.match(/\*\*ATS Match Score:\s*(\d+)\/10\*\*/);
  const atsScore = atsScoreMatch ? parseInt(atsScoreMatch[1], 10) : null;
  const atsNote = content.match(/\*\*ATS Match Score:.*?\*\*\n(.+)/)?.[1]?.trim() ?? '';

  // Profile match quality
  const profileMatchQuality =
    content.match(/\*\*Profile Match Quality:\*\*\s*(.+)/)?.[1]?.trim() ?? '';
  const profileMatchNote =
    content.match(/\*\*Profile Match Quality:\*\*.*\n(.+)/)?.[1]?.trim() ?? '';

  // Apply decision and optional note
  const applyBlock =
    content.match(/\*\*Should You Apply\?\*\*\n([\s\S]*?)(?=\n\*\*|$)/)?.[1]?.trim() ?? '';
  const applyLines = applyBlock.split('\n').map((l) => l.trim()).filter(Boolean);
  const applyDecision = applyLines[0] ?? '';
  const applyNote = applyLines.slice(1).join(' ').trim();

  // Recruiter outreach recommendation
  const recruiterBlock =
    content
      .match(
        /\*\*Should You Find Recruiter Email and Reach Out\?\*\*\n([\s\S]*?)(?=\n\*\*Should You Tailor Resume|\n\n\*\*|$)/
      )?.[1]
      ?.trim() ?? '';
  const recruiterLines = recruiterBlock.split('\n').map((l) => l.trim()).filter(Boolean);
  const recruiterReachoutDecision = recruiterLines[0] ?? '';
  const recruiterReachoutNote = recruiterLines.slice(1).join(' ').trim();

  // Resume tailoring recommendation
  const tailorBlock =
    content
      .match(
        /\*\*Should You Tailor Resume Before Applying\?\*\*\n([\s\S]*?)(?=\n\*\*Salary|\n\n\*\*|$)/
      )?.[1]
      ?.trim() ?? '';
  const tailorLines = tailorBlock.split('\n').map((l) => l.trim()).filter(Boolean);
  const tailorResumeDecision = tailorLines[0] ?? '';
  const tailorResumeNote = tailorLines.slice(1).join(' ').trim();

  // Salary block
  const salary = content.match(/\*\*Salary Range[^*]*\*\*\n([\s\S]*?)(?:\n\n|$)/)?.[1]?.trim() ?? '';

  // Unpaid check
  const unpaidBlock =
    content.match(/\*\*Unpaid Check:\*\*\n([\s\S]*?)(?:\n\n|$)/)?.[1]?.trim() ?? '';
  const unpaidLines = unpaidBlock.split('\n').map((l) => l.trim()).filter(Boolean);
  const unpaidCheck = unpaidLines[0] ?? '';
  const unpaidNote = unpaidLines.slice(1).join(' ').trim();

  return {
    company,
    role,
    skills,
    atsScore,
    atsNote,
    profileMatchQuality,
    profileMatchNote,
    applyDecision,
    applyNote,
    recruiterReachoutDecision,
    recruiterReachoutNote,
    tailorResumeDecision,
    tailorResumeNote,
    salary,
    unpaidCheck,
    unpaidNote,
  };
}

// ── Job Analysis Card ──────────────────────────────────────────────────────────

function JobAnalysisCard({ content }: { content: string }) {
  const d = parseJobAnalysis(content);
  const isYes = /^yes/i.test(d.applyDecision);
  const isNo = /^no/i.test(d.applyDecision);
  const shouldReachOut = /^yes/i.test(d.recruiterReachoutDecision);
  const shouldTailor = /^yes/i.test(d.tailorResumeDecision);
  const isUnpaid = /^unpaid/i.test(d.unpaidCheck);

  const atsColor =
    d.atsScore === null ? 'bg-gray-400'
    : d.atsScore >= 7   ? 'bg-emerald-500'
    : d.atsScore >= 4   ? 'bg-amber-400'
    : 'bg-red-400';

  const atsBg =
    d.atsScore === null ? 'text-gray-600'
    : d.atsScore >= 7   ? 'text-emerald-700'
    : d.atsScore >= 4   ? 'text-amber-700'
    : 'text-red-700';

  return (
    <div className="w-full text-sm text-gray-900 space-y-3">

      {/* Header: company + role + apply badge */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wide leading-none mb-0.5">
            {d.company || 'Company'}
          </p>
          <p className="font-semibold text-gray-900 leading-snug">
            {d.role || 'Role'}
          </p>
        </div>
        {d.applyDecision && (
          <span
            className={`flex-shrink-0 px-2.5 py-1 rounded-full text-xs font-bold tracking-wide ${
              isYes
                ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                : isNo
                ? 'bg-red-100 text-red-600 border border-red-200'
                : 'bg-amber-100 text-amber-700 border border-amber-200'
            }`}
          >
            {isYes ? '✓ Apply' : isNo ? '✗ Skip' : d.applyDecision}
          </span>
        )}
      </div>

      {d.applyNote && (
        <p className="text-xs text-gray-500 -mt-1 leading-snug">{d.applyNote}</p>
      )}

      {/* ATS Score */}
      {d.atsScore !== null && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium text-gray-600">ATS Match</span>
            <span className={`text-xs font-bold ${atsBg}`}>{d.atsScore}/10</span>
          </div>
          <div className="h-1.5 w-full bg-gray-200 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${atsColor}`}
              style={{ width: `${(d.atsScore / 10) * 100}%` }}
            />
          </div>
          {d.atsNote && (
            <p className="text-[11px] text-gray-400 mt-1 leading-snug">{d.atsNote}</p>
          )}
        </div>
      )}

      {/* Profile match quality */}
      {d.profileMatchQuality && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
          <p className="text-[10px] font-semibold text-blue-500 uppercase tracking-wide mb-0.5">
            Profile Match Quality
          </p>
          <p className="text-xs font-semibold text-blue-800 leading-snug">{d.profileMatchQuality}</p>
          {d.profileMatchNote && (
            <p className="text-[11px] text-blue-700 mt-0.5 leading-snug">{d.profileMatchNote}</p>
          )}
        </div>
      )}

      {/* Recruiter outreach + tailoring recommendations */}
      {(d.recruiterReachoutDecision || d.tailorResumeDecision) && (
        <div className="grid grid-cols-1 gap-2">
          {d.recruiterReachoutDecision && (
            <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">
                Reach Out To Recruiter?
              </p>
              <p className={`text-xs font-semibold ${shouldReachOut ? 'text-emerald-700' : 'text-red-700'}`}>
                {d.recruiterReachoutDecision}
              </p>
              {d.recruiterReachoutNote && (
                <p className="text-[11px] text-gray-600 mt-0.5 leading-snug">{d.recruiterReachoutNote}</p>
              )}
            </div>
          )}

          {d.tailorResumeDecision && (
            <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">
                Tailor Resume Before Applying?
              </p>
              <p className={`text-xs font-semibold ${shouldTailor ? 'text-amber-700' : 'text-emerald-700'}`}>
                {d.tailorResumeDecision}
              </p>
              {d.tailorResumeNote && (
                <p className="text-[11px] text-gray-600 mt-0.5 leading-snug">{d.tailorResumeNote}</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Skills */}
      {d.skills.length > 0 && (
        <div>
          <p className="text-xs font-medium text-gray-600 mb-1.5">Key Skills</p>
          <div className="flex flex-wrap gap-1.5">
            {d.skills.map((skill, i) => (
              <span
                key={i}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium border ${
                  skill.has
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : 'bg-red-50 text-red-600 border-red-200'
                }`}
              >
                {skill.has ? '✓' : '✗'} {skill.text}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Salary */}
      {d.salary && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">
            Salary (OPT / CPT / H-1B)
          </p>
          <p className="text-xs text-gray-700 leading-snug">{d.salary}</p>
        </div>
      )}

      {/* Unpaid check (always at bottom when present) */}
      {d.unpaidCheck && (
        <div
          className={`rounded-lg px-3 py-2 border ${
            isUnpaid
              ? 'bg-red-50 border-red-200'
              : 'bg-emerald-50 border-emerald-200'
          }`}
        >
          <p
            className={`text-[10px] font-semibold uppercase tracking-wide mb-0.5 ${
              isUnpaid ? 'text-red-500' : 'text-emerald-600'
            }`}
          >
            Compensation Status
          </p>
          <p className={`text-xs font-bold ${isUnpaid ? 'text-red-700' : 'text-emerald-700'}`}>
            {d.unpaidCheck}
          </p>
          {d.unpaidNote && (
            <p className={`text-[11px] mt-0.5 leading-snug ${isUnpaid ? 'text-red-700' : 'text-emerald-700'}`}>
              {d.unpaidNote}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main MessageBubble ─────────────────────────────────────────────────────────

export default function MessageBubble({ message }: MessageBubbleProps) {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === 'user';
  const isAnalysis = !isUser && isJobAnalysis(message.content);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const time = message.timestamp
    ? new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '';

  return (
    <div className={`group flex w-full mb-3 ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`relative ${isUser ? 'max-w-[85%]' : 'w-full'} flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>

        {/* Bubble */}
        <div
          className={`w-full px-3 py-2.5 rounded-xl text-sm leading-relaxed break-words ${
            isUser
              ? 'bg-blue-600 text-white rounded-br-sm'
              : isAnalysis
              ? 'bg-white border border-gray-200 rounded-bl-sm shadow-sm'
              : 'bg-gray-100 text-gray-900 rounded-bl-sm'
          }`}
        >
          {isUser ? (
            <p className="whitespace-pre-wrap">{message.content}</p>
          ) : isAnalysis ? (
            <JobAnalysisCard content={message.content} />
          ) : (
            <div className="prose prose-sm max-w-none prose-p:my-1 prose-li:my-0.5 prose-headings:mt-2 prose-headings:mb-1 prose-pre:bg-gray-200 prose-pre:rounded prose-code:bg-gray-200 prose-code:px-1 prose-code:rounded prose-code:before:content-none prose-code:after:content-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {message.content}
              </ReactMarkdown>
            </div>
          )}
        </div>

        {/* Timestamp + copy */}
        <div
          className={`flex items-center gap-2 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity ${
            isUser ? 'flex-row-reverse' : 'flex-row'
          }`}
        >
          <span className="text-[10px] text-gray-400">{time}</span>
          {!isUser && (
            <button
              onClick={handleCopy}
              title="Copy message"
              className="text-[10px] text-gray-400 hover:text-gray-600 flex items-center gap-0.5 transition-colors"
            >
              {copied ? (
                <>
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Copied
                </>
              ) : (
                <>
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  Copy
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
