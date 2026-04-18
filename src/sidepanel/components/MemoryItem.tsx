import type { Memory } from '../../types/memory';

interface MemoryItemProps {
  memory: Memory;
  onDelete: (id: string) => void;
}

export default function MemoryItem({ memory, onDelete }: MemoryItemProps) {
  const date = new Date(memory.timestamp).toLocaleString();

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-gray-900 leading-snug">{memory.summary}</p>
        <button
          onClick={() => onDelete(memory.id)}
          className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-red-600"
          title="Delete memory"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="mt-2 flex flex-wrap gap-1">
        {memory.company && (
          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700 border border-blue-200">
            {memory.company}
          </span>
        )}
        {memory.role && (
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 border border-emerald-200">
            {memory.role}
          </span>
        )}
        {memory.contentType.map((type) => (
          <span key={`${memory.id}-${type}`} className="rounded-full bg-gray-50 px-2 py-0.5 text-[10px] font-medium text-gray-600 border border-gray-200">
            {type}
          </span>
        ))}
      </div>

      <p className="mt-2 text-[10px] text-gray-400">{date}</p>
    </div>
  );
}
