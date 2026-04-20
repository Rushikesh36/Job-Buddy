import type { OutreachEmailType } from '../../types/email';

interface EmailTypeSelectorProps {
  value: OutreachEmailType;
  confidence?: number | null;
  disabled?: boolean;
  onChange: (value: OutreachEmailType) => void;
}

const OPTIONS: Array<{ value: OutreachEmailType; label: string }> = [
  { value: 'cold-recruiter', label: 'Cold Recruiter' },
  { value: 'follow-up', label: 'Follow-Up' },
  { value: 'linkedin-connection', label: 'LinkedIn Connect' },
  { value: 'linkedin-post-connection', label: 'LinkedIn Post-Connect' },
  { value: 'thank-you-post-interview', label: 'Post-Interview Thank You' },
  { value: 'networking-informational', label: 'Networking / Informational' },
  { value: 'referral-request', label: 'Referral Request' },
];

export default function EmailTypeSelector({ value, confidence, disabled, onChange }: EmailTypeSelectorProps) {
  const confidencePct = typeof confidence === 'number' ? Math.round(confidence * 100) : null;

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[11px] font-medium text-gray-700">Email Type</span>
        {confidencePct !== null && (
          <span className="text-[10px] text-gray-500">Auto-detect confidence: {confidencePct}%</span>
        )}
      </div>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as OutreachEmailType)}
        className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:cursor-not-allowed disabled:bg-gray-100"
      >
        {OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
