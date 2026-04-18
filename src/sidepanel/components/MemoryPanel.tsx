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
  onExportBackup: () => void;
  onImportBackup: () => void;
  onCopyBackup: () => void;
  lastBackupDate: string | null;
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
  onExportBackup,
  onImportBackup,
  onCopyBackup,
  lastBackupDate,
}: MemoryPanelProps) {
  const usagePercent = Math.min(100, Math.round((memories.length / Math.max(1, maxMemories)) * 100));
  const lastBackupLabel = lastBackupDate === new Date().toISOString().slice(0, 10)
    ? 'today'
    : lastBackupDate
      ? new Date(lastBackupDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
      : 'not yet';

  return (
    <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-2">
                <p className="text-xs font-semibold text-gray-900">Memory Usage</p>
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">
                  backed up
                </span>
              </div>
              <p className="text-[11px] leading-4 text-gray-500">
                {memories.length} / {maxMemories} memories • {formatBytes(storageUsageBytes)} stored
              </p>
              <p className="max-w-md text-[11px] leading-4 text-gray-400">
                Backed up to Chrome Sync when available, so it can recover after reloads or reinstalls.
              </p>
              <p className="text-[11px] leading-4 text-gray-400">Last daily backup: {lastBackupLabel}</p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={onCopyBackup}
              className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-[11px] font-medium text-violet-700 transition-colors hover:bg-violet-100"
            >
              Copy JSON
            </button>
            <button
              onClick={onExportBackup}
              className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-[11px] font-medium text-blue-700 transition-colors hover:bg-blue-100"
            >
              Export
            </button>
            <button
              onClick={onImportBackup}
              className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-[11px] font-medium text-indigo-700 transition-colors hover:bg-indigo-100"
            >
              Import
            </button>
            <button
              onClick={onClearAll}
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-[11px] font-medium text-red-700 transition-colors hover:bg-red-100"
            >
              Clear All
            </button>
          </div>

          <div className="space-y-1.5">
            <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
              <div className="h-2 rounded-full bg-gradient-to-r from-blue-500 to-indigo-500" style={{ width: `${usagePercent}%` }} />
            </div>
            {storageUsageBytes < 1024 && (
              <p className="text-[11px] leading-4 text-gray-400">
                Memory is still effectively empty. It grows after conversations are summarized and preferences are learned.
              </p>
            )}
          </div>
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
