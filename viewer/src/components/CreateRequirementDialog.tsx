'use client';

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { createSession } from '@/lib/prd-session-storage';
import { useProject } from '@/contexts/ProjectContext';
import { useRequirement } from '@/contexts/RequirementContext';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { Search } from 'lucide-react';

interface CreateRequirementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Requirement type options for "从头开始" tab
type RequirementType = 'new-feature' | 'enhancement' | 'bugfix' | 'other';

const REQUIREMENT_TYPES: { value: RequirementType; label: string }[] = [
  { value: 'new-feature', label: '新功能' },
  { value: 'enhancement', label: '改功能' },
  { value: 'bugfix', label: '修bug' },
  { value: 'other', label: '其他' },
];

interface MdFileInfo {
  path: string;
  name: string;
  directory: string;
  preview: string;
  size: number;
  modifiedAt: string;
}

interface MarkerInfo {
  id: string;
  sessionId: string;
  createdAt: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ────────────────────────────────────────────────────────────
// Tab 1: 从头开始
// ────────────────────────────────────────────────────────────

interface NewTabProps {
  isActive: boolean;
  onSuccess: () => void;
}

function NewTab({ isActive, onSuccess }: NewTabProps) {
  const router = useRouter();
  const { createProject } = useProject();
  const { createRequirement } = useRequirement();
  const [description, setDescription] = useState('');
  const [requirementType, setRequirementType] = useState<RequirementType>('new-feature');
  const [customType, setCustomType] = useState('');
  const [generatedTitle, setGeneratedTitle] = useState('');
  const [isGeneratingTitle, setIsGeneratingTitle] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const generateTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Focus textarea when tab becomes active
  useEffect(() => {
    if (isActive && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isActive]);

  // Reset state when tab becomes inactive
  useEffect(() => {
    if (!isActive) {
      setDescription('');
      setRequirementType('new-feature');
      setCustomType('');
      setGeneratedTitle('');
      setIsGeneratingTitle(false);
      setIsCreating(false);
      if (generateTimeoutRef.current) {
        clearTimeout(generateTimeoutRef.current);
      }
    }
  }, [isActive]);

  // Generate title from description via API (debounced)
  const generateTitle = useCallback(async (desc: string) => {
    if (desc.trim().length < 10) return;

    setIsGeneratingTitle(true);
    try {
      const response = await fetch('/api/generate-title', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: desc }),
      });

      if (response.ok) {
        const data = await response.json();
        const title = data.title?.trim() || '';
        const cleanTitle = title
          .replace(/^["'`]+|["'`]+$/g, '')
          .replace(/\*\*/g, '')
          .slice(0, 30);
        if (cleanTitle) {
          setGeneratedTitle(cleanTitle);
        }
      }
    } catch (error) {
      console.error('Failed to generate title:', error);
    } finally {
      setIsGeneratingTitle(false);
    }
  }, []);

  const handleDescriptionChange = useCallback(
    (value: string) => {
      setDescription(value);

      if (generateTimeoutRef.current) {
        clearTimeout(generateTimeoutRef.current);
      }

      if (value.trim().length >= 20) {
        generateTimeoutRef.current = setTimeout(() => {
          generateTitle(value);
        }, 1000);
      }
    },
    [generateTitle]
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();

      const trimmedDescription = description.trim();
      if (!trimmedDescription) return;

      setIsCreating(true);

      try {
        const projectName =
          generatedTitle.trim() ||
          trimmedDescription.slice(0, 30) +
            (trimmedDescription.length > 30 ? '...' : '');

        // Legacy session + project
        const sessionId = createSession(projectName);
        createProject(projectName, sessionId);

        // Store description & requirement type for Stage 1 to pick up
        sessionStorage.setItem(
          `botool-initial-description-${sessionId}`,
          trimmedDescription
        );
        const typeToStore =
          requirementType === 'other'
            ? customType.trim() || '其他'
            : REQUIREMENT_TYPES.find((t) => t.value === requirementType)
                ?.label || '新功能';
        sessionStorage.setItem(
          `botool-requirement-type-${sessionId}`,
          typeToStore
        );

        // Create requirement in RequirementContext
        const newReq = createRequirement({
          name: projectName,
          stage: 0,
          status: 'active',
          description: trimmedDescription,
          prdSessionId: sessionId,
        });

        // Navigate to Stage 1 with both req and session params
        router.push(`/stage1?req=${newReq.id}&session=${sessionId}`);
        onSuccess();
      } catch (error) {
        console.error('Failed to create requirement:', error);
        setIsCreating(false);
      }
    },
    [
      description,
      generatedTitle,
      requirementType,
      customType,
      router,
      onSuccess,
      createProject,
      createRequirement,
    ]
  );

