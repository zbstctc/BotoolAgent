'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { TerminalActivityFeed } from '@/components/TerminalActivityFeed';
import { useSimulatedProgress } from '@/hooks/useSimulatedProgress';
import type { EnrichedPrdJson, PipelineMode } from '@/lib/tool-types';
import type { AutoEnrichResult } from './AutoEnrichStep';
import type { RuleDocument } from './RuleCheckStep';

interface EnrichmentSummaryProps {
  prdContent: string;
  projectName: string;
  projectId?: string;
  sourcePrdId?: string;
  mode: PipelineMode;
  selectedRules: RuleDocument[];
  enrichResult: AutoEnrichResult | null;
  onComplete: (prdJson: EnrichedPrdJson) => void;
  onBack?: () => void;
}

type ConvertingState = 'idle' | 'converting' | 'completed' | 'error';

export function EnrichmentSummary({
  prdContent,
  projectName,
  projectId,
  sourcePrdId,
  mode,
  selectedRules,
  enrichResult,
  onComplete,
  onBack,
}: EnrichmentSummaryProps) {
  const [prdJson, setPrdJson] = useState<EnrichedPrdJson | null>(null);
  const [jsonString, setJsonString] = useState('');
  const [parseError, setParseError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showDetails, setShowDetails] = useState(mode === 'full');

  // CLI generation state
  const [convertingState, setConvertingState] = useState<ConvertingState>('idle');
  const [convertingProgress, setConvertingProgress] = useState(0);
  const [realConvertingProgress, setRealConvertingProgress] = useState(0);
  const [convertingMessage, setConvertingMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [terminalLines, setTerminalLines] = useState<string[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Simulated progress while waiting for SSE
  useSimulatedProgress({
    isActive: convertingState === 'converting',
    realProgress: realConvertingProgress,
    setProgress: setConvertingProgress,
    setMessage: setConvertingMessage,
    addTerminalLine: useCallback((line: string) => {
      setTerminalLines(prev => [...prev.slice(-19), line]);
    }, []),
  });

  // Call /api/prd/merge to combine basePrdJson + enrichResult + rules
  const callEnrichMerge = useCallback(async (basePrdJson: Record<string, unknown>): Promise<EnrichedPrdJson> => {
    const rules = selectedRules.map(rule => ({
      id: rule.id,
      name: rule.name,
      category: rule.category,
      content: rule.content,
    }));

    const response = await fetch('/api/prd/merge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        basePrdJson,
        enrichResult: enrichResult || {
          codeExamples: [],
          testCases: [],
          filesToModify: [],
          evals: [],
          dependencies: [],
          sessions: [],
        },
        rules,
      }),
    });

    if (!response.ok) {
      throw new Error('Enrichment merge failed');
    }

    return response.json();
  }, [selectedRules, enrichResult]);

  // Start conversion: get base JSON via /api/prd/convert, then merge via /api/prd/merge
  const handleStartConversion = useCallback(async () => {
    if (!prdContent) {
      setError('没有 PRD 内容可供转换');
      return;
    }

    setConvertingState('converting');
    setConvertingProgress(0);
    setRealConvertingProgress(0);
    setConvertingMessage('正在分析 PRD 内容...');
    setError(null);
    setPrdJson(null);
    setJsonString('');
    setTerminalLines(['parsing PRD markdown...']);

    try {
      abortControllerRef.current = new AbortController();

      const prdId = sourcePrdId || projectId || projectName?.toLowerCase().replace(/\s+/g, '-') || 'new-project';
      const response = await fetch('/api/prd/convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prdContent,
          prdId,
          projectId,
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
                progressValue = Math.min(progressValue + 3, 80);
                setRealConvertingProgress(progressValue);
                if (parsed.message) {
                  setTerminalLines(prev => [...prev.slice(-19), parsed.message.slice(0, 50)]);
                }
              } else if (parsed.type === 'complete') {
                // Base conversion complete - call /api/prd/enrich merge mode
                setRealConvertingProgress(90);
                setConvertingMessage('正在合并规范和生成结果...');
                setTerminalLines(prev => [...prev.slice(-19), 'merging rules + enrichment...']);

                const basePrdJson = parsed.prdJson;
                const enriched = await callEnrichMerge(basePrdJson);

                setPrdJson(enriched);
                setJsonString(JSON.stringify(enriched, null, 2));
                setRealConvertingProgress(100);
                setConvertingProgress(() => 100);
                setConvertingState('completed');
                setConvertingMessage('转换完成！');
              } else if (parsed.type === 'error') {
                // Check if raw content is available for manual editing
                if (parsed.rawContent) {
                  const extracted = tryExtractJson(parsed.rawContent);
                  if (extracted) {
                    const enriched = await callEnrichMerge(extracted);
                    setPrdJson(enriched);
                    setJsonString(JSON.stringify(enriched, null, 2));
                    setRealConvertingProgress(100);
                    setConvertingProgress(() => 100);
                    setConvertingState('completed');
                    setConvertingMessage('转换完成（需要手动检查 JSON 格式）');
                    continue;
                  }
                }
                throw new Error(parsed.error);
              }
            } catch (parseErr) {
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
      if (!prdJson) {
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
  }, [prdContent, projectName, projectId, sourcePrdId, prdJson, callEnrichMerge]);

  // Auto-start conversion once PRD content is ready.
  useEffect(() => {
    if (!prdContent) return;
    if (convertingState !== 'idle') return;
    if (prdJson) return;
    handleStartConversion();
  }, [prdContent, convertingState, prdJson, handleStartConversion]);

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
      const parsed = JSON.parse(newJsonString) as EnrichedPrdJson;
      setPrdJson(parsed);
    } catch {
      setParseError('JSON 格式错误');
    }
  }, []);

  // Save error state
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleSave = useCallback(async () => {
    if (!prdJson || parseError) return;

    // Schema validation: branchName required, devTasks non-empty
    if (!prdJson.branchName || prdJson.branchName.trim() === '') {
      setSaveError('branchName 是必填字段，请在 JSON 中填写分支名');
      return;
    }
    if (!prdJson.devTasks || prdJson.devTasks.length === 0) {
      setSaveError('devTasks 不能为空，至少需要一个开发任务');
      return;
    }

    setIsSaving(true);
    setSaveError(null);
    try {
      // Save prd.json for BotoolAgent to consume
      // Use sourcePrdId (PRD slug) so json filename matches md: tasks/prd-{slug}.json
      const prdSlug = sourcePrdId || projectId;
      const response = await fetch('/api/prd/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...prdJson, projectId: prdSlug }),
      });

      if (!response.ok) {
        throw new Error('保存失败，请重试');
      }

      onComplete(prdJson);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '保存失败';
      setSaveError(msg);
    } finally {
      setIsSaving(false);
    }
  }, [prdJson, parseError, projectId, onComplete]);

  // Summary stats
  const rulesCount = selectedRules.length;
  const codeExamplesCount = enrichResult?.codeExamples?.length || 0;
  const testCasesCount = enrichResult?.testCases?.length || 0;
  const filesToModifyCount = enrichResult?.filesToModify?.length || 0;
  const evalsCount = enrichResult?.evals?.length || 0;
  const sessionsCount = prdJson?.sessions?.length || 0;

  // Show converting progress UI
  if (convertingState === 'converting' || convertingState === 'error') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-md">
          {/* Progress Header */}
          <div className="text-center mb-6">
            {convertingState === 'error' ? (
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-100 flex items-center justify-center">
                <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
            ) : (
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-neutral-200 flex items-center justify-center">
                <div className="animate-spin w-8 h-8 border-4 border-neutral-500 border-t-transparent rounded-full" />
              </div>
            )}
            <h3 className="text-lg font-semibold text-neutral-900">
              {convertingState === 'error' ? '转换失败' : '正在生成 prd.json'}
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
              <span>{Math.round(convertingProgress)}%</span>
            </div>
            <div className="w-full h-2 bg-neutral-200 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-300 ${
                  convertingState === 'error' ? 'bg-red-500' : 'bg-neutral-700'
                }`}
                style={{ width: `${convertingProgress}%` }}
              />
            </div>
          </div>

          {/* Terminal activity feed */}
          {convertingState === 'converting' && (
            <div className="flex justify-center mb-4">
              <TerminalActivityFeed lines={terminalLines} />
            </div>
          )}

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
                  className="px-6 py-2 bg-neutral-900 text-white rounded-lg hover:bg-neutral-800"
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

  // Completed state - show summary and JSON editor
  if (prdJson) {
    return (
      <div className="flex-1 flex flex-col min-h-0">
        {/* Summary Header */}
        <div className="p-6 border-b border-neutral-200 bg-neutral-50">
          <h2 className="text-lg font-semibold text-neutral-900">确认并生成 prd.json</h2>
          <p className="text-sm text-neutral-500 mt-1">
            PRD 已转换为 JSON 格式，包含规范和生成结果
          </p>

          {/* Summary Stats */}
          <div className="mt-4 grid grid-cols-2 md:grid-cols-6 gap-3">
            <div className="bg-white rounded-lg p-3 border border-neutral-200">
              <div className="text-2xl font-bold text-neutral-900">{rulesCount}</div>
              <div className="text-xs text-neutral-500">规范已应用</div>
            </div>
            <div className="bg-white rounded-lg p-3 border border-neutral-200">
              <div className="text-2xl font-bold text-green-600">{codeExamplesCount}</div>
              <div className="text-xs text-neutral-500">代码示例</div>
            </div>
            <div className="bg-white rounded-lg p-3 border border-neutral-200">
              <div className="text-2xl font-bold text-neutral-900">{testCasesCount}</div>
              <div className="text-xs text-neutral-500">测试用例</div>
            </div>
            <div className="bg-white rounded-lg p-3 border border-neutral-200">
              <div className="text-2xl font-bold text-orange-600">{filesToModifyCount}</div>
              <div className="text-xs text-neutral-500">待修改文件</div>
            </div>
            <div className="bg-white rounded-lg p-3 border border-neutral-200">
              <div className="text-2xl font-bold text-amber-600">{evalsCount}</div>
              <div className="text-xs text-neutral-500">验证命令</div>
            </div>
            <div className="bg-white rounded-lg p-3 border border-neutral-200">
              <div className="text-2xl font-bold text-cyan-600">{sessionsCount}</div>
              <div className="text-xs text-neutral-500">Sessions</div>
            </div>
          </div>

          {/* Toggle Details */}
          <button
            type="button"
            onClick={() => setShowDetails(!showDetails)}
            className="mt-3 text-sm text-neutral-700 hover:text-neutral-900 flex items-center gap-1"
          >
            {showDetails ? '隐藏详情' : '查看详情'}
            <svg
              className={`w-4 h-4 transition-transform ${showDetails ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>

        {/* JSON Editor (toggled by showDetails) */}
        {showDetails && (
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
        )}

        {/* Footer */}
        <div className="p-6 border-t border-neutral-200 bg-white flex justify-between">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="px-4 py-2 text-neutral-600 hover:text-neutral-800"
            >
              返回修改
            </button>
          )}
          <div className="flex items-center gap-3 ml-auto">
            {saveError && (
              <span className="text-sm text-red-500">{saveError}</span>
            )}
            <button
              type="button"
              onClick={handleSave}
              disabled={!prdJson || !!parseError || isSaving}
              className={`px-6 py-2 rounded-lg font-medium transition-colors ${
                !prdJson || parseError || isSaving
                  ? 'bg-neutral-200 text-neutral-400 cursor-not-allowed'
                  : saveError
                    ? 'bg-orange-500 text-white hover:bg-orange-600'
                    : 'bg-neutral-900 text-white hover:bg-neutral-800'
              }`}
            >
              {isSaving ? '保存中...' : saveError ? '重试' : '开始开发'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Idle state (should not normally be seen since we auto-start)
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6">
      <div className="text-center max-w-md">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-neutral-200 flex items-center justify-center">
          <span className="text-2xl font-mono">{'{}'}</span>
        </div>
        <h2 className="text-lg font-semibold text-neutral-900 mb-2">生成 prd.json</h2>
        <p className="text-sm text-neutral-500 mb-6">
          合并规范和生成结果，转换为 prd.json 格式
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
            className="px-6 py-2 bg-neutral-900 text-white rounded-lg hover:bg-neutral-800 font-medium"
          >
            开始转换
          </button>
        </div>
      </div>
    </div>
  );
}

// Try to extract valid base PrdJson from raw CLI content
function tryExtractJson(content: string): Record<string, unknown> | null {
  try {
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonMatch && jsonMatch[1]) {
      return JSON.parse(jsonMatch[1]);
    }

    const objectMatch = content.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      return JSON.parse(objectMatch[0]);
    }
  } catch {
    // Parsing failed
  }
  return null;
}
