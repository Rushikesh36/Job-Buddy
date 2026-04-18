import { useState } from 'react';
import type { UserPreference } from '../../types/memory';

interface PreferencesPanelProps {
  preferences: UserPreference[];
  onDelete: (key: string, value: string) => void;
  onEdit: (oldKey: string, oldValue: string, next: { key: string; value: string }) => void;
}

export default function PreferencesPanel({ preferences, onDelete, onEdit }: PreferencesPanelProps) {
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState('');
  const [valueInput, setValueInput] = useState('');

  const startEdit = (item: UserPreference) => {
    const id = `${item.key}::${item.value}`;
    setEditingKey(id);
    setKeyInput(item.key);
    setValueInput(item.value);
  };

  const stopEdit = () => {
    setEditingKey(null);
    setKeyInput('');
    setValueInput('');
  };

  return (
    <div className="space-y-2">
      {preferences.length === 0 && (
        <p className="text-xs text-gray-500">No learned preferences yet.</p>
      )}

      {preferences.map((item) => {
        const id = `${item.key}::${item.value}`;
        const isEditing = editingKey === id;

        return (
          <div key={id} className="rounded-lg border border-gray-200 bg-white p-2">
            {isEditing ? (
              <div className="space-y-2">
                <input
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  className="w-full rounded-md border border-gray-200 px-2 py-1 text-xs outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
                />
                <input
                  value={valueInput}
                  onChange={(e) => setValueInput(e.target.value)}
                  className="w-full rounded-md border border-gray-200 px-2 py-1 text-xs outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
                />
                <div className="flex items-center justify-end gap-2">
                  <button onClick={stopEdit} className="text-xs text-gray-500 hover:text-gray-700">Cancel</button>
                  <button
                    onClick={() => {
                      if (!keyInput.trim() || !valueInput.trim()) return;
                      onEdit(item.key, item.value, { key: keyInput.trim(), value: valueInput.trim() });
                      stopEdit();
                    }}
                    className="rounded-md bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700"
                  >
                    Save
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-medium text-gray-800">{item.key}</p>
                  <p className="text-xs text-gray-600">{item.value}</p>
                  <p className="text-[10px] text-gray-400">Confidence: {Math.round(item.confidence * 100)}%</p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => startEdit(item)}
                    className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                    title="Edit preference"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5h2m-1 0v14m-7-7h14" />
                    </svg>
                  </button>
                  <button
                    onClick={() => onDelete(item.key, item.value)}
                    className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-red-600"
                    title="Delete preference"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
