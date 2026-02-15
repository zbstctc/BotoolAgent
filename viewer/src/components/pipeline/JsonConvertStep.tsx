'use client';

import { useState, useCallback, useRef } from 'react';

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

type ConvertingState = 'idle' | 'converting' | 'completed' | 'error';

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
  const [parseError, setParseError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // CLI generation state
  const [convertingState, setConvertingState] = useState<ConvertingState>('idle');
  const [convertingProgress, setConvertingProgress] = useState(0);
  const [convertingMessage, setConvertingMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Start conversion with CLI via /api/prd/convert
  const handleStartConversion = useCallback(async () => {
    if (!prdContent) {
      setError('没有 PRD 内容可供转换');
      return;
    }

    setConvertingState('converting');
    setConvertingProgress(0);
    setConvertingMessage('正在分析 PRD 内容...');
    setError(null);
    setPrdJson(null);
    setJsonString('');

    try {
      abortControllerRef.current = new AbortController();

      const response = await fetch('/api/prd/convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prdContent,
          prdId: projectName?.toLowerCase().replace(/\s+/g, '-') || 'new-project',
        }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || '转换 API 调用失败');
      }

      // Process SSE stream
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('无法获取响应流');
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let progressValue = 0;
      let didReceiveComplete = false;

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
                // Update progress
                progressValue = Math.min(progressValue + 3, 90);
                setConvertingProgress(progressValue);
                setConvertingMessage('正在转换为 JSON 格式...');
              } else if (parsed.type === 'complete') {
                // Conversion complete - prdJson is already saved by the API
                const resultJson = parsed.prdJson as PrdJson;
                didReceiveComplete = true;
                setPrdJson(resultJson);
                setJsonString(JSON.stringify(resultJson, null, 2));
                setConvertingProgress(100);
                setConvertingState('completed');
                setConvertingMessage('转换完成！JSON 已自动保存到项目根目录');
              } else if (parsed.type === 'error') {
                // Check if raw content is available for manual editing
                if (parsed.rawContent) {
                  // Try to extract JSON from raw content
                  const extracted = tryExtractJson(parsed.rawContent);
                  if (extracted) {
                    didReceiveComplete = true;
                    setPrdJson(extracted);
                    setJsonString(JSON.stringify(extracted, null, 2));
                    setConvertingProgress(100);
                    setConvertingState('completed');
                    setConvertingMessage('转换完成（需要手动检查 JSON 格式）');
                    continue;
                  }
                }
                throw new Error(parsed.error);
              }
            } catch (parseErr) {
              // Ignore JSON parse errors (incomplete data)
              if (parseErr instanceof Error &&
                  !parseErr.message.includes('Unexpected') &&
                  !parseErr.message.includes('JSON')) {
                throw parseErr;
              }
            }
          }
        }
      }

      // If stream ended without a complete event, check if we have data
      if (!didReceiveComplete) {
        setConvertingState('completed');
        setConvertingMessage('转换完成！');
      }

    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        setConvertingState('idle');
        return;
      }

      const errorMessage = err instanceof Error ? err.message : '未知错误';
      setError(errorMessage);
      setConvertingState('error');
      setConvertingMessage('转换失败');
    }
  }, [prdContent, projectName]);

  // Cancel conversion
  const cancelConversion = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setConvertingState('idle');
    setConvertingProgress(0);
    setConvertingMessage('');
  }, []);

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
      const response = await fetch('/api/prd/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: JSON.stringify(prdJson, null, 2), name: prdJson.project }),
      });

      if (!response.ok) {
        throw new Error('Failed to save');
      }

      onComplete(prdJson);
    } catch {
      // Still complete even if save fails - user can save manually
      onComplete(prdJson);
    } finally {
      setIsSaving(false);
    }
  }, [prdJson, parseError, onComplete]);

  // Show initial state - prompt user to start conversion
  if (convertingState === 'idle' && !prdJson) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-blue-100 flex items-center justify-center">
            <span className="text-2xl">{'{}'}</span>
          </div>
          <h2 className="text-lg font-semibold text-neutral-900 mb-2">转换为 JSON</h2>
          <p className="text-sm text-neutral-500 mb-6">
            将 PRD 内容转换为 prd.json 格式，用于自动化开发
          </p>
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
              onClick={handleStartConversion}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
            >
              开始转换
            </button>
            <button
              type="button"
              onClick={() => {
                // Skip with a minimal prd.json
                const minimal: PrdJson = {
                  project: projectName || 'New Project',
                  branchName: `botool/${projectName?.toLowerCase().replace(/\s+/g, '-') || 'new-feature'}`,
                  description: '',
                  devTasks: [],
                };
                onComplete(minimal);
              }}
              className="px-4 py-2 text-neutral-600 hover:text-neutral-800"
            >
              跳过此步
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Show converting progress UI
  if (convertingState === 'converting' || convertingState === 'error') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-md">
          {/* Progress Header */}
          <div className="text-center mb-6">
            {convertingState === 'error' ? (
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-100 flex items-center justify-center">
                <span className="text-2xl">!</span>
              </div>
            ) : (
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-blue-100 flex items-center justify-center">
                <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full" />
              </div>
            )}
            <h3 className="text-lg font-semibold text-neutral-900">
              {convertingState === 'error' ? '转换失败' : '正在转换 PRD'}
            </h3>
            <p className="text-sm text-neutral-500 mt-1">{convertingMessage}</p>
            {error && (
              <p className="text-sm text-red-600 mt-2">{error}</p>
            )}
          </div>

          {/* Progress Bar */}
          <div className="mb-6">
            <div className="flex justify-between text-sm text-neutral-600 mb-2">
              <span>进度</span>
              <span>{convertingProgress}%</span>
            </div>
            <div className="w-full h-2 bg-neutral-200 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-300 ${
                  convertingState === 'error' ? 'bg-red-500' : 'bg-blue-500'
                }`}
                style={{ width: `${convertingProgress}%` }}
              />
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex justify-center gap-4">
            {convertingState === 'error' ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setConvertingState('idle');
                    setError(null);
                  }}
                  className="px-4 py-2 text-neutral-600 hover:text-neutral-800"
                >
                  返回
                </button>
                <button
                  type="button"
                  onClick={handleStartConversion}
                  className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  重试
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={cancelConversion}
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

  // Show JSON editor (completed state)
  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <div className="p-6 border-b border-neutral-200 bg-neutral-50">
        <h2 className="text-lg font-semibold text-neutral-900">JSON 转换</h2>
        <p className="text-sm text-neutral-500 mt-1">
          将 PRD 转换为 prd.json 格式，可编辑后保存
        </p>
      </div>

      {/* JSON Editor */}
      <div className="flex-1 flex flex-col min-h-0">
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
              type="button"
              onClick={() => {
                try {
                  const formatted = JSON.stringify(JSON.parse(jsonString), null, 2);
                  setJsonString(formatted);
                } catch {
                  // ignore format error
                }
              }}
              disabled={!!parseError}
              className="px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100 rounded disabled:opacity-50"
            >
              格式化
            </button>
            <button
              type="button"
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
            type="button"
            onClick={onBack}
            className="px-4 py-2 text-neutral-600 hover:text-neutral-800"
          >
            返回
          </button>
        )}
        <div className="flex gap-3">
          <button
            type="button"
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
            type="button"
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

// Try to extract valid PrdJson from raw CLI content
function tryExtractJson(content: string): PrdJson | null {
  try {
    // Try to find JSON block in markdown code fence
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonMatch && jsonMatch[1]) {
      return JSON.parse(jsonMatch[1]) as PrdJson;
    }

    // Try to find raw JSON object
    const objectMatch = content.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      return JSON.parse(objectMatch[0]) as PrdJson;
    }
  } catch {
    // Parsing failed
  }
  return null;
}
