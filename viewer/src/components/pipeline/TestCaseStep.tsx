'use client';

import { useState, useCallback, useRef } from 'react';

export interface TestCase {
  id: string;
  taskId: string;
  taskTitle: string;
  type: 'unit' | 'e2e';
  description: string;
  steps?: string[];
}

// Generation state
type GeneratingState = 'idle' | 'generating' | 'completed' | 'error';

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

  // CLI generation state
  const [generatingState, setGeneratingState] = useState<GeneratingState>('idle');
  const [generatingProgress, setGeneratingProgress] = useState(0);
  const [generatingMessage, setGeneratingMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Start generation with CLI
  const handleStartGeneration = useCallback(async () => {
    if (!prdContent) {
      setError('没有 PRD 内容可供分析');
      return;
    }

    setGeneratingState('generating');
    setGeneratingProgress(0);
    setGeneratingMessage('正在分析 PRD 内容...');
    setError(null);
    setTestCases([]);

    try {
      const prompt = `请分析以下 PRD 内容，为每个开发任务生成相应的测试用例（包括单元测试和端到端测试）。

## PRD 内容

${prdContent}

## 要求

1. 识别 PRD 中的所有开发任务
2. 为每个任务生成适当的测试用例
3. 区分单元测试（unit）和端到端测试（e2e）
4. 提供清晰的测试描述和测试步骤

## 输出格式

请以 JSON 格式输出生成的测试用例，格式如下：
\`\`\`json
{
  "testCases": [
    {
      "taskId": "DT-001",
      "taskTitle": "任务标题",
      "type": "unit",
      "description": "测试描述",
      "steps": ["步骤1", "步骤2", "步骤3"]
    },
    {
      "taskId": "DT-001",
      "taskTitle": "任务标题",
      "type": "e2e",
      "description": "端到端测试描述",
      "steps": ["步骤1", "步骤2", "步骤3"]
    }
  ]
}
\`\`\`

如果 PRD 中没有可测试的任务，请输出空数组：
\`\`\`json
{ "testCases": [] }
\`\`\``;

      abortControllerRef.current = new AbortController();

      const response = await fetch('/api/cli/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: prompt,
          mode: 'default',
        }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'CLI 调用失败');
      }

      // Process SSE stream
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('无法获取响应流');
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let progressValue = 0;
      let fullContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (!data) continue;

            try {
              const parsed = JSON.parse(data);

              if (parsed.type === 'text') {
                fullContent += parsed.content;

                // Update progress
                progressValue = Math.min(progressValue + 3, 90);
                setGeneratingProgress(progressValue);
                setGeneratingMessage('正在生成测试用例...');
              } else if (parsed.type === 'error') {
                throw new Error(parsed.error);
              } else if (parsed.type === 'done') {
                break;
              }
            } catch (parseError) {
              // Ignore JSON parse errors (incomplete data)
              if (parseError instanceof Error &&
                  !parseError.message.includes('Unexpected') &&
                  !parseError.message.includes('JSON')) {
                throw parseError;
              }
            }
          }
        }
      }

      // Parse the generated test cases from fullContent
      setGeneratingProgress(95);
      setGeneratingMessage('正在解析生成结果...');

      const parsedTestCases = parseGeneratedTestCases(fullContent);

      setTestCases(parsedTestCases);
      setGeneratingProgress(100);
      setGeneratingState('completed');
      setGeneratingMessage('生成完成！');

    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        // Cancelled by user
        setGeneratingState('idle');
        return;
      }

      const errorMessage = err instanceof Error ? err.message : '未知错误';
      setError(errorMessage);
      setGeneratingState('error');
      setGeneratingMessage('生成失败');
    }
  }, [prdContent]);

  // Cancel generation
  const cancelGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setGeneratingState('idle');
    setGeneratingProgress(0);
    setGeneratingMessage('');
  }, []);

  const unitTests = testCases.filter(t => t.type === 'unit');
  const e2eTests = testCases.filter(t => t.type === 'e2e');

  // Show initial state - prompt user to start generation
  if (generatingState === 'idle' && testCases.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-blue-100 flex items-center justify-center">
            <span className="text-2xl">🧪</span>
          </div>
          <h2 className="text-lg font-semibold text-neutral-900 mb-2">生成测试用例</h2>
          <p className="text-sm text-neutral-500 mb-6">
            分析 PRD 内容，为开发任务生成单元测试和端到端测试用例
          </p>
          {error && (
            <p className="text-sm text-red-600 mb-4">{error}</p>
          )}
          <div className="flex justify-center gap-4">
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                className="px-4 py-2 text-neutral-600 hover:text-neutral-800"
              >
                返回
              </button>
            )}
            <button
              type="button"
              onClick={handleStartGeneration}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
            >
              开始生成
            </button>
            <button
              type="button"
              onClick={() => onComplete([])}
              className="px-4 py-2 text-neutral-600 hover:text-neutral-800"
            >
              跳过此步
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Show generating progress UI
  if (generatingState === 'generating' || generatingState === 'error') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-md">
          {/* Progress Header */}
          <div className="text-center mb-6">
            {generatingState === 'error' ? (
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-100 flex items-center justify-center">
                <span className="text-2xl">❌</span>
              </div>
            ) : (
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-blue-100 flex items-center justify-center">
                <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full" />
              </div>
            )}
            <h3 className="text-lg font-semibold text-neutral-900">
              {generatingState === 'error' ? '生成失败' : '正在生成测试用例'}
            </h3>
            <p className="text-sm text-neutral-500 mt-1">{generatingMessage}</p>
            {error && (
              <p className="text-sm text-red-600 mt-2">{error}</p>
            )}
          </div>

          {/* Progress Bar */}
          <div className="mb-6">
            <div className="flex justify-between text-sm text-neutral-600 mb-2">
              <span>进度</span>
              <span>{generatingProgress}%</span>
            </div>
            <div className="w-full h-2 bg-neutral-200 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-300 ${
                  generatingState === 'error' ? 'bg-red-500' : 'bg-blue-500'
                }`}
                style={{ width: `${generatingProgress}%` }}
              />
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex justify-center gap-4">
            {generatingState === 'error' ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setGeneratingState('idle');
                    setError(null);
                  }}
                  className="px-4 py-2 text-neutral-600 hover:text-neutral-800"
                >
                  返回
                </button>
                <button
                  type="button"
                  onClick={handleStartGeneration}
                  className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  重试
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={cancelGeneration}
                className="px-4 py-2 text-neutral-600 hover:text-neutral-800 border border-neutral-300 rounded-lg"
              >
                取消
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Show test cases list (completed state or reviewing)
  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <div className="p-6 border-b border-neutral-200 bg-neutral-50">
        <h2 className="text-lg font-semibold text-neutral-900">测试用例</h2>
        <p className="text-sm text-neutral-500 mt-1">
          已生成 {testCases.length} 个测试用例，确认后将全部添加到 PRD
        </p>
        <div className="mt-2 flex gap-4 text-sm">
          <span className="px-2 py-1 bg-purple-100 text-purple-700 rounded">
            单元测试: {unitTests.length}
          </span>
          <span className="px-2 py-1 bg-orange-100 text-orange-700 rounded">
            E2E 测试: {e2eTests.length}
          </span>
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
            <TestCaseCard key={testCase.id} testCase={testCase} />
          ))
        )}
      </div>

      {/* Footer */}
      <div className="p-6 border-t border-neutral-200 bg-white flex justify-between">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="px-4 py-2 text-neutral-600 hover:text-neutral-800"
          >
            返回
          </button>
        )}
        <button
          type="button"
          onClick={() => onComplete(testCases)}
          className="px-6 py-2 rounded-lg font-medium transition-colors ml-auto bg-blue-600 text-white hover:bg-blue-700"
        >
          {testCases.length === 0 ? '继续下一步' : `确认全部 ${testCases.length} 个测试用例`}
        </button>
      </div>
    </div>
  );
}

// Parse generated test cases from CLI response
function parseGeneratedTestCases(content: string): TestCase[] {
  try {
    // Try to find JSON block in the content
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonMatch && jsonMatch[1]) {
      const parsed = JSON.parse(jsonMatch[1]);
      if (parsed.testCases && Array.isArray(parsed.testCases)) {
        return parsed.testCases.map((tc: {
          taskId?: string;
          taskTitle?: string;
          type?: string;
          description?: string;
          steps?: string[];
        }, index: number) => ({
          id: String(index + 1),
          taskId: tc.taskId || `DT-${String(index + 1).padStart(3, '0')}`,
          taskTitle: tc.taskTitle || '未命名任务',
          type: (tc.type === 'unit' || tc.type === 'e2e') ? tc.type : 'unit',
          description: tc.description || '',
          steps: tc.steps || [],
        }));
      }
    }

    // Try to parse as raw JSON
    const rawParsed = JSON.parse(content);
    if (rawParsed.testCases && Array.isArray(rawParsed.testCases)) {
      return rawParsed.testCases.map((tc: {
        taskId?: string;
        taskTitle?: string;
        type?: string;
        description?: string;
        steps?: string[];
      }, index: number) => ({
        id: String(index + 1),
        taskId: tc.taskId || `DT-${String(index + 1).padStart(3, '0')}`,
        taskTitle: tc.taskTitle || '未命名任务',
        type: (tc.type === 'unit' || tc.type === 'e2e') ? tc.type : 'unit',
        description: tc.description || '',
        steps: tc.steps || [],
      }));
    }
  } catch {
    // If parsing fails, return empty array
    console.error('Failed to parse generated test cases');
  }

  return [];
}

function TestCaseCard({ testCase }: { testCase: TestCase }) {
  const typeBadge = testCase.type === 'unit'
    ? <span className="text-xs px-2 py-0.5 bg-purple-100 text-purple-700 rounded">单元测试</span>
    : <span className="text-xs px-2 py-0.5 bg-orange-100 text-orange-700 rounded">E2E 测试</span>;

  return (
    <div className="border border-neutral-200 rounded-lg p-4 bg-white">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs px-2 py-0.5 bg-neutral-100 rounded text-neutral-600">
          {testCase.taskId}
        </span>
        {typeBadge}
      </div>

      <h3 className="font-medium text-neutral-900">{testCase.taskTitle}</h3>
      <p className="text-sm text-neutral-700 mt-2">{testCase.description}</p>

      {testCase.steps && testCase.steps.length > 0 && (
        <div className="mt-3 bg-neutral-50 rounded p-3">
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
    </div>
  );
}
