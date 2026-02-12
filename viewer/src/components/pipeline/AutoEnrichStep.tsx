'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import type { SpecCodeExample, SpecTestCase, DevTaskEval, PipelineMode } from '@/lib/tool-types';

/** DevTaskEval with taskId for matching to tasks during enrichment */
export interface AutoEnrichEval extends DevTaskEval {
  taskId?: string;
}

export interface AutoEnrichResult {
  codeExamples: SpecCodeExample[];
  testCases: SpecTestCase[];
  filesToModify: string[];
  evals: AutoEnrichEval[];
  dependencies: { taskId: string; dependsOn: string[] }[];
  sessions: { id: string; tasks: string[]; reason?: string }[];
}

interface AutoEnrichStepProps {
  prdContent: string;
  mode: PipelineMode;
  onComplete: (result: AutoEnrichResult) => void;
  onBack?: () => void;
}

// Generation state
type GeneratingState = 'idle' | 'generating' | 'completed' | 'error';

export function AutoEnrichStep({
  prdContent,
  mode,
  onComplete,
  onBack,
}: AutoEnrichStepProps) {
  const [result, setResult] = useState<AutoEnrichResult | null>(null);

  // CLI generation state
  const [generatingState, setGeneratingState] = useState<GeneratingState>('idle');
  const [generatingProgress, setGeneratingProgress] = useState(0);
  const [generatingMessage, setGeneratingMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const autoCompletedRef = useRef(false);

  // Auto-complete for feature mode when result is ready
  useEffect(() => {
    if (mode === 'feature' && generatingState === 'completed' && result && !autoCompletedRef.current) {
      autoCompletedRef.current = true;
      onComplete(result);
    }
  }, [mode, generatingState, result, onComplete]);

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
    setResult(null);
    autoCompletedRef.current = false;

    try {
      const prompt = `请分析以下 PRD 内容，同时生成代码示例和测试用例。

## PRD 内容

${prdContent}

## 要求

1. 识别 PRD 中的所有开发任务
2. 为每个涉及数据结构的任务生成 TypeScript 代码示例（接口定义、数据结构等）
3. 为每个任务生成测试用例（单元测试和端到端测试）
4. 列出需要修改的文件路径
5. 为每个任务生成可执行的验证命令（evals）
   - code-based eval: shell 命令验证（如 typecheck、grep 检查）
   - 每个任务至少生成一个 "npx tsc --noEmit" 的 typecheck eval
6. 分析任务间的依赖关系
   - 如果任务 B 依赖任务 A 创建的类型、组件或 API → B dependsOn A
   - 如果任务修改同一个文件且有顺序要求 → 标记依赖
   - 没有依赖的任务 dependsOn 为空数组
7. 将任务分成 sessions（每 session 最多 8 个 DT）
   - 有依赖关系的任务放同一 session
   - 修改同一批文件的任务放同一 session
   - 独立的任务按 priority 填充
   - 每个 session 附带分组原因

## 输出格式

请以 JSON 格式输出，格式如下：
\`\`\`json
{
  "codeExamples": [
    {
      "language": "typescript",
      "description": "代码描述",
      "code": "代码内容"
    }
  ],
  "testCases": [
    {
      "type": "unit",
      "description": "测试描述",
      "steps": ["步骤1", "步骤2"]
    }
  ],
  "filesToModify": ["src/..."],
  "evals": [
    {
      "taskId": "DT-001",
      "type": "code-based",
      "blocking": true,
      "description": "Typecheck 通过",
      "command": "npx tsc --noEmit",
      "expect": "exit-0"
    }
  ],
  "dependencies": [
    { "taskId": "DT-005", "dependsOn": ["DT-003"] }
  ],
  "sessions": [
    { "id": "S1", "tasks": ["DT-001", "DT-002", "DT-003"], "reason": "分组原因" }
  ]
}
\`\`\`

如果 PRD 中没有涉及数据结构或可测试的任务，请输出空数组：
\`\`\`json
{ "codeExamples": [], "testCases": [], "filesToModify": [], "evals": [], "dependencies": [], "sessions": [] }
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
                progressValue = Math.min(progressValue + 2, 90);
                setGeneratingProgress(progressValue);
                setGeneratingMessage('正在生成代码示例和测试用例...');
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

      // Parse the generated result from fullContent
      setGeneratingProgress(95);
      setGeneratingMessage('正在解析生成结果...');

      const parsedResult = parseAutoEnrichResult(fullContent);

      setResult(parsedResult);
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

  // Show initial state - prompt user to start generation
  if (generatingState === 'idle' && !result) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-blue-100 flex items-center justify-center">
            <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-neutral-900 mb-2">自动生成代码示例和测试用例</h2>
          <p className="text-sm text-neutral-500 mb-6">
            一键生成代码示例和测试用例，用于指导开发
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
              一键生成
            </button>
            <button
              type="button"
              onClick={() => onComplete({ codeExamples: [], testCases: [], filesToModify: [], evals: [], dependencies: [], sessions: [] })}
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
                <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
            ) : (
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-blue-100 flex items-center justify-center">
                <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full" />
              </div>
            )}
            <h3 className="text-lg font-semibold text-neutral-900">
              {generatingState === 'error' ? '生成失败' : '正在自动生成'}
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

  // Completed state: in 'full' mode, show review UI
  // In 'feature' mode, auto-complete is handled by useEffect above
  if (result) {
    return (
      <div className="flex-1 flex flex-col min-h-0">
        {/* Header */}
        <div className="p-6 border-b border-neutral-200 bg-neutral-50">
          <h2 className="text-lg font-semibold text-neutral-900">生成结果预览</h2>
          <p className="text-sm text-neutral-500 mt-1">
            已生成 {result.codeExamples.length} 个代码示例、{result.testCases.length} 个测试用例、{result.evals.length} 个验证命令
          </p>
          <div className="mt-2 flex gap-4 text-sm flex-wrap">
            <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded">
              代码示例: {result.codeExamples.length}
            </span>
            <span className="px-2 py-1 bg-purple-100 text-purple-700 rounded">
              测试用例: {result.testCases.length}
            </span>
            <span className="px-2 py-1 bg-green-100 text-green-700 rounded">
              待修改文件: {result.filesToModify.length}
            </span>
            <span className="px-2 py-1 bg-amber-100 text-amber-700 rounded">
              验证命令: {result.evals.length}
            </span>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Code Examples */}
          {result.codeExamples.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-neutral-700 mb-3">代码示例</h3>
              <div className="space-y-3">
                {result.codeExamples.map((example, index) => (
                  <div key={index} className="border border-neutral-200 rounded-lg p-4 bg-white">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded">
                        {example.language}
                      </span>
                      <span className="text-sm text-neutral-700">{example.description}</span>
                    </div>
                    <div className="bg-neutral-900 rounded-lg p-4 overflow-x-auto">
                      <pre className="text-green-400 font-mono text-sm whitespace-pre-wrap">
                        {example.code}
                      </pre>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Test Cases */}
          {result.testCases.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-neutral-700 mb-3">测试用例</h3>
              <div className="space-y-3">
                {result.testCases.map((testCase, index) => (
                  <div key={index} className="border border-neutral-200 rounded-lg p-4 bg-white">
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`text-xs px-2 py-0.5 rounded ${
                        testCase.type === 'unit'
                          ? 'bg-purple-100 text-purple-700'
                          : 'bg-orange-100 text-orange-700'
                      }`}>
                        {testCase.type === 'unit' ? '单元测试' : 'E2E 测试'}
                      </span>
                      <span className="text-sm text-neutral-700">{testCase.description}</span>
                    </div>
                    {testCase.steps && testCase.steps.length > 0 && (
                      <div className="bg-neutral-50 rounded p-3 mt-2">
                        <ul className="space-y-1">
                          {testCase.steps.map((step, stepIndex) => (
                            <li key={stepIndex} className="text-sm text-neutral-700 flex items-start gap-2">
                              <span className="text-neutral-400">{stepIndex + 1}.</span>
                              {step}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Files to Modify */}
          {result.filesToModify.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-neutral-700 mb-3">待修改文件</h3>
              <div className="bg-neutral-50 rounded-lg p-4">
                <ul className="space-y-1">
                  {result.filesToModify.map((file, index) => (
                    <li key={index} className="text-sm text-neutral-700 font-mono">{file}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {/* Evals */}
          {result.evals.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-neutral-700 mb-3">验证命令 (Evals)</h3>
              <div className="space-y-3">
                {result.evals.map((evalItem, index) => (
                  <div key={index} className="border border-neutral-200 rounded-lg p-4 bg-white">
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`text-xs px-2 py-0.5 rounded ${
                        evalItem.type === 'code-based'
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-teal-100 text-teal-700'
                      }`}>
                        {evalItem.type === 'code-based' ? 'Code-based' : 'Model-based'}
                      </span>
                      {evalItem.blocking && (
                        <span className="text-xs px-2 py-0.5 bg-red-100 text-red-700 rounded">
                          Blocking
                        </span>
                      )}
                      <span className="text-sm text-neutral-700">{evalItem.description}</span>
                    </div>
                    {evalItem.command && (
                      <div className="bg-neutral-900 rounded-lg p-3 overflow-x-auto">
                        <code className="text-green-400 font-mono text-sm">{evalItem.command}</code>
                      </div>
                    )}
                    {evalItem.expect && (
                      <div className="mt-2 text-xs text-neutral-500">
                        期望结果: <span className="font-mono">{evalItem.expect}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Empty state */}
          {result.codeExamples.length === 0 && result.testCases.length === 0 && (
            <div className="text-center py-12 text-neutral-500">
              <p className="text-lg mb-2">没有生成内容</p>
              <p className="text-sm">PRD 中没有涉及可生成的代码示例或测试用例</p>
            </div>
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
            onClick={() => onComplete(result)}
            className="px-6 py-2 rounded-lg font-medium transition-colors ml-auto bg-blue-600 text-white hover:bg-blue-700"
          >
            确认并继续
          </button>
        </div>
      </div>
    );
  }

  return null;
}

// Parse auto-enrich result from CLI response
function parseAutoEnrichResult(content: string): AutoEnrichResult {
  const emptyResult: AutoEnrichResult = { codeExamples: [], testCases: [], filesToModify: [], evals: [], dependencies: [], sessions: [] };

  try {
    // Try to find JSON block in the content
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonMatch && jsonMatch[1]) {
      const parsed = JSON.parse(jsonMatch[1]);
      return normalizeResult(parsed);
    }

    // Try to parse as raw JSON
    const rawParsed = JSON.parse(content);
    return normalizeResult(rawParsed);
  } catch {
    console.error('Failed to parse auto-enrich result');
  }

  return emptyResult;
}

function normalizeResult(parsed: Record<string, unknown>): AutoEnrichResult {
  const codeExamples: SpecCodeExample[] = Array.isArray(parsed.codeExamples)
    ? (parsed.codeExamples as Record<string, unknown>[]).map((ex) => ({
        language: (ex.language as string) || 'typescript',
        description: (ex.description as string) || '',
        code: (ex.code as string) || '',
      }))
    : [];

  const testCases: SpecTestCase[] = Array.isArray(parsed.testCases)
    ? (parsed.testCases as Record<string, unknown>[]).map((tc) => ({
        type: ((tc.type as string) === 'unit' || (tc.type as string) === 'e2e') ? (tc.type as 'unit' | 'e2e') : 'unit',
        description: (tc.description as string) || '',
        steps: Array.isArray(tc.steps) ? (tc.steps as string[]) : [],
      }))
    : [];

  const filesToModify: string[] = Array.isArray(parsed.filesToModify)
    ? (parsed.filesToModify as string[])
    : [];

  const evals: AutoEnrichEval[] = Array.isArray(parsed.evals)
    ? (parsed.evals as Record<string, unknown>[]).map((ev) => ({
        type: ((ev.type as string) === 'code-based' || (ev.type as string) === 'model-based') ? (ev.type as 'code-based' | 'model-based') : 'code-based',
        blocking: (ev.blocking as boolean) ?? true,
        description: (ev.description as string) || '',
        command: (ev.command as string) || undefined,
        expect: (ev.expect as string) || undefined,
        files: Array.isArray(ev.files) ? (ev.files as string[]) : undefined,
        criteria: (ev.criteria as string) || undefined,
        taskId: (ev.taskId as string) || undefined,
      }))
    : [];

  const dependencies: { taskId: string; dependsOn: string[] }[] = Array.isArray(parsed.dependencies)
    ? (parsed.dependencies as Record<string, unknown>[]).map((dep) => ({
        taskId: (dep.taskId as string) || '',
        dependsOn: Array.isArray(dep.dependsOn) ? (dep.dependsOn as string[]) : [],
      }))
    : [];

  const sessions: { id: string; tasks: string[]; reason?: string }[] = Array.isArray(parsed.sessions)
    ? (parsed.sessions as Record<string, unknown>[]).map((s) => ({
        id: (s.id as string) || '',
        tasks: Array.isArray(s.tasks) ? (s.tasks as string[]) : [],
        reason: (s.reason as string) || undefined,
      }))
    : [];

  return { codeExamples, testCases, filesToModify, evals, dependencies, sessions };
}
