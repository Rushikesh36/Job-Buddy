import type { EmailDraft } from '../../types/email';

interface EmailPreviewProps {
  draft: EmailDraft;
  disabled?: boolean;
  onRegenerate: () => void;
  onMakeShorter: () => void;
  onMakeLonger: () => void;
  onMoreFormal: () => void;
  onMoreCasual: () => void;
}

function wordCount(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

export default function EmailPreview({
  draft,
  disabled,
  onRegenerate,
  onMakeShorter,
  onMakeLonger,
  onMoreFormal,
  onMoreCasual,
}: EmailPreviewProps) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-medium text-gray-700">Email Preview Controls</span>
        <span className="text-[10px] text-gray-500">{wordCount(draft.body)} words</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={onRegenerate}
          disabled={disabled}
          className="rounded border border-gray-300 bg-white px-2 py-1 text-[11px] text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Regenerate
        </button>
        <button
          type="button"
          onClick={onMakeShorter}
          disabled={disabled}
          className="rounded border border-gray-300 bg-white px-2 py-1 text-[11px] text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Make Shorter
        </button>
        <button
          type="button"
          onClick={onMakeLonger}
          disabled={disabled}
          className="rounded border border-gray-300 bg-white px-2 py-1 text-[11px] text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Make Longer
        </button>
        <button
          type="button"
          onClick={onMoreFormal}
          disabled={disabled}
          className="rounded border border-gray-300 bg-white px-2 py-1 text-[11px] text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60"
        >
          More Formal
        </button>
        <button
          type="button"
          onClick={onMoreCasual}
          disabled={disabled}
          className="rounded border border-gray-300 bg-white px-2 py-1 text-[11px] text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60"
        >
          More Casual
        </button>
      </div>
    </div>
  );
}
