'use client';

import { useState, useEffect, useCallback } from 'react';

export interface TestCase {
  id: string;
  taskId: string;
  taskTitle: string;
  type: 'unit' | 'e2e';
  description: string;
  steps?: string[];
  status: 'pending' | 'accepted' | 'modified' | 'skipped';
  modifiedDescription?: string;
}

interface TestCaseStepProps {
  prdContent: string;
  onComplete: (testCases: TestCase[]) => void;
  onBack?: () => void;
}

export function TestCaseStep({
  prdContent,
  onComplete,
  onBack,
}: TestCaseStepProps) {
  const [testCases, setTestCases] = useState<TestCase[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDescription, setEditDescription] = useState('');

  useEffect(() => {
    const generateTestCases = async () => {
      setIsLoading(true);
      try {
        // Mock test cases - in production, call API to generate
        const mockTestCases: TestCase[] = [
          {
            id: '1',
            taskId: 'DT-001',
            taskTitle: '用户创建功能',
            type: 'unit',
            description: '测试用户创建接口的输入验证',
            steps: [
              '测试有效输入时成功创建用户',
              '测试邮箱格式无效时返回错误',
              '测试用户名为空时返回错误',
              '测试重复邮箱时返回错误',
            ],
            status: 'pending',
          },
          {
            id: '2',
            taskId: 'DT-001',
            taskTitle: '用户创建功能',
            type: 'e2e',
            description: '端到端测试用户注册流程',
            steps: [
              '打开注册页面',
              '填写用户信息表单',
              '点击提交按钮',
              '验证跳转到欢迎页面',
              '验证用户数据已保存到数据库',
            ],
            status: 'pending',
          },
          {
            id: '3',
            taskId: 'DT-002',
            taskTitle: 'API 错误处理',
            type: 'unit',
            description: '测试 API 错误响应格式',
            steps: [
              '测试 404 错误返回正确格式',
              '测试 500 错误返回正确格式',
              '测试验证错误包含字段信息',
            ],
            status: 'pending',
          },
        ];

        await new Promise(resolve => setTimeout(resolve, 1000));
        setTestCases(mockTestCases);
      } catch (error) {
        console.error('Failed to generate test cases:', error);
      } finally {
        setIsLoading(false);
      }
    };

    generateTestCases();
  }, [prdContent]);

  const handleAccept = useCallback((id: string) => {
    setTestCases(prev =>
      prev.map(t => (t.id === id ? { ...t, status: 'accepted' as const } : t))
    );
  }, []);

  const handleSkip = useCallback((id: string) => {
    setTestCases(prev =>
      prev.map(t => (t.id === id ? { ...t, status: 'skipped' as const } : t))
    );
  }, []);

  const handleModify = useCallback((id: string) => {
    const testCase = testCases.find(t => t.id === id);
    if (testCase) {
      setEditingId(id);
      setEditDescription(testCase.description);
    }
  }, [testCases]);

  const handleSaveModify = useCallback(() => {
    if (editingId) {
      setTestCases(prev =>
        prev.map(t =>
          t.id === editingId
            ? { ...t, status: 'modified' as const, modifiedDescription: editDescription }
            : t
        )
      );
      setEditingId(null);
      setEditDescription('');
    }
  }, [editingId, editDescription]);

  const handleCancelModify = useCallback(() => {
    setEditingId(null);
    setEditDescription('');
  }, []);

  const allProcessed = testCases.every(t => t.status !== 'pending');
  const processedCount = testCases.filter(t => t.status !== 'pending').length;
  const unitTests = testCases.filter(t => t.type === 'unit');
  const e2eTests = testCases.filter(t => t.type === 'e2e');

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-neutral-600">正在生成测试用例...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <div className="p-6 border-b border-neutral-200 bg-neutral-50">
        <h2 className="text-lg font-semibold text-neutral-900">测试用例</h2>
        <p className="text-sm text-neutral-500 mt-1">
          生成单元测试和端到端测试用例描述
        </p>
        <div className="mt-3 flex items-center gap-2">
          <div className="flex-1 bg-neutral-200 h-2 rounded-full overflow-hidden">
            <div
              className="h-full bg-green-500 transition-all duration-300"
              style={{ width: `${testCases.length > 0 ? (processedCount / testCases.length) * 100 : 0}%` }}
            />
          </div>
          <span className="text-sm text-neutral-500">
            {processedCount}/{testCases.length}
          </span>
        </div>
        <div className="mt-2 flex gap-4 text-xs text-neutral-500">
          <span>单元测试: {unitTests.length}</span>
          <span>E2E 测试: {e2eTests.length}</span>
        </div>
      </div>

      {/* Test Cases List */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {testCases.length === 0 ? (
          <div className="text-center py-12 text-neutral-500">
            <p className="text-lg mb-2">没有需要生成的测试用例</p>
            <p className="text-sm">PRD 中没有可测试的任务</p>
          </div>
        ) : (
          testCases.map((testCase) => (
            <TestCaseCard
              key={testCase.id}
              testCase={testCase}
              isEditing={editingId === testCase.id}
              editDescription={editDescription}
              onEditDescriptionChange={setEditDescription}
              onAccept={() => handleAccept(testCase.id)}
              onSkip={() => handleSkip(testCase.id)}
              onModify={() => handleModify(testCase.id)}
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
          onClick={() => onComplete(testCases)}
          disabled={!allProcessed && testCases.length > 0}
          className={`px-6 py-2 rounded-lg font-medium transition-colors ${
            allProcessed || testCases.length === 0
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

function TestCaseCard({
  testCase,
  isEditing,
  editDescription,
  onEditDescriptionChange,
  onAccept,
  onSkip,
  onModify,
  onSaveModify,
  onCancelModify,
}: {
  testCase: TestCase;
  isEditing: boolean;
  editDescription: string;
  onEditDescriptionChange: (description: string) => void;
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

  const typeBadge = testCase.type === 'unit'
    ? <span className="text-xs px-2 py-0.5 bg-purple-100 text-purple-700 rounded">单元测试</span>
    : <span className="text-xs px-2 py-0.5 bg-orange-100 text-orange-700 rounded">E2E 测试</span>;

  return (
    <div className={`border rounded-lg p-4 ${statusColors[testCase.status]}`}>
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-xs px-2 py-0.5 bg-white rounded text-neutral-600">
            {testCase.taskId}
          </span>
          {typeBadge}
        </div>
        {statusBadges[testCase.status]}
      </div>

      <h3 className="font-medium text-neutral-900 mt-2">{testCase.taskTitle}</h3>

      {isEditing ? (
        <textarea
          value={editDescription}
          onChange={(e) => onEditDescriptionChange(e.target.value)}
          className="w-full mt-2 p-2 border border-neutral-300 rounded text-sm resize-none"
          rows={3}
        />
      ) : (
        <p className="text-sm text-neutral-700 mt-2">
          {testCase.modifiedDescription || testCase.description}
        </p>
      )}

      {testCase.steps && testCase.steps.length > 0 && !isEditing && (
        <div className="mt-3 bg-white rounded p-3">
          <p className="text-xs text-neutral-500 mb-2">测试步骤：</p>
          <ul className="space-y-1">
            {testCase.steps.map((step, index) => (
              <li key={index} className="text-sm text-neutral-700 flex items-start gap-2">
                <span className="text-neutral-400">{index + 1}.</span>
                {step}
              </li>
            ))}
          </ul>
        </div>
      )}

      {testCase.status === 'pending' && !isEditing && (
        <div className="flex gap-2 mt-3">
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
        <div className="flex gap-2 mt-3">
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
