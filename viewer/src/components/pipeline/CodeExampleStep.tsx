'use client';

import { useState, useEffect, useCallback } from 'react';

export interface CodeExample {
  id: string;
  taskId: string;
  taskTitle: string;
  code: string;
  language: string;
  description: string;
  status: 'pending' | 'accepted' | 'modified' | 'skipped';
  modifiedCode?: string;
}

interface CodeExampleStepProps {
  prdContent: string;
  onComplete: (examples: CodeExample[]) => void;
  onBack?: () => void;
}

export function CodeExampleStep({
  prdContent,
  onComplete,
  onBack,
}: CodeExampleStepProps) {
  const [examples, setExamples] = useState<CodeExample[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editCode, setEditCode] = useState('');

  useEffect(() => {
    const generateExamples = async () => {
      setIsLoading(true);
      try {
        // Mock examples - in production, call API to generate code
        const mockExamples: CodeExample[] = [
          {
            id: '1',
            taskId: 'DT-001',
            taskTitle: '用户数据接口',
            language: 'typescript',
            description: '用户数据的 TypeScript 接口定义',
            code: `interface User {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
  updatedAt: Date;
}

interface UserCreateInput {
  name: string;
  email: string;
}`,
            status: 'pending',
          },
          {
            id: '2',
            taskId: 'DT-002',
            taskTitle: 'API 响应格式',
            language: 'typescript',
            description: 'API 统一响应格式定义',
            code: `interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}`,
            status: 'pending',
          },
        ];

        await new Promise(resolve => setTimeout(resolve, 1000));
        setExamples(mockExamples);
      } catch (error) {
        console.error('Failed to generate examples:', error);
      } finally {
        setIsLoading(false);
      }
    };

    generateExamples();
  }, [prdContent]);

  const handleAccept = useCallback((id: string) => {
    setExamples(prev =>
      prev.map(e => (e.id === id ? { ...e, status: 'accepted' as const } : e))
    );
  }, []);

  const handleSkip = useCallback((id: string) => {
    setExamples(prev =>
      prev.map(e => (e.id === id ? { ...e, status: 'skipped' as const } : e))
    );
  }, []);

  const handleModify = useCallback((id: string) => {
    const example = examples.find(e => e.id === id);
    if (example) {
      setEditingId(id);
      setEditCode(example.code);
    }
  }, [examples]);

  const handleSaveModify = useCallback(() => {
    if (editingId) {
      setExamples(prev =>
        prev.map(e =>
          e.id === editingId
            ? { ...e, status: 'modified' as const, modifiedCode: editCode }
            : e
        )
      );
      setEditingId(null);
      setEditCode('');
    }
  }, [editingId, editCode]);

  const handleCancelModify = useCallback(() => {
    setEditingId(null);
    setEditCode('');
  }, []);

  const allProcessed = examples.every(e => e.status !== 'pending');
  const processedCount = examples.filter(e => e.status !== 'pending').length;

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-neutral-600">正在生成代码示例...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <div className="p-6 border-b border-neutral-200 bg-neutral-50">
        <h2 className="text-lg font-semibold text-neutral-900">代码示例</h2>
        <p className="text-sm text-neutral-500 mt-1">
          为数据结构生成 TypeScript 接口定义
        </p>
        <div className="mt-3 flex items-center gap-2">
          <div className="flex-1 bg-neutral-200 h-2 rounded-full overflow-hidden">
            <div
              className="h-full bg-green-500 transition-all duration-300"
              style={{ width: `${examples.length > 0 ? (processedCount / examples.length) * 100 : 0}%` }}
            />
          </div>
          <span className="text-sm text-neutral-500">
            {processedCount}/{examples.length}
          </span>
        </div>
      </div>

      {/* Examples List */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {examples.length === 0 ? (
          <div className="text-center py-12 text-neutral-500">
            <p className="text-lg mb-2">没有需要生成的代码示例</p>
            <p className="text-sm">PRD 中没有涉及数据结构的任务</p>
          </div>
        ) : (
          examples.map((example) => (
            <CodeExampleCard
              key={example.id}
              example={example}
              isEditing={editingId === example.id}
              editCode={editCode}
              onEditCodeChange={setEditCode}
              onAccept={() => handleAccept(example.id)}
              onSkip={() => handleSkip(example.id)}
              onModify={() => handleModify(example.id)}
              onSaveModify={handleSaveModify}
              onCancelModify={handleCancelModify}
            />
          ))
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
        <button
          onClick={() => onComplete(examples)}
          disabled={!allProcessed && examples.length > 0}
          className={`px-6 py-2 rounded-lg font-medium transition-colors ${
            allProcessed || examples.length === 0
              ? 'bg-blue-600 text-white hover:bg-blue-700'
              : 'bg-neutral-200 text-neutral-400 cursor-not-allowed'
          }`}
        >
          继续下一步
        </button>
      </div>
    </div>
  );
}

function CodeExampleCard({
  example,
  isEditing,
  editCode,
  onEditCodeChange,
  onAccept,
  onSkip,
  onModify,
  onSaveModify,
  onCancelModify,
}: {
  example: CodeExample;
  isEditing: boolean;
  editCode: string;
  onEditCodeChange: (code: string) => void;
  onAccept: () => void;
  onSkip: () => void;
  onModify: () => void;
  onSaveModify: () => void;
  onCancelModify: () => void;
}) {
  const statusColors = {
    pending: 'border-yellow-200 bg-yellow-50',
    accepted: 'border-green-200 bg-green-50',
    modified: 'border-blue-200 bg-blue-50',
    skipped: 'border-neutral-200 bg-neutral-50 opacity-60',
  };

  const statusBadges = {
    pending: null,
    accepted: <span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded">已采纳</span>,
    modified: <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded">已修改</span>,
    skipped: <span className="text-xs px-2 py-0.5 bg-neutral-100 text-neutral-500 rounded">已跳过</span>,
  };

  return (
    <div className={`border rounded-lg p-4 ${statusColors[example.status]}`}>
      <div className="flex items-start justify-between mb-2">
        <div>
          <span className="text-xs px-2 py-0.5 bg-white rounded text-neutral-600">
            {example.taskId}
          </span>
          <h3 className="font-medium text-neutral-900 mt-1">{example.taskTitle}</h3>
          <p className="text-sm text-neutral-500">{example.description}</p>
        </div>
        {statusBadges[example.status]}
      </div>

      <div className="bg-neutral-900 rounded-lg p-4 my-3 overflow-x-auto">
        {isEditing ? (
          <textarea
            value={editCode}
            onChange={(e) => onEditCodeChange(e.target.value)}
            className="w-full bg-transparent text-green-400 font-mono text-sm resize-none outline-none"
            rows={10}
          />
        ) : (
          <pre className="text-green-400 font-mono text-sm whitespace-pre-wrap">
            {example.modifiedCode || example.code}
          </pre>
        )}
      </div>

      {example.status === 'pending' && !isEditing && (
        <div className="flex gap-2">
          <button
            onClick={onAccept}
            className="px-3 py-1.5 bg-green-600 text-white text-sm rounded hover:bg-green-700"
          >
            采纳
          </button>
          <button
            onClick={onModify}
            className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
          >
            修改
          </button>
          <button
            onClick={onSkip}
            className="px-3 py-1.5 bg-neutral-200 text-neutral-600 text-sm rounded hover:bg-neutral-300"
          >
            跳过
          </button>
        </div>
      )}

      {isEditing && (
        <div className="flex gap-2">
          <button
            onClick={onSaveModify}
            className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
          >
            保存修改
          </button>
          <button
            onClick={onCancelModify}
            className="px-3 py-1.5 bg-neutral-200 text-neutral-600 text-sm rounded hover:bg-neutral-300"
          >
            取消
          </button>
        </div>
      )}
    </div>
  );
}
