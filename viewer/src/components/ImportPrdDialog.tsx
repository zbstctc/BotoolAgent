'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { createSession } from '@/lib/prd-session-storage';
import { useProject } from '@/contexts/ProjectContext';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

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
  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      {isOpen && <ImportPrdDialogContent onClose={onClose} />}
    </Dialog>
  );
}

interface MarkerInfo {
  id: string;
  sessionId: string;
  createdAt: string;
}

function ImportPrdDialogContent({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { createProject } = useProject();
  const [files, setFiles] = useState<MdFileInfo[]>([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFile, setSelectedFile] = useState<MdFileInfo | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  // Duplicate import warning state
  const [duplicateMarker, setDuplicateMarker] = useState<MarkerInfo | null>(null);

  // Fetch files on mount
  useEffect(() => {
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
  }, []);

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

  // Start import flow: create marker + navigate
  const startImportFlow = useCallback((file: MdFileInfo) => {
    const projectName = file.name.replace(/\.md$/, '');
    const sessionId = createSession(projectName);
    createProject(projectName, sessionId);

    // Create marker file
    fetch('/api/prd/marker', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceFilePath: file.path, sessionId }),
    }).catch(() => { /* non-fatal */ });

    sessionStorage.setItem(
      `botool-initial-description-${sessionId}`,
      file.path
    );

    router.push(
      `/stage1?session=${sessionId}&mode=transform&file=${encodeURIComponent(file.path)}`
    );
    onClose();
  }, [router, onClose, createProject]);

  // Handle import (async with marker check)
  const handleImport = useCallback(async () => {
    if (!selectedFile || isImporting) return;
    setIsImporting(true);
    setDuplicateMarker(null);

    try {
      // Check if marker already exists
      const checkRes = await fetch(`/api/prd/marker?source=${encodeURIComponent(selectedFile.path)}`);
      const checkData = await checkRes.json();

      if (checkData.exists && checkData.marker) {
        // Show duplicate warning
        setDuplicateMarker({
          id: checkData.marker.id,
          sessionId: checkData.marker.sessionId,
          createdAt: checkData.marker.createdAt,
        });
        setIsImporting(false);
        return;
      }

      // No duplicate — start import
      startImportFlow(selectedFile);
    } catch (error) {
      console.error('Failed to import:', error);
      // Fallback: proceed without marker check
      startImportFlow(selectedFile);
    }
  }, [selectedFile, isImporting, startImportFlow]);

  // Continue previous import session
  const handleContinuePrevious = useCallback(() => {
    if (!duplicateMarker) return;
    // Navigate to the previous session
    router.push(`/stage1?session=${duplicateMarker.sessionId}&mode=transform&file=${encodeURIComponent(selectedFile?.path || '')}`);
    onClose();
  }, [duplicateMarker, selectedFile, router, onClose]);

  // Restart import: delete old marker, create new
  const handleRestartImport = useCallback(async () => {
    if (!selectedFile || !duplicateMarker) return;
    setIsImporting(true);

    try {
      // Delete old marker
      await fetch('/api/prd/marker', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markerId: duplicateMarker.id }),
      });
    } catch { /* non-fatal */ }

    setDuplicateMarker(null);
    startImportFlow(selectedFile);
  }, [selectedFile, duplicateMarker, startImportFlow]);

  return (
    <DialogContent className="sm:max-w-lg p-0 gap-0 max-h-[80vh] flex flex-col" showCloseButton={true}>
      {/* Header */}
      <DialogHeader className="p-4 border-b border-neutral-200">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-neutral-900" />
          <DialogTitle>导入开发文档</DialogTitle>
        </div>
      </DialogHeader>

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
          <Input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索 tasks/ 中的 .md 文件..."
            className="pl-10"
            autoFocus
          />
        </div>
      </div>

      {/* File List */}
      <div className="flex-1 overflow-y-auto min-h-0 p-4">
        {isLoadingFiles ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin h-6 w-6 border-3 border-neutral-600 border-t-transparent rounded-full" />
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
            <p className="text-xs text-neutral-400 mt-2">
              请将 PRD 文档放到项目根目录的 <code className="px-1 py-0.5 bg-neutral-100 rounded text-neutral-600">tasks/</code> 文件夹中
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
                            ? 'border-neutral-900 bg-neutral-100'
                            : 'border-neutral-200 bg-white hover:border-neutral-300'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-neutral-900">
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

      {/* Duplicate import warning */}
      {duplicateMarker && (
        <div className="border-t border-amber-200 bg-amber-50 p-4">
          <div className="flex items-start gap-2 mb-3">
            <svg className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
            <div>
              <p className="text-sm font-medium text-amber-800">上次导入尚未完成</p>
              <p className="text-xs text-amber-600 mt-1">
                该文件于 {new Date(duplicateMarker.createdAt).toLocaleString('zh-CN')} 开始导入，但尚未完成。
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleContinuePrevious}
              className="text-xs"
            >
              继续上次
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleRestartImport}
              className="text-xs"
            >
              重新开始
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setDuplicateMarker(null)}
              className="text-xs"
            >
              取消
            </Button>
          </div>
        </div>
      )}

      {/* Footer */}
      <DialogFooter className="p-4 border-t border-neutral-200 bg-white rounded-b-lg">
        <Button
          type="button"
          variant="ghost"
          onClick={onClose}
          disabled={isImporting}
        >
          取消
        </Button>
        <Button
          type="button"
          onClick={handleImport}
          disabled={!selectedFile || isImporting}
        >
          {isImporting ? '导入中...' : '导入并分析'}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
