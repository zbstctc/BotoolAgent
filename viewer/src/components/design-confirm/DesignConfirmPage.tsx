'use client';

import { useState } from 'react';
import { LayoutPreview, type LayoutData } from './LayoutPreview';
import { VersionHistory, type Version } from './VersionHistory';

interface DesignConfirmPageProps {
  layoutData: LayoutData;
  prdContent: string;
  versions: Version[];
  currentVersion: string;
  onVersionClick: (versionId: string) => void;
  onModify: (modificationRequest: string) => void;
  onConfirm: () => void;
  isLoading?: boolean;
}

export function DesignConfirmPage({
  layoutData,
  prdContent,
  versions,
  currentVersion,
  onVersionClick,
  onModify,
  onConfirm,
  isLoading,
}: DesignConfirmPageProps) {
  const [modificationText, setModificationText] = useState('');
  const [isPrdExpanded, setIsPrdExpanded] = useState(false);

  const handleSubmitModification = () => {
    if (modificationText.trim()) {
      onModify(modificationText.trim());
      setModificationText('');
    }
  };

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Version History */}
      <VersionHistory
        versions={versions}
        currentVersion={currentVersion}
        onVersionClick={onVersionClick}
      />

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Layout Preview */}
        <section>
          <h2 className="text-lg font-semibold text-neutral-900 mb-4">
            页面布局预览
          </h2>
          <LayoutPreview layoutData={layoutData} />
        </section>

        {/* PRD Preview */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-neutral-900">
              PRD 内容
            </h2>
            <button
              onClick={() => setIsPrdExpanded(!isPrdExpanded)}
              className="text-sm text-blue-600 hover:text-blue-700"
            >
              {isPrdExpanded ? '收起' : '展开'}
            </button>
          </div>
          <div
            className={`bg-neutral-50 rounded-lg border border-neutral-200 overflow-hidden transition-all ${
              isPrdExpanded ? 'max-h-none' : 'max-h-48'
            }`}
          >
            <pre className="p-4 text-sm text-neutral-700 whitespace-pre-wrap font-mono">
              {prdContent}
            </pre>
          </div>
        </section>

        {/* Modification Input */}
        <section className="bg-neutral-50 rounded-lg border border-neutral-200 p-4">
          <h3 className="text-sm font-medium text-neutral-900 mb-3">
            需要修改？
          </h3>
          <textarea
            value={modificationText}
            onChange={(e) => setModificationText(e.target.value)}
            placeholder="描述你想要修改的内容，例如：添加搜索功能、修改导航栏布局..."
            rows={3}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition-all resize-none"
            disabled={isLoading}
          />
          <div className="flex justify-end mt-3">
            <button
              onClick={handleSubmitModification}
              disabled={!modificationText.trim() || isLoading}
              className="px-4 py-2 bg-neutral-100 text-neutral-700 rounded-lg text-sm font-medium hover:bg-neutral-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isLoading ? '处理中...' : '提交修改'}
            </button>
          </div>
        </section>
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-neutral-200 bg-white">
        <button
          onClick={onConfirm}
          disabled={isLoading}
          className="w-full py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed transition-colors"
        >
          确认并进入 Stage 2
        </button>
      </div>
    </div>
  );
}
