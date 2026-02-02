'use client';

import { useCallback, useMemo, useRef, useEffect, useState } from 'react';

// Types for checklist items
export interface ChecklistItem {
  id: string;
  taskId: string;
  title: string;
  description?: string;
  checked: boolean;
}

export interface ManualChecklistProps {
  items: ChecklistItem[];
  onItemToggle?: (itemId: string, checked: boolean) => void;
  onAllComplete?: () => void;
  storageKey?: string;
}

// Helper to get saved state from localStorage
function getSavedState(storageKey: string): Record<string, boolean> {
  if (typeof window === 'undefined') return {};
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch {
    // Ignore parse errors
  }
  return {};
}

// Helper to save state to localStorage
function saveState(storageKey: string, state: Record<string, boolean>) {
  if (typeof window !== 'undefined') {
    localStorage.setItem(storageKey, JSON.stringify(state));
  }
}

// Checkmark icon
function CheckIcon({ checked }: { checked: boolean }) {
  return (
    <svg
      className={`w-5 h-5 ${checked ? 'text-green-600' : 'text-neutral-300'}`}
      viewBox="0 0 20 20"
      fill="currentColor"
    >
      {checked ? (
        <path
          fillRule="evenodd"
          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
          clipRule="evenodd"
        />
      ) : (
        <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="1.5" />
      )}
    </svg>
  );
}

// Single checklist item component
function ChecklistItemRow({
  item,
  onToggle,
}: {
  item: ChecklistItem;
  onToggle: (checked: boolean) => void;
}) {
  return (
    <button
      onClick={() => onToggle(!item.checked)}
      className={`w-full flex items-start gap-3 p-4 rounded-lg border transition-all ${
        item.checked
          ? 'bg-green-50 border-green-200 hover:bg-green-100'
          : 'bg-white border-neutral-200 hover:bg-neutral-50'
      }`}
    >
      {/* Checkbox */}
      <div className="flex-shrink-0 mt-0.5">
        <div
          className={`w-6 h-6 rounded-full flex items-center justify-center ${
            item.checked ? 'bg-green-100' : 'bg-neutral-100'
          }`}
        >
          <CheckIcon checked={item.checked} />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 text-left">
        <div className="flex items-center gap-2">
          <span
            className={`text-xs font-mono px-2 py-0.5 rounded ${
              item.checked
                ? 'bg-green-200 text-green-800'
                : 'bg-neutral-200 text-neutral-600'
            }`}
          >
            {item.taskId}
          </span>
        </div>
        <p
          className={`mt-1 font-medium ${
            item.checked ? 'text-green-900 line-through' : 'text-neutral-900'
          }`}
        >
          {item.title}
        </p>
        {item.description && (
          <p
            className={`mt-0.5 text-sm ${
              item.checked ? 'text-green-700' : 'text-neutral-500'
            }`}
          >
            {item.description}
          </p>
        )}
      </div>
    </button>
  );
}

// Completion celebration component
function CompletionBanner() {
  return (
    <div className="bg-green-100 border border-green-300 rounded-lg p-4 text-center">
      <div className="flex items-center justify-center gap-2 mb-2">
        <svg
          className="w-8 h-8 text-green-600"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <span className="text-xl font-bold text-green-800">验证完成！</span>
      </div>
      <p className="text-green-700">所有浏览器验证项目已完成</p>
    </div>
  );
}

// Main component
export function ManualChecklist({
  items: initialItems,
  onItemToggle,
  onAllComplete,
  storageKey = 'botool-manual-checklist',
}: ManualChecklistProps) {
  // State for checked items - initialized lazily from localStorage
  const [checkedState, setCheckedState] = useState<Record<string, boolean>>(() =>
    getSavedState(storageKey)
  );

  // Compute items with saved state merged
  const items = useMemo(() => {
    return initialItems.map((item) => ({
      ...item,
      checked: checkedState[item.id] ?? item.checked,
    }));
  }, [initialItems, checkedState]);

  // Derive isAllComplete from items
  const isAllComplete = useMemo(
    () => items.length > 0 && items.every((item) => item.checked),
    [items]
  );

  // Call onAllComplete when all items are checked - using ref to track previous state
  const prevAllCompleteRef = useRef(false);
  useEffect(() => {
    if (isAllComplete && !prevAllCompleteRef.current && onAllComplete) {
      onAllComplete();
    }
    prevAllCompleteRef.current = isAllComplete;
  }, [isAllComplete, onAllComplete]);

  // Handle item toggle
  const handleToggle = useCallback(
    (itemId: string, checked: boolean) => {
      setCheckedState((prev) => {
        const newState = { ...prev, [itemId]: checked };
        saveState(storageKey, newState);
        return newState;
      });

      if (onItemToggle) {
        onItemToggle(itemId, checked);
      }
    },
    [storageKey, onItemToggle]
  );

  // Calculate progress
  const checkedCount = items.filter((item) => item.checked).length;
  const progress = items.length > 0 ? (checkedCount / items.length) * 100 : 0;

  if (items.length === 0) {
    return (
      <div className="text-center py-8 text-neutral-500">
        <svg
          className="w-12 h-12 mx-auto mb-3 text-neutral-300"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
          />
        </svg>
        <p>没有需要手动验证的任务</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Progress header */}
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-neutral-900">手动验证清单</h3>
        <span className="text-sm text-neutral-600">
          {checkedCount}/{items.length} 已完成
        </span>
      </div>

      {/* Progress bar */}
      <div className="h-2 bg-neutral-200 rounded-full overflow-hidden">
        <div
          className="h-full bg-green-500 transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Completion banner */}
      {isAllComplete && <CompletionBanner />}

      {/* Checklist items */}
      <div className="space-y-2">
        {items.map((item) => (
          <ChecklistItemRow
            key={item.id}
            item={item}
            onToggle={(checked) => handleToggle(item.id, checked)}
          />
        ))}
      </div>
    </div>
  );
}

// Helper function to extract checklist items from PRD
export function extractChecklistFromPRD(prdTasks: Array<{
  id: string;
  title: string;
  acceptanceCriteria: string[];
  passes?: boolean;
}>): ChecklistItem[] {
  const items: ChecklistItem[] = [];

  for (const task of prdTasks) {
    // Check if any acceptance criteria contains "Verify in browser"
    const hasVerifyInBrowser = task.acceptanceCriteria.some((criteria) =>
      criteria.toLowerCase().includes('verify in browser')
    );

    if (hasVerifyInBrowser) {
      items.push({
        id: `verify-${task.id}`,
        taskId: task.id,
        title: task.title,
        description: '在浏览器中验证 UI 功能',
        checked: false,
      });
    }
  }

  return items;
}
