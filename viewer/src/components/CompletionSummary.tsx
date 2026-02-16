'use client';

import { useState } from 'react';

// Types for progress parsing
export interface CompletedTask {
  id: string;
  dateTime: string;
  description: string[];
  filesModified: string[];
  lessonsLearned: string[];
}

export interface CodebasePattern {
  content: string;
}

export interface ProgressSummary {
  codebasePatterns: CodebasePattern[];
  completedTasks: CompletedTask[];
}

export interface CompletionSummaryProps {
  progressContent?: string | null;
  isLoading?: boolean;
  projectName?: string;
}

// Parse progress.txt content into structured data
export function parseProgressContent(content: string): ProgressSummary {
  const lines = content.split('\n');
  const codebasePatterns: CodebasePattern[] = [];
  const completedTasks: CompletedTask[] = [];

  let currentSection: 'patterns' | 'task' | 'none' = 'none';
  let currentTask: CompletedTask | null = null;
  let inLessonsSection = false;
  let inFilesSection = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();

    // Skip empty lines in patterns section
    if (currentSection === 'patterns' && trimmedLine === '') {
      continue;
    }

    // Check for Codebase Patterns section
    if (trimmedLine === '## Codebase Patterns') {
      currentSection = 'patterns';
      continue;
    }

    // Check for task header (## YYYY-MM-DD - DT-XXX)
    const taskMatch = trimmedLine.match(/^## (\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2}:\d{2})?)\s*-\s*(DT-\d+)/);
    if (taskMatch) {
      // Save previous task if exists
      if (currentTask) {
        completedTasks.push(currentTask);
      }

      currentSection = 'task';
      currentTask = {
        id: taskMatch[2],
        dateTime: taskMatch[1],
        description: [],
        filesModified: [],
        lessonsLearned: [],
      };
      inLessonsSection = false;
      inFilesSection = false;
      continue;
    }

    // Parse pattern items in patterns section
    if (currentSection === 'patterns' && trimmedLine.startsWith('- ')) {
      codebasePatterns.push({ content: trimmedLine.slice(2) });
      continue;
    }

    // End patterns section on separator or new section
    if (currentSection === 'patterns' && (trimmedLine === '---' || trimmedLine.startsWith('## '))) {
      currentSection = 'none';
      continue;
    }

    // Parse task content
    if (currentSection === 'task' && currentTask) {
      // Check for separator
      if (trimmedLine === '---') {
        if (currentTask) {
          completedTasks.push(currentTask);
          currentTask = null;
        }
        currentSection = 'none';
        inLessonsSection = false;
        inFilesSection = false;
        continue;
      }

      // Check for lessons learned section
      if (trimmedLine.includes('未来迭代的经验教训') || trimmedLine.includes('经验教训')) {
        inLessonsSection = true;
        inFilesSection = false;
        continue;
      }

      // Check for files modified section
      if (trimmedLine.includes('修改的文件') || trimmedLine.includes('修改了哪些文件')) {
        inFilesSection = true;
        inLessonsSection = false;
        continue;
      }

      // Parse list items
      if (trimmedLine.startsWith('- ')) {
        const itemContent = trimmedLine.slice(2);

        if (inLessonsSection) {
          currentTask.lessonsLearned.push(itemContent);
        } else if (inFilesSection) {
          currentTask.filesModified.push(itemContent);
        } else {
          currentTask.description.push(itemContent);
        }
      }
    }
  }

  // Push final task if exists
  if (currentTask) {
    completedTasks.push(currentTask);
  }

  return { codebasePatterns, completedTasks };
}

