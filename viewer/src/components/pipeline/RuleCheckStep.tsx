'use client';

import { useState, useEffect, useCallback } from 'react';

export interface RuleViolation {
  id: string;
  ruleName: string;
  category: string;
  description: string;
  suggestion: string;
  status: 'pending' | 'accepted' | 'modified' | 'skipped';
  modifiedContent?: string;
}

interface RuleCheckStepProps {
  prdContent: string;
  onComplete: (violations: RuleViolation[]) => void;
  onBack?: () => void;
}

export function RuleCheckStep({
  prdContent,
  onComplete,
  onBack,
}: RuleCheckStepProps) {
  const [violations, setViolations] = useState<RuleViolation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');

  // Load and check rules
  useEffect(() => {
    const checkRules = async () => {
      setIsLoading(true);
      try {
        // Mock violations for now - in production, call API to check against rules
        const mockViolations: RuleViolation[] = [
          {
            id: '1',
            ruleName: '命名规范',
            category: 'frontend',
            description: 'API 端点命名应使用 kebab-case',
            suggestion: '将 /api/getUserData 改为 /api/get-user-data',
            status: 'pending',
          },
          {
            id: '2',
            ruleName: '错误处理',
            category: 'backend',
            description: '缺少错误处理描述',
            suggestion: '添加错误码定义和错误消息格式说明',
            status: 'pending',
          },
        ];

        // Simulate API delay
        await new Promise(resolve => setTimeout(resolve, 1000));
        setViolations(mockViolations);
      } catch (error) {
        console.error('Failed to check rules:', error);
      } finally {
        setIsLoading(false);
      }
    };

    checkRules();
  }, [prdContent]);

  const handleAccept = useCallback((id: string) => {
    setViolations(prev =>
      prev.map(v => (v.id === id ? { ...v, status: 'accepted' as const } : v))
    );
  }, []);

  const handleSkip = useCallback((id: string) => {
    setViolations(prev =>
      prev.map(v => (v.id === id ? { ...v, status: 'skipped' as const } : v))
    );
  }, []);

  const handleModify = useCallback((id: string) => {
    const violation = violations.find(v => v.id === id);
    if (violation) {
      setEditingId(id);
      setEditContent(violation.suggestion);
    }
  }, [violations]);

  const handleSaveModify = useCallback(() => {
    if (editingId) {
      setViolations(prev =>
        prev.map(v =>
          v.id === editingId
            ? { ...v, status: 'modified' as const, modifiedContent: editContent }
            : v
        )
      );
      setEditingId(null);
      setEditContent('');
    }
  }, [editingId, editContent]);

  const handleCancelModify = useCallback(() => {
    setEditingId(null);
    setEditContent('');
  }, []);

  const allProcessed = violations.every(v => v.status !== 'pending');
  const processedCount = violations.filter(v => v.status !== 'pending').length;

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-neutral-600">正在检查规范...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col">
      {/* Header */}
      <div className="p-6 border-b border-neutral-200 bg-neutral-50">
        <h2 className="text-lg font-semibold text-neutral-900">规范检查</h2>
        <p className="text-sm text-neutral-500 mt-1">
          检查 PRD 是否符合项目规范，处理不符合项
        </p>
        <div className="mt-3 flex items-center gap-2">
          <div className="flex-1 bg-neutral-200 h-2 rounded-full overflow-hidden">
            <div
              className="h-full bg-green-500 transition-all duration-300"
              style={{ width: `${(processedCount / violations.length) * 100}%` }}
            />
          </div>
          <span className="text-sm text-neutral-500">
            {processedCount}/{violations.length}
          </span>
        </div>
      </div>

      {/* Violations List */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {violations.length === 0 ? (
          <div className="text-center py-12 text-neutral-500">
            <p className="text-lg mb-2">没有发现规范问题</p>
            <p className="text-sm">PRD 符合所有规范要求</p>
          </div>
        ) : (
          violations.map((violation) => (
            <ViolationCard
              key={violation.id}
              violation={violation}
              isEditing={editingId === violation.id}
              editContent={editContent}
              onEditContentChange={setEditContent}
              onAccept={() => handleAccept(violation.id)}
              onSkip={() => handleSkip(violation.id)}
              onModify={() => handleModify(violation.id)}
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
          onClick={() => onComplete(violations)}
          disabled={!allProcessed && violations.length > 0}
          className={`px-6 py-2 rounded-lg font-medium transition-colors ${
            allProcessed || violations.length === 0
              ? 'bg-blue-600 text-white hover:bg-blue-700'
              : 'bg-neutral-200 text-neutral-400 cursor-not-allowed'
          }`}
        >
          {violations.length === 0 ? '继续下一步' : '完成检查，继续下一步'}
        </button>
      </div>
    </div>
  );
}

function ViolationCard({
  violation,
  isEditing,
  editContent,
  onEditContentChange,
  onAccept,
  onSkip,
  onModify,
  onSaveModify,
  onCancelModify,
}: {
  violation: RuleViolation;
  isEditing: boolean;
  editContent: string;
  onEditContentChange: (content: string) => void;
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
    <div className={`border rounded-lg p-4 ${statusColors[violation.status]}`}>
      <div className="flex items-start justify-between mb-2">
        <div>
          <span className="text-xs px-2 py-0.5 bg-white rounded text-neutral-600">
            {violation.category}
          </span>
          <h3 className="font-medium text-neutral-900 mt-1">{violation.ruleName}</h3>
        </div>
        {statusBadges[violation.status]}
      </div>

      <p className="text-sm text-neutral-700 mb-3">{violation.description}</p>

      <div className="bg-white rounded p-3 mb-3">
        <p className="text-xs text-neutral-500 mb-1">建议修改：</p>
        {isEditing ? (
          <textarea
            value={editContent}
            onChange={(e) => onEditContentChange(e.target.value)}
            className="w-full p-2 border border-neutral-300 rounded text-sm resize-none"
            rows={3}
          />
        ) : (
          <p className="text-sm text-neutral-800">
            {violation.modifiedContent || violation.suggestion}
          </p>
        )}
      </div>

      {violation.status === 'pending' && !isEditing && (
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
