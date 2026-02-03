'use client';

import { useState, useEffect, useCallback } from 'react';

interface PrdJson {
  project: string;
  branchName: string;
  description: string;
  devTasks: {
    id: string;
    title: string;
    description: string;
    acceptanceCriteria: string[];
    priority: number;
    passes: boolean;
    notes: string;
  }[];
}

interface JsonConvertStepProps {
  prdContent: string;
  projectName: string;
  onComplete: (prdJson: PrdJson) => void;
  onBack?: () => void;
}

export function JsonConvertStep({
  prdContent,
  projectName,
  onComplete,
  onBack,
}: JsonConvertStepProps) {
  const [prdJson, setPrdJson] = useState<PrdJson | null>(null);
  const [jsonString, setJsonString] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  useEffect(() => {
    const convertToJson = async () => {
      setIsLoading(true);
      try {
        // Mock conversion - in production, call API to convert PRD to JSON
        const mockPrdJson: PrdJson = {
          project: projectName || 'New Project',
          branchName: `feature/${projectName?.toLowerCase().replace(/\s+/g, '-') || 'new-feature'}`,
          description: 'PRD 描述内容',
          devTasks: [
            {
              id: 'DT-001',
              title: '示例任务 1',
              description: '这是从 PRD 转换的第一个开发任务',
              acceptanceCriteria: [
                '实现基本功能',
                'Typecheck passes',
                'Verify in browser',
              ],
              priority: 1,
              passes: false,
              notes: '',
            },
            {
              id: 'DT-002',
              title: '示例任务 2',
              description: '这是从 PRD 转换的第二个开发任务',
              acceptanceCriteria: [
                '实现数据验证',
                '添加错误处理',
                'Typecheck passes',
              ],
              priority: 2,
              passes: false,
              notes: '',
            },
          ],
        };

        await new Promise(resolve => setTimeout(resolve, 1000));
        setPrdJson(mockPrdJson);
        setJsonString(JSON.stringify(mockPrdJson, null, 2));
      } catch (error) {
        console.error('Failed to convert PRD:', error);
      } finally {
        setIsLoading(false);
      }
    };

    convertToJson();
  }, [prdContent, projectName]);

  const handleJsonChange = useCallback((newJsonString: string) => {
    setJsonString(newJsonString);
    setParseError(null);

    try {
      const parsed = JSON.parse(newJsonString);
      setPrdJson(parsed);
    } catch {
      setParseError('JSON 格式错误');
    }
  }, []);

  const handleSave = useCallback(async () => {
    if (!prdJson || parseError) return;

    setIsSaving(true);
    try {
      // In production, call API to save prd.json
      const response = await fetch('/api/prd/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(prdJson),
      });

      if (!response.ok) {
        throw new Error('Failed to save');
      }

      onComplete(prdJson);
    } catch (error) {
      console.error('Failed to save prd.json:', error);
      // Still complete even if save fails - user can save manually
      onComplete(prdJson);
    } finally {
      setIsSaving(false);
    }
  }, [prdJson, parseError, onComplete]);

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-neutral-600">正在转换为 JSON 格式...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col">
      {/* Header */}
      <div className="p-6 border-b border-neutral-200 bg-neutral-50">
        <h2 className="text-lg font-semibold text-neutral-900">JSON 转换</h2>
        <p className="text-sm text-neutral-500 mt-1">
          将 PRD 转换为 prd.json 格式，可编辑后保存
        </p>
      </div>

      {/* JSON Editor */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center justify-between p-4 border-b border-neutral-200 bg-white">
          <div className="flex items-center gap-4">
            <span className="text-sm text-neutral-500">prd.json</span>
            {parseError && (
              <span className="text-sm text-red-500">{parseError}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                const formatted = JSON.stringify(JSON.parse(jsonString), null, 2);
                setJsonString(formatted);
              }}
              disabled={!!parseError}
              className="px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100 rounded disabled:opacity-50"
            >
              格式化
            </button>
            <button
              onClick={() => navigator.clipboard.writeText(jsonString)}
              className="px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100 rounded"
            >
              复制
            </button>
          </div>
        </div>

        {/* Editor */}
        <div className="flex-1 overflow-hidden">
          <textarea
            value={jsonString}
            onChange={(e) => handleJsonChange(e.target.value)}
            className={`w-full h-full p-4 font-mono text-sm resize-none outline-none ${
              parseError ? 'bg-red-50' : 'bg-neutral-900 text-green-400'
            }`}
            spellCheck={false}
          />
        </div>

        {/* Task Summary */}
        {prdJson && !parseError && (
          <div className="p-4 border-t border-neutral-200 bg-neutral-50">
            <div className="flex items-center gap-6 text-sm">
              <span className="text-neutral-500">
                项目: <span className="text-neutral-900 font-medium">{prdJson.project}</span>
              </span>
              <span className="text-neutral-500">
                分支: <span className="text-neutral-900 font-medium">{prdJson.branchName}</span>
              </span>
              <span className="text-neutral-500">
                任务数: <span className="text-neutral-900 font-medium">{prdJson.devTasks.length}</span>
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="p-6 border-t border-neutral-200 bg-white flex justify-between">
        {onBack && (
          <button
            onClick={onBack}
            className="px-4 py-2 text-neutral-600 hover:text-neutral-800"
          >
            返回
          </button>
        )}
        <div className="flex gap-3">
          <button
            onClick={handleSave}
            disabled={!prdJson || !!parseError || isSaving}
            className={`px-6 py-2 rounded-lg font-medium transition-colors ${
              !prdJson || parseError || isSaving
                ? 'bg-neutral-200 text-neutral-400 cursor-not-allowed'
                : 'bg-green-600 text-white hover:bg-green-700'
            }`}
          >
            {isSaving ? '保存中...' : '保存 prd.json'}
          </button>
          <button
            onClick={() => prdJson && onComplete(prdJson)}
            disabled={!prdJson || !!parseError}
            className={`px-6 py-2 rounded-lg font-medium transition-colors ${
              !prdJson || parseError
                ? 'bg-neutral-200 text-neutral-400 cursor-not-allowed'
                : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}
          >
            开始开发 (Stage 3)
          </button>
        </div>
      </div>
    </div>
  );
}
