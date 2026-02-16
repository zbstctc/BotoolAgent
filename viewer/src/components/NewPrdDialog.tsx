'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
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
import { Textarea } from '@/components/ui/textarea';

interface NewPrdDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

// Requirement type options
type RequirementType = 'new-feature' | 'enhancement' | 'bugfix' | 'other';

const REQUIREMENT_TYPES: { value: RequirementType; label: string }[] = [
  { value: 'new-feature', label: '新功能' },
  { value: 'enhancement', label: '改功能' },
  { value: 'bugfix', label: '修bug' },
  { value: 'other', label: '其他' },
];

export function NewPrdDialog({ isOpen, onClose }: NewPrdDialogProps) {
  const router = useRouter();
  const { createProject } = useProject();
  const [description, setDescription] = useState('');
  const [requirementType, setRequirementType] = useState<RequirementType>('new-feature');
  const [customType, setCustomType] = useState('');
  const [generatedTitle, setGeneratedTitle] = useState('');
  const [isGeneratingTitle, setIsGeneratingTitle] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const generateTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Focus textarea when dialog opens
  useEffect(() => {
    if (isOpen && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isOpen]);

  // Reset state when dialog closes
  useEffect(() => {
    if (!isOpen) {
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
  }, [isOpen]);

  // Generate title when description changes (debounced)
  const generateTitle = useCallback(async (desc: string) => {
    if (desc.trim().length < 10) return; // Need at least 10 chars

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
        // Clean up the title - remove quotes, markdown, etc.
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

  // Debounced title generation
  const handleDescriptionChange = useCallback((value: string) => {
    setDescription(value);

    // Clear previous timeout
    if (generateTimeoutRef.current) {
      clearTimeout(generateTimeoutRef.current);
    }

    // Set new timeout for title generation
    if (value.trim().length >= 20) {
      generateTimeoutRef.current = setTimeout(() => {
        generateTitle(value);
      }, 1000); // Wait 1 second after typing stops
    }
  }, [generateTitle]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();

      const trimmedDescription = description.trim();
      if (!trimmedDescription) return;

      setIsCreating(true);

      try {
        // Use generated title or fallback to first 30 chars of description
        const projectName = generatedTitle.trim() ||
          (trimmedDescription.slice(0, 30) + (trimmedDescription.length > 30 ? '...' : ''));

        // Create a new session with the project name (legacy storage)
        const sessionId = createSession(projectName);

        // Also create a project in ProjectContext (new storage)
        createProject(projectName, sessionId);

        // Store description and requirement type in sessionStorage for Stage 1 to pick up
        sessionStorage.setItem(`botool-initial-description-${sessionId}`, trimmedDescription);
        const typeToStore = requirementType === 'other' ? customType.trim() || '其他' : REQUIREMENT_TYPES.find(t => t.value === requirementType)?.label || '新功能';
        sessionStorage.setItem(`botool-requirement-type-${sessionId}`, typeToStore);

        // Navigate to Stage 1 with the session ID
        router.push(`/stage1?session=${sessionId}`);
        onClose();
      } catch (error) {
        console.error('Failed to create session:', error);
        setIsCreating(false);
      }
    },
    [description, generatedTitle, requirementType, customType, router, onClose, createProject]
  );

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md p-0 gap-0" showCloseButton={true}>
        {/* Header */}
        <DialogHeader className="p-4 border-b border-neutral-200">
          <DialogTitle>新建 PRD</DialogTitle>
        </DialogHeader>

        {/* Content */}
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
                    className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                      requirementType === type.value
                        ? 'bg-neutral-200 text-neutral-700 ring-2 ring-neutral-500'
                        : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                    }`}
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

            {/* Description Input */}
            <div>
              <label
                htmlFor="requirement-description"
                className="block text-sm font-medium text-neutral-700 mb-2"
              >
                需求描述
              </label>
              <Textarea
                ref={textareaRef}
                id="requirement-description"
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
                htmlFor="project-title"
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
                id="project-title"
                type="text"
                value={generatedTitle}
                onChange={(e) => setGeneratedTitle(e.target.value)}
                placeholder={description.trim().length >= 20 ? '自动生成中...' : '输入描述后自动生成'}
                disabled={isCreating || isGeneratingTitle}
              />
              <p className="mt-1 text-xs text-neutral-500">
                标题会自动生成，你也可以手动修改
              </p>
            </div>
          </div>

          {/* Footer */}
          <DialogFooter className="p-4 border-t border-neutral-200 bg-neutral-50">
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              disabled={isCreating}
            >
              取消
            </Button>
            <Button
              type="submit"
              disabled={!description.trim() || isCreating}
            >
              {isCreating ? '创建中...' : '开始创建'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
