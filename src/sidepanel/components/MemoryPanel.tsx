import type { Memory, UserPreference } from '../../types/memory';
import MemoryItem from './MemoryItem';
import PreferencesPanel from './PreferencesPanel';

interface MemoryPanelProps {
  memories: Memory[];
  preferences: UserPreference[];
  storageUsageBytes: number;
  maxMemories: number;
  onDeleteMemory: (id: string) => void;
  onClearAll: () => void;
  onDeletePreference: (key: string, value: string) => void;
  onEditPreference: (oldKey: string, oldValue: string, next: { key: string; value: string }) => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export default function MemoryPanel({
  memories,
  preferences,
  storageUsageBytes,
  maxMemories,
  onDeleteMemory,
  onClearAll,
  onDeletePreference,
  onEditPreference,
}: MemoryPanelProps) {
  const usagePercent = Math.min(100, Math.round((memories.length / Math.max(1, maxMemories)) * 100));

  return (
    <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
      <div className="rounded-xl border border-gray-200 bg-white p-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-gray-900">Memory Usage</p>
            <p className="text-[11px] text-gray-500">{memories.length} / {maxMemories} memories • {formatBytes(storageUsageBytes)}</p>
          </div>
          <button
            onClick={onClearAll}
            className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] font-medium text-red-700 hover:bg-red-100"
          >
            Clear All
          </button>
        </div>
        <div className="mt-2 h-2 w-full rounded-full bg-gray-100">
          <div className="h-2 rounded-full bg-blue-500" style={{ width: `${usagePercent}%` }} />
        </div>
      </div>

      <section className="space-y-2">
        <h3 className="text-xs font-semibold text-gray-900">Learned Preferences</h3>
        <PreferencesPanel
          preferences={preferences}
          onDelete={onDeletePreference}
          onEdit={onEditPreference}
        />
      </section>

      <section className="space-y-2">
        <h3 className="text-xs font-semibold text-gray-900">Conversation Memories</h3>
        {memories.length === 0 && (
          <p className="text-xs text-gray-500">No conversation memories yet.</p>
        )}
        {memories.map((memory) => (
          <MemoryItem key={memory.id} memory={memory} onDelete={onDeleteMemory} />
        ))}
      </section>
    </div>
  );
}
