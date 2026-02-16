'use client';

import { useState, useEffect } from 'react';

interface SkillPreviewModalProps {
  category: string;
  name: string;
  content: string;
  onClose: () => void;
  onGenerate: () => void;
  isGenerating: boolean;
}

export function SkillPreviewModal({
  category,
  name,
  content,
  onClose,
  onGenerate,
  isGenerating,
}: SkillPreviewModalProps) {
  const [skillPreview, setSkillPreview] = useState<{ fileName: string; content: string } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [skillsDir, setSkillsDir] = useState<string>('');

  useEffect(() => {
    // Generate preview
    const generatePreview = () => {
      // Client-side preview generation (matching server-side logic)
      const categoryNames: Record<string, { en: string; zh: string }> = {
        frontend: { en: 'frontend', zh: '前端规范' },
        backend: { en: 'backend', zh: '后端规范' },
        testing: { en: 'testing', zh: '测试规范' },
        deployment: { en: 'deployment', zh: '部署规范' },
        application: { en: 'application', zh: '应用规范' },
        other: { en: 'other', zh: '其他规范' },
      };

      const safeName = name
        .toLowerCase()
        .replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');

      const fileName = `${category}-${safeName}.md`;
      const categoryInfo = categoryNames[category] || { en: category, zh: category };
      const skillName = `botool-rules:${category}:${name.toLowerCase().replace(/\s+/g, '-')}`;

      // Extract description from content
      const lines = content.split('\n').filter(line => line.trim());
      let description = `${categoryInfo.zh} - ${name}`;
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('#')) {
          const headerText = trimmed.replace(/^#+\s*/, '');
          if (headerText && headerText.length < 100) {
            description = headerText;
            break;
          }
        }
      }

      const skillContent = `---
name: ${skillName}
description: "${description.replace(/"/g, '\\"')}"
user-invocable: false
---

# ${categoryInfo.zh}: ${name}

> 此 Skill 由 BotoolAgent 规范管理器自动生成。

---

${content}
`;

      setSkillPreview({ fileName, content: skillContent });
      setIsLoading(false);
    };

    // Get skills directory path
    const fetchSkillsDir = async () => {
      try {
        const response = await fetch('/api/rules/skill?action=path');
        if (response.ok) {
          const data = await response.json();
          setSkillsDir(data.path);
        }
      } catch (error) {
        console.error('Failed to get skills directory:', error);
      }
    };

    generatePreview();
    fetchSkillsDir();
  }, [category, name, content]);

  const handleGenerate = () => {
    onGenerate();
    setTimeout(() => {
      onClose();
    }, 1000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[80vh] flex flex-col mx-4">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-neutral-200">
          <div>
            <h2 className="text-lg font-semibold text-neutral-900">
              Skill 预览
            </h2>
            <p className="text-xs text-neutral-500 mt-1">
              预览将要生成的 Claude Code Skill 文件
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded hover:bg-neutral-100 text-neutral-500"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {isLoading ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-neutral-700" />
            </div>
          ) : skillPreview ? (
            <>
              {/* File info */}
              <div className="px-4 py-3 bg-neutral-50 border-b border-neutral-200">
                <div className="flex items-center gap-4 text-sm">
                  <span className="text-neutral-500">文件名:</span>
                  <code className="px-2 py-0.5 bg-neutral-200 rounded text-neutral-800">
                    {skillPreview.fileName}
                  </code>
                </div>
                {skillsDir && (
                  <div className="flex items-center gap-4 text-sm mt-2">
                    <span className="text-neutral-500">路径:</span>
                    <code className="px-2 py-0.5 bg-neutral-200 rounded text-neutral-800 text-xs">
                      {skillsDir}/{skillPreview.fileName}
                    </code>
                  </div>
                )}
              </div>

              {/* Preview content */}
              <div className="flex-1 overflow-y-auto p-4">
                <pre className="text-sm font-mono whitespace-pre-wrap text-neutral-700 bg-neutral-50 p-4 rounded border border-neutral-200">
                  {skillPreview.content}
                </pre>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-neutral-500">
              无法生成预览
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t border-neutral-200 bg-neutral-50">
          <p className="text-xs text-neutral-500">
            生成后，Skill 将可在 Claude Code 中使用
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-200 rounded transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleGenerate}
              disabled={isGenerating}
              className="px-4 py-2 text-sm font-medium text-white bg-neutral-900 hover:bg-neutral-800 disabled:bg-neutral-300 disabled:text-neutral-500 disabled:cursor-not-allowed rounded transition-colors"
            >
              {isGenerating ? '生成中...' : '确认生成'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