// Task icon
function TaskIcon() {
  return (
    <svg className="w-5 h-5 text-green-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

// Light bulb icon for lessons
function LessonIcon() {
  return (
    <svg className="w-4 h-4 text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
    </svg>
  );
}

// Pattern icon
function PatternIcon() {
  return (
    <svg className="w-4 h-4 text-neutral-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
    </svg>
  );
}

// File icon
function FileIcon() {
  return (
    <svg className="w-4 h-4 text-neutral-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  );
}

// Completed task card
function TaskCard({ task, isExpanded, onToggle }: {
  task: CompletedTask;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const hasDetails = task.filesModified.length > 0 || task.lessonsLearned.length > 0;

  return (
    <div className="border border-neutral-200 rounded-lg bg-white overflow-hidden">
      {/* Header */}
      <button
        onClick={onToggle}
        disabled={!hasDetails}
        className={`w-full px-4 py-3 flex items-start justify-between text-left ${
          hasDetails ? 'hover:bg-neutral-50 cursor-pointer' : 'cursor-default'
        }`}
      >
        <div className="flex items-start gap-3 min-w-0">
          <div className="flex-shrink-0 mt-0.5">
            <TaskIcon />
          </div>

          <div className="min-w-0">
            {/* Task ID and date */}
            <div className="flex items-center gap-2 mb-1">
              <span className="font-semibold text-neutral-900">{task.id}</span>
              <span className="text-xs text-neutral-400">{task.dateTime}</span>
            </div>

            {/* Description preview */}
            {task.description.length > 0 && (
              <p className="text-sm text-neutral-600 line-clamp-2">
                {task.description[0]}
              </p>
            )}
          </div>
        </div>

        {/* Expand arrow */}
        {hasDetails && (
          <svg
            className={`w-5 h-5 text-neutral-400 transition-transform flex-shrink-0 ${isExpanded ? 'rotate-180' : ''}`}
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        )}
      </button>

      {/* Expanded content */}
      {isExpanded && hasDetails && (
        <div className="border-t border-neutral-200 px-4 py-3 space-y-4 bg-neutral-50">
          {/* Full description */}
          {task.description.length > 1 && (
            <div>
              <h4 className="text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-2">
                实现内容
              </h4>
              <ul className="space-y-1">
                {task.description.map((desc, i) => (
                  <li key={i} className="text-sm text-neutral-700 flex items-start gap-2">
                    <span className="text-neutral-400 mt-1">•</span>
                    <span>{desc}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Files modified */}
          {task.filesModified.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-2 flex items-center gap-1">
                <FileIcon />
                修改的文件
              </h4>
              <ul className="space-y-1">
                {task.filesModified.map((file, i) => (
                  <li key={i} className="text-sm font-mono text-neutral-600 flex items-start gap-2">
                    <span className="text-neutral-400 mt-1">•</span>
                    <span>{file}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Lessons learned */}
          {task.lessonsLearned.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-amber-600 uppercase tracking-wide mb-2 flex items-center gap-1">
                <LessonIcon />
                经验教训
              </h4>
              <ul className="space-y-1">
                {task.lessonsLearned.map((lesson, i) => (
                  <li key={i} className="text-sm text-neutral-700 flex items-start gap-2">
                    <span className="text-amber-500 mt-1">•</span>
                    <span>{lesson}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Codebase patterns section
function PatternsSection({ patterns }: { patterns: CodebasePattern[] }) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (patterns.length === 0) {
    return null;
  }

  return (
    <div className="border border-neutral-200 rounded-lg bg-neutral-100 overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-neutral-200"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-neutral-200 flex items-center justify-center">
            <PatternIcon />
          </div>
          <div>
            <h3 className="font-semibold text-neutral-900">Codebase Patterns</h3>
            <p className="text-xs text-neutral-600">{patterns.length} 个模式</p>
          </div>
        </div>

        <svg
          className={`w-5 h-5 text-neutral-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
        </svg>
      </button>

      {isExpanded && (
        <div className="border-t border-neutral-200 px-4 py-3">
          <ul className="space-y-2">
            {patterns.map((pattern, i) => (
              <li key={i} className="text-sm text-neutral-800 flex items-start gap-2">
                <span className="text-neutral-500 mt-1">•</span>
                <span>{pattern.content}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// Summary header card
function SummaryHeader({ taskCount, projectName }: { taskCount: number; projectName?: string }) {
  return (
    <div className="bg-green-50 border border-green-200 rounded-lg p-4">
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center">
          <svg className="w-6 h-6 text-green-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <div>
          <h2 className="text-lg font-semibold text-green-900">任务完成总结</h2>
          <p className="text-sm text-green-700">
            {projectName && <span className="font-medium">{projectName} - </span>}
            已完成 <span className="font-semibold">{taskCount}</span> 个开发任务
          </p>
        </div>
      </div>
    </div>
  );
}

// Loading skeleton
function LoadingSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      {/* Header skeleton */}
      <div className="bg-neutral-100 rounded-lg p-4 h-20" />

      {/* Task items skeleton */}
      {[1, 2, 3].map((i) => (
        <div key={i} className="bg-neutral-100 rounded-lg h-16" />
      ))}
    </div>
  );
}

// Main component
export function CompletionSummary({ progressContent, isLoading, projectName }: CompletionSummaryProps) {
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());

  const toggleTask = (id: string) => {
    setExpandedTasks(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const expandAll = () => {
    if (summary) {
      setExpandedTasks(new Set(summary.completedTasks.map(t => t.id)));
    }
  };

  const collapseAll = () => {
    setExpandedTasks(new Set());
  };

  if (isLoading) {
    return <LoadingSkeleton />;
  }

  if (!progressContent) {
    return (
      <div className="text-center py-8 text-neutral-500">
        <svg className="w-12 h-12 mx-auto mb-3 text-neutral-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <p>暂无进度记录</p>
        <p className="text-sm text-neutral-400 mt-1">progress.txt 尚未生成</p>
      </div>
    );
  }

  const summary = parseProgressContent(progressContent);

  if (summary.completedTasks.length === 0) {
    return (
      <div className="text-center py-8 text-neutral-500">
        <svg className="w-12 h-12 mx-auto mb-3 text-neutral-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p>尚无完成的任务</p>
        <p className="text-sm text-neutral-400 mt-1">任务完成后将在此显示</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary header */}
      <SummaryHeader
        taskCount={summary.completedTasks.length}
        projectName={projectName}
      />

      {/* Codebase patterns */}
      <PatternsSection patterns={summary.codebasePatterns} />

      {/* Actions */}
      <div className="flex justify-between items-center">
        <h3 className="text-sm font-semibold text-neutral-700">
          已完成任务
        </h3>
        <div className="flex gap-2">
          <button
            onClick={expandAll}
            className="text-sm text-neutral-700 hover:text-neutral-900 px-2 py-1 rounded hover:bg-neutral-100"
          >
            展开全部
          </button>
          <button
            onClick={collapseAll}
            className="text-sm text-neutral-600 hover:text-neutral-700 px-2 py-1 rounded hover:bg-neutral-100"
          >
            收起全部
          </button>
        </div>
      </div>

      {/* Task list */}
      <div className="space-y-2">
        {summary.completedTasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            isExpanded={expandedTasks.has(task.id)}
            onToggle={() => toggleTask(task.id)}
          />
        ))}
      </div>
    </div>
  );
}
