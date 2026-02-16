'use client';

import { useState, useCallback, useRef } from 'react';

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

// Generation state
type GeneratingState = 'idle' | 'generating' | 'completed' | 'error';

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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editCode, setEditCode] = useState('');

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
    setExamples([]);

    try {
      const prompt = `请分析以下 PRD 内容，为每个涉及数据结构的开发任务生成 TypeScript 接口定义。

## PRD 内容

${prdContent}

## 要求

1. 识别 PRD 中涉及数据结构的任务
2. 为每个任务生成 TypeScript 接口定义
3. 接口命名要清晰、符合规范
4. 包含必要的注释说明

## 输出格式

请以 JSON 格式输出生成的代码示例，格式如下：
\`\`\`json
{
  "examples": [
    {
      "taskId": "DT-001",
      "taskTitle": "任务标题",
      "language": "typescript",
      "description": "代码描述",
      "code": "代码内容"
    }
  ]
}
\`\`\`

如果 PRD 中没有涉及数据结构的任务，请输出空数组：
\`\`\`json
{ "examples": [] }
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
                setGeneratingMessage('正在生成代码示例...');
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

      // Parse the generated examples from fullContent
      setGeneratingProgress(95);
      setGeneratingMessage('正在解析生成结果...');

      const parsedExamples = parseGeneratedExamples(fullContent);

      setExamples(parsedExamples);
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

  // Show initial state - prompt user to start generation
  if (generatingState === 'idle' && examples.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-neutral-200 flex items-center justify-center">
            <span className="text-2xl">💻</span>
          </div>
          <h2 className="text-lg font-semibold text-neutral-900 mb-2">生成代码示例</h2>
          <p className="text-sm text-neutral-500 mb-6">
            分析 PRD 内容，为涉及数据结构的任务生成 TypeScript 接口定义
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
              className="px-6 py-2 bg-neutral-900 text-white rounded-lg hover:bg-neutral-800 font-medium"
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
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-neutral-200 flex items-center justify-center">
                <div className="animate-spin w-8 h-8 border-4 border-neutral-500 border-t-transparent rounded-full" />
              </div>
            )}
            <h3 className="text-lg font-semibold text-neutral-900">
              {generatingState === 'error' ? '生成失败' : '正在生成代码示例'}
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
                  generatingState === 'error' ? 'bg-red-500' : 'bg-neutral-700'
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
                  className="px-6 py-2 bg-neutral-900 text-white rounded-lg hover:bg-neutral-800"
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

  // Show examples list (completed state or reviewing)
  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <div className="p-6 border-b border-neutral-200 bg-neutral-50">
        <h2 className="text-lg font-semibold text-neutral-900">代码示例</h2>
        <p className="text-sm text-neutral-500 mt-1">
          为数据结构生成 TypeScript 接口定义
        </p>
        {examples.length > 0 && (
          <div className="mt-3 flex items-center gap-2">
            <div className="flex-1 bg-neutral-200 h-2 rounded-full overflow-hidden">
              <div
                className="h-full bg-green-500 transition-all duration-300"
                style={{ width: `${(processedCount / examples.length) * 100}%` }}
              />
            </div>
            <span className="text-sm text-neutral-500">
              {processedCount}/{examples.length}
            </span>
          </div>
        )}
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
            type="button"
            onClick={onBack}
            className="px-4 py-2 text-neutral-600 hover:text-neutral-800"
          >
            返回
          </button>
        )}
        <button
          type="button"
          onClick={() => onComplete(examples)}
          disabled={!allProcessed && examples.length > 0}
          className={`px-6 py-2 rounded-lg font-medium transition-colors ml-auto ${
            allProcessed || examples.length === 0
              ? 'bg-neutral-900 text-white hover:bg-neutral-800'
              : 'bg-neutral-200 text-neutral-400 cursor-not-allowed'
          }`}
        >
          继续下一步
        </button>
      </div>
    </div>
  );
}

// Parse generated examples from CLI response
function parseGeneratedExamples(content: string): CodeExample[] {
  try {
    // Try to find JSON block in the content
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonMatch && jsonMatch[1]) {
      const parsed = JSON.parse(jsonMatch[1]);
      if (parsed.examples && Array.isArray(parsed.examples)) {
        return parsed.examples.map((ex: { taskId?: string; taskTitle?: string; language?: string; description?: string; code?: string }, index: number) => ({
          id: String(index + 1),
          taskId: ex.taskId || `DT-${String(index + 1).padStart(3, '0')}`,
          taskTitle: ex.taskTitle || '未命名任务',
          language: ex.language || 'typescript',
          description: ex.description || '',
          code: ex.code || '',
          status: 'pending' as const,
        }));
      }
    }

    // Try to parse as raw JSON
    const rawParsed = JSON.parse(content);
    if (rawParsed.examples && Array.isArray(rawParsed.examples)) {
      return rawParsed.examples.map((ex: { taskId?: string; taskTitle?: string; language?: string; description?: string; code?: string }, index: number) => ({
        id: String(index + 1),
        taskId: ex.taskId || `DT-${String(index + 1).padStart(3, '0')}`,
        taskTitle: ex.taskTitle || '未命名任务',
        language: ex.language || 'typescript',
        description: ex.description || '',
        code: ex.code || '',
        status: 'pending' as const,
      }));
    }
  } catch {
    // If parsing fails, return empty array
    console.error('Failed to parse generated examples');
  }

  return [];
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
    modified: 'border-neutral-200 bg-neutral-50',
    skipped: 'border-neutral-200 bg-neutral-50 opacity-60',
  };

  const statusBadges = {
    pending: null,
    accepted: <span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded">已采纳</span>,
    modified: <span className="text-xs px-2 py-0.5 bg-neutral-200 text-neutral-700 rounded">已修改</span>,
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
            className="px-3 py-1.5 bg-neutral-900 text-white text-sm rounded hover:bg-neutral-800"
          >
            采纳
          </button>
          <button
            onClick={onModify}
            className="px-3 py-1.5 bg-neutral-900 text-white text-sm rounded hover:bg-neutral-800"
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
            className="px-3 py-1.5 bg-neutral-900 text-white text-sm rounded hover:bg-neutral-800"
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
