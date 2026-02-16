'use client';

import { useState } from 'react';

// Types matching the /api/git/diff response
export interface DiffLine {
  type: 'context' | 'addition' | 'deletion';
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface FileDiff {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  oldPath?: string;
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
  isBinary: boolean;
}

export interface DiffSummary {
  branch: string;
  baseBranch: string;
  files: FileDiff[];
  totals: {
    files: number;
    additions: number;
    deletions: number;
  };
}

export interface ChangeSummaryProps {
  diffSummary?: DiffSummary | null;
  isLoading?: boolean;
  onFileClick?: (file: FileDiff) => void;
}

// File status badge
function FileStatusBadge({ status }: { status: FileDiff['status'] }) {
  const config = {
    added: {
      bg: 'bg-green-100',
      text: 'text-green-700',
      label: '新增',
    },
    modified: {
      bg: 'bg-neutral-200',
      text: 'text-neutral-700',
      label: '修改',
    },
    deleted: {
      bg: 'bg-red-100',
      text: 'text-red-700',
      label: '删除',
    },
    renamed: {
      bg: 'bg-neutral-200',
      text: 'text-neutral-700',
      label: '重命名',
    },
  };

  const { bg, text, label } = config[status];

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${bg} ${text}`}>
      {label}
    </span>
  );
}

// File icon based on extension
function FileIcon({ path }: { path: string }) {
  const ext = path.split('.').pop()?.toLowerCase() || '';

  const iconClass = 'w-4 h-4';

  // TypeScript/JavaScript
  if (['ts', 'tsx', 'js', 'jsx'].includes(ext)) {
    return (
      <svg className={`${iconClass} text-neutral-500`} viewBox="0 0 24 24" fill="currentColor">
        <path d="M3 3h18v18H3V3zm16.525 13.707c-.131-.821-.666-1.511-2.252-2.155-.552-.259-1.165-.438-1.349-.854-.068-.248-.083-.393-.038-.545.098-.392.488-.506.807-.443.209.049.404.17.527.456.564-.369.564-.369.953-.611-.146-.179-.219-.268-.314-.36-.428-.502-.969-.755-1.866-.73l-.464.056c-.447.1-.865.314-1.108.587-.631.648-.748 1.635-.404 2.459.341.768 1.051 1.145 1.893 1.402.825.255 1.419.376 1.581.755.15.411-.015.854-.418 1.012-.392.154-.908.139-1.2-.104-.27-.243-.405-.581-.407-.96l-1.237.723c.158.319.335.44.572.699.985 1.041 3.405 1.025 3.839-1.022.02-.089.049-.176.049-.265-.005-.75-.017-1.233-.531-1.583zm-5.997-2.614H11.38v4.482c0 1.073.066 1.607-.162 1.881-.341.392-1.205.366-1.591.17-.378-.204-.535-.553-.67-.947-.002-.011-.023-.019-.035-.019l-1.207.732c.252.484.583.864 1.017 1.11.64.359 1.505.471 2.375.29 1.069-.229 1.569-1.166 1.569-2.404V14.092h-.001z" />
      </svg>
    );
  }

  // JSON
  if (ext === 'json') {
    return (
      <svg className={`${iconClass} text-yellow-600`} viewBox="0 0 24 24" fill="currentColor">
        <path d="M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2zm7 14c1.5 0 2.5-.5 3-2h-2c-.25.5-.5.75-1 .75-1 0-1.5-1-1.5-2.25S11 11.25 12 11.25c.5 0 .75.25 1 .75h2c-.5-1.5-1.5-2-3-2-2 0-3.5 1.5-3.5 3.75S10 17 12 17z" />
      </svg>
    );
  }

  // CSS/SCSS
  if (['css', 'scss', 'sass', 'less'].includes(ext)) {
    return (
      <svg className={`${iconClass} text-pink-500`} viewBox="0 0 24 24" fill="currentColor">
        <path d="M3 3h18v18H3V3zm16.75 14.4c0-1.07-.57-1.7-1.71-1.83l-1.41-.16c-.57-.06-.86-.31-.86-.75s.29-.69.86-.69h2.25V12h-2.39c-1.35 0-2.15.75-2.15 1.97 0 1.07.57 1.73 1.71 1.86l1.41.16c.57.06.86.31.86.75s-.29.69-.86.69h-2.25V19h2.39c1.35 0 2.15-.75 2.15-1.97v-.03zm-7.25-2.4c0-1.07-.57-1.7-1.71-1.83l-1.41-.16c-.57-.06-.86-.31-.86-.75s.29-.69.86-.69h2.25V12H9.24c-1.35 0-2.15.75-2.15 1.97 0 1.07.57 1.73 1.71 1.86l1.41.16c.57.06.86.31.86.75s-.29.69-.86.69H8.25V19h2.39c1.35 0 2.15-.75 2.15-1.97V15z" />
      </svg>
    );
  }

  // Markdown
  if (['md', 'mdx'].includes(ext)) {
    return (
      <svg className={`${iconClass} text-neutral-600`} viewBox="0 0 24 24" fill="currentColor">
        <path d="M20.56 18H3.44C2.65 18 2 17.37 2 16.59V7.41C2 6.63 2.65 6 3.44 6h17.12c.79 0 1.44.63 1.44 1.41v9.18c0 .78-.65 1.41-1.44 1.41zM6.81 15.19v-3.66l1.92 2.35 1.92-2.35v3.66h1.93V8.81h-1.93l-1.92 2.35-1.92-2.35H4.88v6.38h1.93zm10.15 0v-4.45l1.92 4.45h1.93V8.81h-1.93v4.45l-1.92-4.45H15v6.38h1.96z" />
      </svg>
    );
  }

  // Shell scripts
  if (['sh', 'bash', 'zsh'].includes(ext)) {
    return (
      <svg className={`${iconClass} text-green-600`} viewBox="0 0 24 24" fill="currentColor">
        <path d="M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2zm2.5 10.5l3-3-3-3L9 6l4.5 4.5L9 15l-1.5-1.5zm5.5 2v-1.5H18V15.5h-5z" />
      </svg>
    );
  }

  // Default file icon
  return (
    <svg className={`${iconClass} text-neutral-400`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
    </svg>
  );
}

// Diff line component with syntax highlighting
function DiffLineRow({ line }: { line: DiffLine }) {
  const bgClass = {
    context: 'bg-white',
    addition: 'bg-green-50',
    deletion: 'bg-red-50',
  }[line.type];

  const textClass = {
    context: 'text-neutral-700',
    addition: 'text-green-800',
    deletion: 'text-red-800',
  }[line.type];

  const prefix = {
    context: ' ',
    addition: '+',
    deletion: '-',
  }[line.type];

  const lineNumClass = {
    context: 'text-neutral-400',
    addition: 'text-green-500',
    deletion: 'text-red-500',
  }[line.type];

  return (
    <div className={`flex ${bgClass} hover:brightness-95 transition-all`}>
      {/* Line numbers */}
      <div className={`flex-shrink-0 w-20 flex text-xs font-mono ${lineNumClass} select-none border-r border-neutral-200`}>
        <span className="w-10 px-2 text-right">
          {line.oldLineNumber ?? ''}
        </span>
        <span className="w-10 px-2 text-right">
          {line.newLineNumber ?? ''}
        </span>
      </div>

      {/* Prefix */}
      <span className={`flex-shrink-0 w-5 text-center font-mono text-sm ${textClass}`}>
        {prefix}
      </span>

      {/* Content */}
      <pre className={`flex-1 text-sm font-mono ${textClass} overflow-x-auto`}>
        {line.content}
      </pre>
    </div>
  );
}

// Diff hunk component
function DiffHunkView({ hunk }: { hunk: DiffHunk }) {
  return (
    <div className="border-b border-neutral-200 last:border-b-0">
      {/* Hunk header */}
      <div className="bg-neutral-100 px-3 py-1 text-xs font-mono text-neutral-700 border-b border-neutral-200">
        @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
      </div>

      {/* Lines */}
      <div>
        {hunk.lines.map((line, index) => (
          <DiffLineRow key={index} line={line} />
        ))}
      </div>
    </div>
  );
}

// Single file diff item
function FileDiffItem({ file, isExpanded, onToggle }: {
  file: FileDiff;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const hasChanges = file.hunks.length > 0 || file.isBinary;

  return (
    <div className="border border-neutral-200 rounded-lg bg-white overflow-hidden">
      {/* Header */}
      <button
        onClick={onToggle}
        disabled={!hasChanges}
        className={`w-full px-4 py-3 flex items-center justify-between ${
          hasChanges ? 'hover:bg-neutral-50 cursor-pointer' : 'cursor-default'
        }`}
      >
        <div className="flex items-center gap-3 min-w-0">
          {/* File icon */}
          <FileIcon path={file.path} />

          {/* File path */}
          <div className="flex items-center gap-2 min-w-0">
            {file.oldPath && (
              <>
                <span className="text-neutral-400 truncate" title={file.oldPath}>
                  {file.oldPath}
                </span>
                <span className="text-neutral-400">→</span>
              </>
            )}
            <span className="font-mono text-sm text-neutral-900 truncate" title={file.path}>
              {file.path}
            </span>
          </div>

          {/* Status badge */}
          <FileStatusBadge status={file.status} />
        </div>

        <div className="flex items-center gap-3 flex-shrink-0">
          {/* Line stats */}
          {!file.isBinary && (
            <div className="flex items-center gap-2 text-sm font-mono">
              {file.additions > 0 && (
                <span className="text-green-600">+{file.additions}</span>
              )}
              {file.deletions > 0 && (
                <span className="text-red-600">-{file.deletions}</span>
              )}
            </div>
          )}

          {file.isBinary && (
            <span className="text-xs text-neutral-500">二进制文件</span>
          )}

          {/* Expand arrow */}
          {hasChanges && (
            <svg
              className={`w-5 h-5 text-neutral-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          )}
        </div>
      </button>

      {/* Expanded diff content */}
      {isExpanded && !file.isBinary && file.hunks.length > 0 && (
        <div className="border-t border-neutral-200 overflow-x-auto">
          {file.hunks.map((hunk, index) => (
            <DiffHunkView key={index} hunk={hunk} />
          ))}
        </div>
      )}

      {isExpanded && file.isBinary && (
        <div className="border-t border-neutral-200 px-4 py-6 text-center text-neutral-500">
          <svg className="w-8 h-8 mx-auto mb-2 text-neutral-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <p className="text-sm">二进制文件，无法显示差异</p>
        </div>
      )}
    </div>
  );
}