  return (
    <form onSubmit={handleSubmit}>
      <div className="p-4 space-y-4">
        {/* Requirement Type Selector */}
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-2">
            需求类型
          </label>
          <div className="flex flex-wrap gap-2">
            {REQUIREMENT_TYPES.map((type) => (
              <button
                key={type.value}
                type="button"
                onClick={() => setRequirementType(type.value)}
                className={cn(
                  'px-3 py-1.5 rounded-full text-sm font-medium transition-colors',
                  requirementType === type.value
                    ? 'bg-neutral-200 text-neutral-700 ring-2 ring-neutral-500'
                    : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                )}
                disabled={isCreating}
              >
                {type.label}
              </button>
            ))}
          </div>
          {requirementType === 'other' && (
            <Input
              type="text"
              value={customType}
              onChange={(e) => setCustomType(e.target.value)}
              placeholder="请输入需求类型..."
              className="mt-2"
              disabled={isCreating}
            />
          )}
        </div>

        {/* Description */}
        <div>
          <label
            htmlFor="req-description"
            className="block text-sm font-medium text-neutral-700 mb-2"
          >
            需求描述
          </label>
          <Textarea
            ref={textareaRef}
            id="req-description"
            value={description}
            onChange={(e) => handleDescriptionChange(e.target.value)}
            placeholder="请描述你想要构建的功能或解决的问题..."
            maxLength={500}
            rows={5}
            className="resize-none"
            disabled={isCreating}
          />
          <div className="mt-2 flex items-center justify-between">
            <p className="text-xs text-neutral-500">
              描述你想要的功能，系统会引导你完善需求
            </p>
            <span className="text-xs text-neutral-400">
              {description.length}/500
            </span>
          </div>
        </div>

        {/* Generated Title */}
        <div>
          <label
            htmlFor="req-title"
            className="block text-sm font-medium text-neutral-700 mb-2"
          >
            项目标题
            {isGeneratingTitle && (
              <span className="ml-2 text-xs text-neutral-500 font-normal">
                生成中...
              </span>
            )}
          </label>
          <Input
            id="req-title"
            type="text"
            value={generatedTitle}
            onChange={(e) => setGeneratedTitle(e.target.value)}
            placeholder={
              description.trim().length >= 20 ? '自动生成中...' : '输入描述后自动生成'
            }
            disabled={isCreating || isGeneratingTitle}
          />
          <p className="mt-1 text-xs text-neutral-500">
            标题会自动生成，你也可以手动修改
          </p>
        </div>
      </div>

      <DialogFooter className="p-4 border-t border-neutral-200 bg-neutral-50">
        <Button
          type="submit"
          disabled={!description.trim() || isCreating}
        >
          {isCreating ? '创建中...' : '开始创建'}
        </Button>
      </DialogFooter>
    </form>
  );
}

// ────────────────────────────────────────────────────────────
// Tab 2: 导入已有文档
// ────────────────────────────────────────────────────────────

interface ImportTabProps {
  isActive: boolean;
  onSuccess: () => void;
}

