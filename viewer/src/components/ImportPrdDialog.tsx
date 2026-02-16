'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { createSession } from '@/lib/prd-session-storage';
import { useProject } from '@/contexts/ProjectContext';

interface ImportPrdDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

interface MdFileInfo {
  path: string;
  name: string;
  directory: string;
  preview: string;
  size: number;
  modifiedAt: string;
}

export function ImportPrdDialog({ isOpen, onClose }: ImportPrdDialogProps) {
  const router = useRouter();
  const { createProject } = useProject();
  const [files, setFiles] = useState<MdFileInfo[]>([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFile, setSelectedFile] = useState<MdFileInfo | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  // Fetch files when dialog opens
  useEffect(() => {
    if (!isOpen) {
      setFiles([]);
      setSearchQuery('');
      setSelectedFile(null);
      setLoadError(null);
      setIsImporting(false);
      return;
    }

    setIsLoadingFiles(true);
    setLoadError(null);

    fetch('/api/files/md')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to fetch files');
        return res.json();
      })
      .then((data) => {
        setFiles(data.files || []);
      })
      .catch((err) => {
        setLoadError(err.message);
      })
      .finally(() => {
        setIsLoadingFiles(false);
      });
  }, [isOpen]);

  // Filter files by search query
  const filteredFiles = useMemo(() => {
    if (!searchQuery.trim()) return files;
    const q = searchQuery.toLowerCase();
    return files.filter(
      (f) => f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q)
    );
  }, [files, searchQuery]);

  // Group files by directory
  const groupedFiles = useMemo(() => {
    const groups: Record<string, MdFileInfo[]> = {};
    for (const file of filteredFiles) {
      const dir = file.directory || '.';
      if (!groups[dir]) groups[dir] = [];
      groups[dir].push(file);
    }
    return groups;
  }, [filteredFiles]);

  // Handle import
  const handleImport = useCallback(() => {
    if (!selectedFile || isImporting) return;
    setIsImporting(true);

    try {
      const projectName = selectedFile.name.replace(/\.md$/, '');
      const sessionId = createSession(projectName);
      createProject(projectName, sessionId);

      // Store the file path as initial description for Stage 1
      sessionStorage.setItem(
        `botool-initial-description-${sessionId}`,
        selectedFile.path
      );

      router.push(
        `/stage1?session=${sessionId}&mode=transform&file=${encodeURIComponent(selectedFile.path)}`
      );
      onClose();
    } catch (error) {
      console.error('Failed to import:', error);
      setIsImporting(false);
    }
  }, [selectedFile, isImporting, router, onClose, createProject]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose]
  );

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
      onKeyDown={handleKeyDown}
    >
      <div
        className="relative w-full max-w-lg bg-white rounded-lg shadow-xl mx-4 max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-neutral-200">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-violet-500" />
            <h2 className="text-lg font-semibold text-neutral-900">
              导入现有文档
            </h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-2 text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 transition-colors"
            aria-label="关闭"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Search */}
        <div className="p-4 border-b border-neutral-200">
          <div className="relative">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索 .md 文件..."
              className="w-full pl-10 pr-3 py-2 border border-neutral-200 rounded-lg text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-violet-500 focus:ring-2 focus:ring-violet-200 outline-none transition-all bg-white"
              autoFocus
            />
          </div>
        </div>

        {/* File List */}
        <div className="flex-1 overflow-y-auto min-h-0 p-4">
          {isLoadingFiles ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin h-6 w-6 border-3 border-violet-600 border-t-transparent rounded-full" />
              <span className="ml-2 text-sm text-neutral-500">扫描文件中...</span>
            </div>
          ) : loadError ? (
            <div className="text-center py-8">
              <p className="text-sm text-red-500">{loadError}</p>
            </div>
          ) : filteredFiles.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-sm text-neutral-500">
                {searchQuery ? '没有匹配的文件' : '未找到 .md 文件'}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {Object.entries(groupedFiles).map(([directory, dirFiles]) => (
                <div key={directory}>
                  <div className="text-xs font-medium text-neutral-400 uppercase tracking-wider mb-1.5 px-1">
                    {directory === '.' ? '根目录' : directory}
                  </div>
                  <div className="space-y-1">
                    {dirFiles.map((file) => {
                      const isSelected = selectedFile?.path === file.path;
                      return (
                        <button
                          key={file.path}
                          onClick={() => setSelectedFile(isSelected ? null : file)}
                          className={`w-full text-left p-3 rounded-lg border transition-colors ${
                            isSelected
                              ? 'border-violet-500 bg-violet-50'
                              : 'border-neutral-200 bg-white hover:border-neutral-300'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className={`text-sm font-medium ${isSelected ? 'text-violet-900' : 'text-neutral-900'}`}>
                              {file.name}
                            </span>
                            <span className="text-xs text-neutral-400">
                              {formatSize(file.size)}
                            </span>
                          </div>
                          <div className="text-xs text-neutral-400 mt-0.5">
                            {new Date(file.modifiedAt).toLocaleDateString('zh-CN')}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Preview */}
        {selectedFile && (
          <div className="border-t border-neutral-200 p-4 bg-neutral-50">
            <div className="text-xs font-medium text-neutral-500 mb-2">预览</div>
            <pre className="text-xs text-neutral-700 whitespace-pre-wrap leading-relaxed bg-white border border-neutral-200 rounded-lg p-3 max-h-32 overflow-y-auto">
              {selectedFile.preview || '(空文件)'}
            </pre>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-4 border-t border-neutral-200 bg-white rounded-b-lg">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-100 transition-colors"
            disabled={isImporting}
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleImport}
            disabled={!selectedFile || isImporting}
            className="rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:bg-violet-300 disabled:cursor-not-allowed transition-colors"
          >
            {isImporting ? '导入中...' : '导入并分析'}
          </button>
        </div>
      </div>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
