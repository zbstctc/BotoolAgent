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

  // Start generation via /api/prd/enrich
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
      abortControllerRef.current = new AbortController();

      const response = await fetch('/api/prd/enrich', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prdContent }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Enrichment API 调用失败');
      }

      // Process SSE stream from /api/prd/enrich
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('无法获取响应流');
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let progressValue = 0;

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

              if (parsed.type === 'progress') {
                progressValue = Math.min(progressValue + 2, 90);
                setGeneratingProgress(progressValue);
                setGeneratingMessage(parsed.message || '正在生成代码示例和测试用例...');
              } else if (parsed.type === 'complete') {
                // Result already parsed server-side
                const enrichResult: AutoEnrichResult = parsed.result;
                setResult(enrichResult);
                setGeneratingProgress(100);
                setGeneratingState('completed');
                setGeneratingMessage('生成完成！');
              } else if (parsed.type === 'error') {
                throw new Error(parsed.error);
              }
            } catch (parseError) {
              if (parseError instanceof Error &&
                  !parseError.message.includes('Unexpected') &&
                  !parseError.message.includes('JSON')) {
                throw parseError;
              }
            }
          }
        }
      }

    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
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
