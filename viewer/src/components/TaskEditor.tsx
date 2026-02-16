'use client';

import { useState, useCallback } from 'react';

interface DevTask {
  id: string;
  title: string;
  prdSection?: string;
  description?: string;
  acceptanceCriteria?: string[];
  priority: number;
  passes: boolean;
  notes?: string;
}

interface TaskEditorProps {
  tasks: DevTask[];
  onTasksChange: (tasks: DevTask[]) => void;
  onSave: () => void;
  isSaving: boolean;
}

export function TaskEditor({ tasks, onTasksChange, onSave, isSaving }: TaskEditorProps) {
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // Drag and drop handlers
  const handleDragStart = useCallback((index: number) => {
    setDraggedIndex(index);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex !== null && draggedIndex !== index) {
      setDragOverIndex(index);
    }
  }, [draggedIndex]);

  const handleDragLeave = useCallback(() => {
    setDragOverIndex(null);
  }, []);

  const handleDrop = useCallback((index: number) => {
    if (draggedIndex !== null && draggedIndex !== index) {
      const newTasks = [...tasks];
      const [draggedTask] = newTasks.splice(draggedIndex, 1);
      newTasks.splice(index, 0, draggedTask);
      // Update priorities based on new order
      const reorderedTasks = newTasks.map((task, i) => ({
        ...task,
        priority: i + 1,
      }));
      onTasksChange(reorderedTasks);
    }
    setDraggedIndex(null);
    setDragOverIndex(null);
  }, [draggedIndex, tasks, onTasksChange]);

  const handleDragEnd = useCallback(() => {
    setDraggedIndex(null);
    setDragOverIndex(null);
  }, []);

  // Task editing handlers
  const handleTaskUpdate = useCallback((taskId: string, updates: Partial<DevTask>) => {
    const newTasks = tasks.map((task) =>
      task.id === taskId ? { ...task, ...updates } : task
    );
    onTasksChange(newTasks);
  }, [tasks, onTasksChange]);

  const handleAcceptanceCriteriaChange = useCallback((taskId: string, index: number, value: string) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;

    const newCriteria = [...(task.acceptanceCriteria || [])];
    if (value === '') {
      // Remove empty criteria
      newCriteria.splice(index, 1);
    } else {
      newCriteria[index] = value;
    }
    handleTaskUpdate(taskId, { acceptanceCriteria: newCriteria });
  }, [tasks, handleTaskUpdate]);

  const handleAddCriteria = useCallback((taskId: string) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;

    handleTaskUpdate(taskId, {
      acceptanceCriteria: [...(task.acceptanceCriteria || []), ''],
    });
  }, [tasks, handleTaskUpdate]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-neutral-200 bg-white">
        <div>
          <h3 className="text-sm font-semibold text-neutral-900">
            Dev Tasks ({tasks.length})
          </h3>
          <p className="text-xs text-neutral-500 mt-0.5">
            Drag to reorder • Click to edit
          </p>
        </div>
        <button
          onClick={onSave}
          disabled={isSaving}
          className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
            isSaving
              ? 'bg-neutral-100 text-neutral-400 cursor-wait'
              : 'bg-neutral-900 text-white hover:bg-neutral-800'
          }`}
        >
          {isSaving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>

      {/* Task List */}
      <div className="flex-1 overflow-auto p-4">
        <div className="space-y-2">
          {tasks.map((task, index) => (
            <div
              key={task.id}
              draggable
              onDragStart={() => handleDragStart(index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDragLeave={handleDragLeave}
              onDrop={() => handleDrop(index)}
              onDragEnd={handleDragEnd}
              className={`
                rounded-lg border bg-white transition-all cursor-move
                ${draggedIndex === index ? 'opacity-50 scale-[0.98]' : ''}
                ${dragOverIndex === index ? 'border-neutral-500 ring-2 ring-neutral-200' : 'border-neutral-200'}
                ${editingTaskId === task.id ? 'ring-2 ring-neutral-500' : ''}
              `}
            >
              {/* Task Header */}
              <div
                className="flex items-start gap-3 p-4 cursor-pointer"
                onClick={() => setEditingTaskId(editingTaskId === task.id ? null : task.id)}
              >
                {/* Drag Handle */}
                <div className="flex-shrink-0 text-neutral-400 mt-0.5 cursor-grab active:cursor-grabbing">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" />
                  </svg>
                </div>

                {/* Task Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-neutral-400 bg-neutral-100 px-1.5 py-0.5 rounded">
                      {task.id}
                    </span>
                    <span className="text-xs text-neutral-400">
                      Priority: {task.priority}
                    </span>
                    {task.passes && (
                      <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded">
                        Passed
                      </span>
                    )}
                  </div>
                  <h4 className="font-medium text-neutral-900 mt-1">
                    {task.title}
                  </h4>
                  {task.description ? (
                    <p className="text-sm text-neutral-500 mt-0.5 line-clamp-2">
                      {task.description}
                    </p>
                  ) : task.prdSection ? (
                    <p className="text-sm text-neutral-400 mt-0.5 italic">PRD § {task.prdSection}</p>
                  ) : null}
                </div>

                {/* Expand/Collapse Icon */}
                <div className="flex-shrink-0 text-neutral-400">
                  <svg
                    className={`w-5 h-5 transition-transform ${editingTaskId === task.id ? 'rotate-180' : ''}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>

              {/* Expanded Edit View */}
              {editingTaskId === task.id && (
                <div className="border-t border-neutral-100 p-4 space-y-4 bg-neutral-50">
                  {/* Title */}
                  <div>
                    <label className="block text-xs font-medium text-neutral-700 mb-1">
                      Title
                    </label>
                    <input
                      type="text"
                      value={task.title}
                      onChange={(e) => handleTaskUpdate(task.id, { title: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-neutral-200 rounded-md focus:outline-none focus:ring-2 focus:ring-neutral-500 focus:border-transparent"
                    />
                  </div>

                  {/* Description */}
                  <div>
                    <label className="block text-xs font-medium text-neutral-700 mb-1">
                      Description
                    </label>
                    <textarea
                      value={task.description || ''}
                      onChange={(e) => handleTaskUpdate(task.id, { description: e.target.value })}
                      rows={2}
                      className="w-full px-3 py-2 text-sm border border-neutral-200 rounded-md focus:outline-none focus:ring-2 focus:ring-neutral-500 focus:border-transparent resize-none"
                    />
                  </div>

                  {/* Acceptance Criteria */}
                  <div>
                    <label className="block text-xs font-medium text-neutral-700 mb-1">
                      Acceptance Criteria
                    </label>
                    <div className="space-y-2">
                      {(task.acceptanceCriteria || []).map((criterion, criteriaIndex) => (
                        <div key={criteriaIndex} className="flex items-center gap-2">
                          <span className="text-neutral-400 text-sm">•</span>
                          <input
                            type="text"
                            value={criterion}
                            onChange={(e) => handleAcceptanceCriteriaChange(task.id, criteriaIndex, e.target.value)}
                            placeholder="Enter acceptance criterion..."
                            className="flex-1 px-3 py-1.5 text-sm border border-neutral-200 rounded-md focus:outline-none focus:ring-2 focus:ring-neutral-500 focus:border-transparent"
                          />
                          <button
                            onClick={() => handleAcceptanceCriteriaChange(task.id, criteriaIndex, '')}
                            className="text-neutral-400 hover:text-red-500 transition-colors p-1"
                            title="Remove criterion"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      ))}
                      <button
                        onClick={() => handleAddCriteria(task.id)}
                        className="flex items-center gap-1 text-sm text-neutral-700 hover:text-neutral-900 transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        Add criterion
                      </button>
                    </div>
                  </div>

                  {/* Notes */}
                  <div>
                    <label className="block text-xs font-medium text-neutral-700 mb-1">
                      Notes
                    </label>
                    <textarea
                      value={task.notes}
                      onChange={(e) => handleTaskUpdate(task.id, { notes: e.target.value })}
                      rows={2}
                      placeholder="Add notes for this task..."
                      className="w-full px-3 py-2 text-sm border border-neutral-200 rounded-md focus:outline-none focus:ring-2 focus:ring-neutral-500 focus:border-transparent resize-none"
                    />
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