// Summary header card
function SummaryHeader({ totals, branch, baseBranch }: {
  totals: DiffSummary['totals'];
  branch: string;
  baseBranch: string;
}) {
  return (
    <div className="bg-neutral-50 border border-neutral-200 rounded-lg p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-neutral-200 flex items-center justify-center">
            <svg className="w-5 h-5 text-neutral-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <div>
            <p className="font-semibold text-neutral-900">代码变更</p>
            <p className="text-sm text-neutral-600">
              {branch} ← {baseBranch}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4 text-sm">
          <div className="flex items-center gap-1">
            <svg className="w-4 h-4 text-neutral-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span className="text-neutral-700 font-medium">{totals.files}</span>
            <span className="text-neutral-500">文件</span>
          </div>

          <div className="flex items-center gap-2 font-mono">
            <span className="text-green-600">+{totals.additions}</span>
            <span className="text-red-600">-{totals.deletions}</span>
          </div>
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

      {/* File items skeleton */}
      {[1, 2, 3].map((i) => (
        <div key={i} className="bg-neutral-100 rounded-lg h-14" />
      ))}
    </div>
  );
}

// Main component
export function ChangeSummary({ diffSummary, isLoading, onFileClick }: ChangeSummaryProps) {
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());

  const toggleFile = (path: string) => {
    setExpandedFiles(prev => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const expandAll = () => {
    if (diffSummary) {
      setExpandedFiles(new Set(diffSummary.files.map(f => f.path)));
    }
  };

  const collapseAll = () => {
    setExpandedFiles(new Set());
  };

  if (isLoading) {
    return <LoadingSkeleton />;
  }

  if (!diffSummary || diffSummary.files.length === 0) {
    return (
      <div className="text-center py-8 text-neutral-500">
        <svg className="w-12 h-12 mx-auto mb-3 text-neutral-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <p>暂无代码变更</p>
        <p className="text-sm text-neutral-400 mt-1">当前分支与主分支内容相同</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary header */}
      <SummaryHeader
        totals={diffSummary.totals}
        branch={diffSummary.branch}
        baseBranch={diffSummary.baseBranch}
      />

      {/* Actions */}
      <div className="flex justify-end gap-2">
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

      {/* File list */}
      <div className="space-y-2">
        {diffSummary.files.map((file) => (
          <FileDiffItem
            key={file.path}
            file={file}
            isExpanded={expandedFiles.has(file.path)}
            onToggle={() => {
              toggleFile(file.path);
              onFileClick?.(file);
            }}
          />
        ))}
      </div>
    </div>
  );
}
