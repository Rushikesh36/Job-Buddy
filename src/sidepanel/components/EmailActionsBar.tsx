interface EmailActionsBarProps {
  onSendViaGmail: () => void;
  onEditAndSend: () => void;
  onCopy: () => void;
}

export default function EmailActionsBar({ onSendViaGmail, onEditAndSend, onCopy }: EmailActionsBarProps) {
  return (
    <div className="mt-1 mb-2 ml-1 flex flex-wrap items-center gap-1.5">
      <button
        onClick={onSendViaGmail}
        className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700 hover:bg-emerald-100"
      >
        Send via Gmail
      </button>
      <button
        onClick={onEditAndSend}
        className="rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-medium text-blue-700 hover:bg-blue-100"
      >
        Edit & Send
      </button>
      <button
        onClick={onCopy}
        className="rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50"
      >
        Copy
      </button>
    </div>
  );
}