function ImportTab({ isActive, onSuccess }: ImportTabProps) {
  const router = useRouter();
  const { createProject } = useProject();
  const { createRequirement } = useRequirement();
  const [files, setFiles] = useState<MdFileInfo[]>([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFile, setSelectedFile] = useState<MdFileInfo | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [duplicateMarker, setDuplicateMarker] = useState<MarkerInfo | null>(null);
  const hasFetchedRef = useRef(false);

  // Fetch files when the tab becomes active (once)
  useEffect(() => {
    if (!isActive || hasFetchedRef.current) return;
    hasFetchedRef.current = true;

    setIsLoadingFiles(true);
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
  }, [isActive]);

  // Reset selection when tab becomes inactive
  useEffect(() => {
    if (!isActive) {
      setSelectedFile(null);
      setSearchQuery('');
      setDuplicateMarker(null);
      setIsImporting(false);
    }
  }, [isActive]);

  const filteredFiles = useMemo(() => {
    if (!searchQuery.trim()) return files;
    const q = searchQuery.toLowerCase();
    return files.filter(
      (f) => f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q)
    );
  }, [files, searchQuery]);

  const groupedFiles = useMemo(() => {
    const groups: Record<string, MdFileInfo[]> = {};
    for (const file of filteredFiles) {
      const dir = file.directory || '.';
      if (!groups[dir]) groups[dir] = [];
      groups[dir].push(file);
    }
    return groups;
  }, [filteredFiles]);

  const startImportFlow = useCallback(
    (file: MdFileInfo) => {
      const projectName = file.name.replace(/\.md$/, '');
      const sessionId = createSession(projectName);
      createProject(projectName, sessionId);

      // Create marker file (non-fatal)
      fetch('/api/prd/marker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceFilePath: file.path, sessionId }),
      }).catch(() => {});

      sessionStorage.setItem(
        `botool-initial-description-${sessionId}`,
        file.path
      );

      // Create requirement in RequirementContext
      const newReq = createRequirement({
        name: projectName,
        stage: 0,
        status: 'active',
        prdSessionId: sessionId,
        sourceFile: file.path,
      });

      router.push(
        `/stage1?req=${newReq.id}&session=${sessionId}&mode=transform&file=${encodeURIComponent(file.path)}`
      );
      onSuccess();
    },
    [router, onSuccess, createProject, createRequirement]
  );

  const handleImport = useCallback(async () => {
    if (!selectedFile || isImporting) return;
    setIsImporting(true);
    setDuplicateMarker(null);

    try {
      const checkRes = await fetch(
        `/api/prd/marker?source=${encodeURIComponent(selectedFile.path)}`
      );
      const checkData = await checkRes.json();

      if (checkData.exists && checkData.marker) {
        setDuplicateMarker({
          id: checkData.marker.id,
          sessionId: checkData.marker.sessionId,
          createdAt: checkData.marker.createdAt,
        });
        setIsImporting(false);
        return;
      }

      startImportFlow(selectedFile);
    } catch (error) {
      console.error('Failed to import:', error);
      startImportFlow(selectedFile);
    }
  }, [selectedFile, isImporting, startImportFlow]);

  const handleContinuePrevious = useCallback(() => {
    if (!duplicateMarker) return;
    router.push(
      `/stage1?session=${duplicateMarker.sessionId}&mode=transform&file=${encodeURIComponent(selectedFile?.path || '')}`
    );
    onSuccess();
  }, [duplicateMarker, selectedFile, router, onSuccess]);

  const handleRestartImport = useCallback(async () => {
    if (!selectedFile || !duplicateMarker) return;
    setIsImporting(true);

    try {
      await fetch('/api/prd/marker', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markerId: duplicateMarker.id }),
      });
    } catch {
      /* non-fatal */
    }

    setDuplicateMarker(null);
    startImportFlow(selectedFile);
  }, [selectedFile, duplicateMarker, startImportFlow]);

  return (
    <div className="flex flex-col min-h-0">
      {/* Search */}
      <div className="p-4 border-b border-neutral-200">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
          <Input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索 tasks/ 中的 .md 文件..."
            className="pl-10"
          />
        </div>
      </div>

      {/* File List */}
      <div className="flex-1 overflow-y-auto min-h-0 p-4 max-h-64">
        {isLoadingFiles ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin h-6 w-6 border-2 border-neutral-600 border-t-transparent rounded-full" />
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
              请将 PRD 文档放到项目根目录的{' '}
              <code className="px-1 py-0.5 bg-neutral-100 rounded text-neutral-600">
                tasks/
              </code>{' '}
              文件夹中
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
                        onClick={() =>
                          setSelectedFile(isSelected ? null : file)
                        }
                        className={cn(
                          'w-full text-left p-3 rounded-lg border transition-colors',
                          isSelected
                            ? 'border-neutral-900 bg-neutral-100'
                            : 'border-neutral-200 bg-white hover:border-neutral-300'
                        )}
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
            <svg
              className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"
              />
            </svg>
            <div>
              <p className="text-sm font-medium text-amber-800">
                上次导入尚未完成
              </p>
              <p className="text-xs text-amber-600 mt-1">
                该文件于{' '}
                {new Date(duplicateMarker.createdAt).toLocaleString('zh-CN')}{' '}
                开始导入，但尚未完成。
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
      <DialogFooter className="p-4 border-t border-neutral-200 bg-white">
        <Button
          type="button"
          onClick={handleImport}
          disabled={!selectedFile || isImporting}
        >
          {isImporting ? '导入中...' : '导入并分析'}
        </Button>
      </DialogFooter>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Main: CreateRequirementDialog
// ────────────────────────────────────────────────────────────

export function CreateRequirementDialog({
  open,
  onOpenChange,
}: CreateRequirementDialogProps) {
  const [activeTab, setActiveTab] = useState<'new' | 'import'>('new');

  // Reset tab when dialog closes
  useEffect(() => {
    if (!open) {
      setActiveTab('new');
    }
  }, [open]);

  const handleSuccess = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg p-0 gap-0 bg-white flex flex-col max-h-[90vh]" showCloseButton={true}>
        {/* Header */}
        <DialogHeader className="p-4 border-b border-neutral-200 flex-shrink-0">
          <DialogTitle>新需求</DialogTitle>
        </DialogHeader>

        {/* Tabs */}
        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as 'new' | 'import')}
          className="flex-1 flex flex-col min-h-0"
        >
          <div className="px-4 pt-3 flex-shrink-0">
            <TabsList className="w-full">
              <TabsTrigger value="new" className="flex-1">
                从头开始
              </TabsTrigger>
              <TabsTrigger value="import" className="flex-1">
                导入已有文档
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="new" className="flex-1 flex flex-col min-h-0 mt-0">
            <NewTab
              isActive={activeTab === 'new' && open}
              onSuccess={handleSuccess}
            />
          </TabsContent>

          <TabsContent value="import" className="flex-1 flex flex-col min-h-0 mt-0">
            <ImportTab
              isActive={activeTab === 'import' && open}
              onSuccess={handleSuccess}
            />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
