'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { TerminalActivityFeed } from '@/components/TerminalActivityFeed';
import { useSimulatedProgress } from '@/hooks/useSimulatedProgress';

export interface RuleDocument {
  id: string;
  name: string;
  category: string;
  content?: string;
}

export interface RuleCategory {
  id: string;
  name: string;
  icon: string;
  documents: RuleDocument[];
}

// Kept for backward compatibility with stage2/page.tsx
export interface RuleViolation {
  id: string;
  ruleName: string;
  category: string;
  description: string;
  suggestion: string;
  status: 'pending' | 'accepted' | 'modified' | 'skipped';
  modifiedContent?: string;
}

// Adapting state
type AdaptingState = 'idle' | 'loading-rules' | 'adapting' | 'completed' | 'error';

// Adapting result for confirmation dialog
interface AdaptingResult {
  appliedRules: RuleDocument[];
  summary: string;
}

const DEFAULT_CATEGORIES: Omit<RuleCategory, 'documents'>[] = [
  { id: 'frontend', name: '前端规范', icon: '' },
  { id: 'backend', name: '后端规范', icon: '' },
  { id: 'testing', name: '测试规范', icon: '' },
  { id: 'deployment', name: '部署规范', icon: '' },
  { id: 'application', name: '应用规范', icon: '' },
  { id: 'other', name: '其他规范', icon: '' },
];

interface RuleCheckStepProps {
  prdContent: string;
  onComplete: (selectedRules: RuleDocument[]) => void;
  onBack?: () => void;
}

export function RuleCheckStep({
  prdContent,
  onComplete,
  onBack,
}: RuleCheckStepProps) {
  const [categories, setCategories] = useState<RuleCategory[]>([]);
  const [selectedRules, setSelectedRules] = useState<Set<string>>(new Set());
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // CLI adapting state
  const [adaptingState, setAdaptingState] = useState<AdaptingState>('idle');
  const [adaptingProgress, setAdaptingProgress] = useState(0);
  const [adaptingMessage, setAdaptingMessage] = useState('');
  const [adaptingResult, setAdaptingResult] = useState<AdaptingResult | null>(null);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [terminalLines, setTerminalLines] = useState<string[]>([]);
  const [realAdaptingProgress, setRealAdaptingProgress] = useState(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Simulated progress while waiting for SSE
  useSimulatedProgress({
    isActive: adaptingState === 'adapting',
    realProgress: realAdaptingProgress,
    setProgress: setAdaptingProgress,
    setMessage: setAdaptingMessage,
    addTerminalLine: useCallback((line: string) => {
      setTerminalLines(prev => [...prev.slice(-19), line]);
    }, []),
  });

  // Load rules from API
  useEffect(() => {
    const loadRules = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const response = await fetch('/api/rules');
        if (!response.ok) {
          throw new Error('Failed to load rules');
        }
        const data = await response.json();

        // Merge loaded documents with default categories
        const loadedCategories: RuleCategory[] = DEFAULT_CATEGORIES.map(cat => ({
          ...cat,
          documents: data.categories[cat.id] || [],
        }));

        setCategories(loadedCategories);

        // Auto-expand categories that have documents
        const categoriesWithDocs = loadedCategories
          .filter(cat => cat.documents.length > 0)
          .map(cat => cat.id);
        setExpandedCategories(new Set(categoriesWithDocs));
      } catch (err) {
        console.error('Failed to load rules:', err);
        setError('加载规范失败，请重试');
      } finally {
        setIsLoading(false);
      }
    };

    loadRules();
  }, []);

  // Toggle category expansion
  const toggleCategory = useCallback((categoryId: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(categoryId)) {
        next.delete(categoryId);
      } else {
        next.add(categoryId);
      }
      return next;
    });
  }, []);

  // Toggle single rule selection
  const toggleRule = useCallback((ruleId: string) => {
    setSelectedRules(prev => {
      const next = new Set(prev);
      if (next.has(ruleId)) {
        next.delete(ruleId);
      } else {
        next.add(ruleId);
      }
      return next;
    });
  }, []);

  // Toggle all rules in a category
  const toggleCategoryRules = useCallback((category: RuleCategory) => {
    const categoryRuleIds = category.documents.map(doc => doc.id);
    const allSelected = categoryRuleIds.every(id => selectedRules.has(id));

    setSelectedRules(prev => {
      const next = new Set(prev);
      if (allSelected) {
        // Deselect all in category
        categoryRuleIds.forEach(id => next.delete(id));
      } else {
        // Select all in category
        categoryRuleIds.forEach(id => next.add(id));
      }
      return next;
    });
  }, [selectedRules]);

  // Toggle all rules
  const toggleAllRules = useCallback(() => {
    const allRuleIds = categories.flatMap(cat => cat.documents.map(doc => doc.id));
    const allSelected = allRuleIds.length > 0 && allRuleIds.every(id => selectedRules.has(id));

    if (allSelected) {
      setSelectedRules(new Set());
    } else {
      setSelectedRules(new Set(allRuleIds));
    }
  }, [categories, selectedRules]);

  // Get selected rules as array
  const getSelectedRulesArray = useCallback((): RuleDocument[] => {
    return categories.flatMap(cat =>
      cat.documents.filter(doc => selectedRules.has(doc.id))
    );
  }, [categories, selectedRules]);

  // Fetch rule content by id
  const fetchRuleContent = useCallback(async (ruleId: string): Promise<string> => {
    const response = await fetch(`/api/rules/${encodeURIComponent(ruleId)}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch rule: ${ruleId}`);
    }
    const data = await response.json();
    return data.content;
  }, []);

  // Handle confirm button click - start CLI adapting process
  const handleConfirm = useCallback(async () => {
    const rules = getSelectedRulesArray();

    // If no rules selected, skip adapting and proceed directly
    if (rules.length === 0) {
      onComplete(rules);
      return;
    }

    // Start the adapting process
    setAdaptingState('loading-rules');
    setAdaptingProgress(0);
    setRealAdaptingProgress(0);
    setAdaptingMessage('正在加载规范内容...');
    setTerminalLines([]);
    setError(null);

    try {
      // Step 1: Fetch content for all selected rules
      const rulesWithContent: RuleDocument[] = [];
      for (let i = 0; i < rules.length; i++) {
        const rule = rules[i];
        const content = await fetchRuleContent(rule.id);
        rulesWithContent.push({ ...rule, content });
        setAdaptingProgress(Math.round(((i + 1) / rules.length) * 30)); // 0-30% for loading rules
        setTerminalLines(prev => [...prev.slice(-19), `fetch rules/${rule.category}/${rule.name}`]);
      }

      // Step 2: Build prompt for CLI
      setAdaptingState('adapting');
      setAdaptingProgress(30);
      setAdaptingMessage('正在分析 PRD 并适配规范...');
      setTerminalLines(prev => [...prev.slice(-19), 'analyzing PRD content...']);

      const rulesText = rulesWithContent
        .map(r => `### ${r.category}/${r.name}\n\n${r.content}`)
        .join('\n\n---\n\n');

      const prompt = `请分析以下 PRD 内容，并根据所选规范进行审核。请指出 PRD 中需要改进的地方。

## PRD 内容

${prdContent}

## 选中的规范

${rulesText}

请对 PRD 进行审核，指出以下几点：
1. PRD 是否符合所选规范的要求
2. 如有不符合之处，请给出具体的修改建议
3. 审核完成后，请说"审核完成"`;

      // Step 3: Call CLI API with SSE
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
      let progressValue = 30;
      let summaryContent = '';

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
                // Collect summary content from CLI response
                summaryContent += parsed.content;

                // Update real progress — the simulated hook will catch up
                progressValue = Math.min(progressValue + 2, 95);
                setRealAdaptingProgress(progressValue);

                // Push terminal lines from text chunks
                const snippet = parsed.content.trim().slice(0, 50);
                if (snippet) {
                  setTerminalLines(prev => [...prev.slice(-19), `adapting: ${snippet}`]);
                }

                // Check if adapting is completed
                if (parsed.content.includes('审核完成')) {
                  setRealAdaptingProgress(100);
                  setAdaptingProgress(() => 100);
                  setAdaptingMessage('适配完成！');
                }
              } else if (parsed.type === 'error') {
                throw new Error(parsed.error);
              } else if (parsed.type === 'done') {
                // Stream finished
                setRealAdaptingProgress(100);
                setAdaptingProgress(() => 100);
                setAdaptingState('completed');
                setAdaptingMessage('适配完成！');
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

      // Store adapting result and show confirmation dialog
      setAdaptingResult({
        appliedRules: rulesWithContent,
        summary: summaryContent || '规范审核已完成。',
      });
      setTimeout(() => {
        setShowConfirmDialog(true);
      }, 500);

    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        // Cancelled by user
        setAdaptingState('idle');
        return;
      }

      const errorMessage = err instanceof Error ? err.message : '未知错误';
      setError(errorMessage);
      setAdaptingState('error');
      setAdaptingMessage('适配失败');
    }
  }, [getSelectedRulesArray, fetchRuleContent, prdContent, onComplete]);

  // Cancel adapting
  const cancelAdapting = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setAdaptingState('idle');
    setAdaptingProgress(0);
    setAdaptingMessage('');
  }, []);

  // Confirm adapting result and proceed
  const handleConfirmResult = useCallback(() => {
    if (adaptingResult) {
      setShowConfirmDialog(false);
      onComplete(adaptingResult.appliedRules);
    }
  }, [adaptingResult, onComplete]);

  // Close confirmation dialog and return to selection
  const handleCancelResult = useCallback(() => {
    setShowConfirmDialog(false);
    setAdaptingState('idle');
    setAdaptingProgress(0);
    setAdaptingMessage('');
    setAdaptingResult(null);
  }, []);

  // Calculate totals
  const totalRules = categories.reduce((sum, cat) => sum + cat.documents.length, 0);
  const selectedCount = selectedRules.size;
  const allSelected = totalRules > 0 && selectedCount === totalRules;

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin w-8 h-8 border-4 border-neutral-500 border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-neutral-600">正在加载规范...</p>
        </div>
      </div>
    );
  }

  if (error && adaptingState !== 'error') {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 mb-4">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-neutral-900 text-white rounded-lg hover:bg-neutral-800"
          >
            重试
          </button>
        </div>
      </div>
    );
  }

  // Show adapting progress UI
  if (adaptingState !== 'idle') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-md">
          {/* Progress Header */}
          <div className="text-center mb-6">
            {adaptingState === 'error' ? (
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-100 flex items-center justify-center">
                <span className="text-2xl">❌</span>
              </div>
            ) : adaptingState === 'completed' ? (
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-100 flex items-center justify-center">
                <span className="text-2xl">✅</span>
              </div>
            ) : (
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-neutral-200 flex items-center justify-center">
                <div className="animate-spin w-8 h-8 border-4 border-neutral-500 border-t-transparent rounded-full" />
              </div>
            )}
            <h3 className="text-lg font-semibold text-neutral-900">
              {adaptingState === 'loading-rules' && '加载规范中'}
              {adaptingState === 'adapting' && '适配规范中'}
              {adaptingState === 'completed' && '适配完成'}
              {adaptingState === 'error' && '适配失败'}
            </h3>
            <p className="text-sm text-neutral-500 mt-1">{adaptingMessage}</p>
          </div>

          {/* Progress Bar */}
          <div className="mb-6">
            <div className="flex justify-between text-sm text-neutral-600 mb-2">
              <span>进度</span>
              <span>{adaptingProgress}%</span>
            </div>
            <div className="w-full h-2 bg-neutral-200 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-300 ${
                  adaptingState === 'error'
                    ? 'bg-red-500'
                    : adaptingState === 'completed'
                    ? 'bg-green-500'
                    : 'bg-neutral-700'
                }`}
                style={{ width: `${adaptingProgress}%` }}
              />
            </div>
          </div>

          {/* Terminal activity feed */}
          {(adaptingState === 'loading-rules' || adaptingState === 'adapting') && (
            <div className="flex justify-center mb-4">
              <TerminalActivityFeed lines={terminalLines} />
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex justify-center gap-4">
            {adaptingState === 'error' && (
              <>
                <button
                  onClick={() => {
                    setAdaptingState('idle');
                    setError(null);
                  }}
                  className="px-4 py-2 text-neutral-600 hover:text-neutral-800"
                >
                  返回选择
                </button>
                <button
                  onClick={handleConfirm}
                  className="px-6 py-2 bg-neutral-900 text-white rounded-lg hover:bg-neutral-800"
                >
                  重试
                </button>
              </>
            )}
            {(adaptingState === 'loading-rules' || adaptingState === 'adapting') && (
              <button
                onClick={cancelAdapting}
                className="px-4 py-2 text-neutral-600 hover:text-neutral-800 border border-neutral-300 rounded-lg"
              >
                取消
              </button>
            )}
          </div>
        </div>

        {/* Confirmation Dialog - also rendered in progress view */}
        {showConfirmDialog && adaptingResult && (
          <ConfirmationDialog
            result={adaptingResult}
            onConfirm={handleConfirmResult}
            onCancel={handleCancelResult}
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <div className="p-6 border-b border-neutral-200 bg-neutral-50">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-neutral-900">选择规范</h2>
            <p className="text-sm text-neutral-500 mt-1">
              选择要应用到 PRD 的规范，系统将自动适配
            </p>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-neutral-600">
              已选 <span className="font-semibold text-neutral-900">{selectedCount}</span> / {totalRules} 项
            </span>
            <a
              href="/?tab=rules"
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1.5 text-sm text-white bg-neutral-900 hover:bg-neutral-800 rounded transition-colors"
            >
              查看规范
            </a>
            <button
              onClick={toggleAllRules}
              className="px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100 rounded transition-colors"
            >
              {allSelected ? '取消全选' : '全选'}
            </button>
          </div>
        </div>
      </div>

      {/* Categories List */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {totalRules === 0 ? (
          <div className="text-center py-12 text-neutral-500">
            <p className="text-lg mb-2">暂无规范文档</p>
            <p className="text-sm">请先在 Dashboard 规范管理中创建规范</p>
          </div>
        ) : (
          categories.map((category) => (
            <CategoryCard
              key={category.id}
              category={category}
              isExpanded={expandedCategories.has(category.id)}
              selectedRules={selectedRules}
              onToggleExpand={() => toggleCategory(category.id)}
              onToggleCategory={() => toggleCategoryRules(category)}
              onToggleRule={toggleRule}
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
          onClick={handleConfirm}
          className="px-6 py-2 rounded-lg font-medium transition-colors bg-neutral-900 text-white hover:bg-neutral-800 ml-auto"
        >
          {selectedCount > 0 ? `确认选择 (${selectedCount} 项)` : '跳过规范检查'}
        </button>
      </div>

      {/* Confirmation Dialog */}
      {showConfirmDialog && adaptingResult && (
        <ConfirmationDialog
          result={adaptingResult}
          onConfirm={handleConfirmResult}
          onCancel={handleCancelResult}
        />
      )}
    </div>
  );
}

function CategoryCard({
  category,
  isExpanded,
  selectedRules,
  onToggleExpand,
  onToggleCategory,
  onToggleRule,
}: {
  category: RuleCategory;
  isExpanded: boolean;
  selectedRules: Set<string>;
  onToggleExpand: () => void;
  onToggleCategory: () => void;
  onToggleRule: (ruleId: string) => void;
}) {
  if (category.documents.length === 0) {
    return null;
  }

  const categoryRuleIds = category.documents.map(doc => doc.id);
  const selectedInCategory = categoryRuleIds.filter(id => selectedRules.has(id)).length;
  const allSelectedInCategory = selectedInCategory === category.documents.length;
  const someSelectedInCategory = selectedInCategory > 0 && !allSelectedInCategory;

  return (
    <div className="border border-neutral-200 rounded-lg overflow-hidden bg-white">
      {/* Category Header */}
      <div
        className="flex items-center gap-3 p-4 bg-neutral-50 cursor-pointer hover:bg-neutral-100 transition-colors"
        onClick={onToggleExpand}
      >
        {/* Checkbox */}
        <div
          onClick={(e) => {
            e.stopPropagation();
            onToggleCategory();
          }}
          className="flex items-center"
        >
          <input
            type="checkbox"
            checked={allSelectedInCategory}
            ref={(input) => {
              if (input) {
                input.indeterminate = someSelectedInCategory;
              }
            }}
            onChange={() => onToggleCategory()}
            className="w-4 h-4 text-neutral-600 border-neutral-300 rounded focus:ring-neutral-500"
          />
        </div>

        {/* Name */}
        <span className="flex-1 font-medium text-neutral-900">{category.name}</span>

        {/* Selection Count */}
        <span className="text-sm text-neutral-500">
          {selectedInCategory} / {category.documents.length}
        </span>

        {/* Expand Arrow */}
        <span className={`text-neutral-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`}>
          ▶
        </span>
      </div>

      {/* Documents List */}
      {isExpanded && (
        <div className="border-t border-neutral-200">
          {category.documents.map((doc, index) => (
            <div
              key={doc.id}
              className={`flex items-center gap-3 px-4 py-3 hover:bg-neutral-50 transition-colors cursor-pointer ${
                index < category.documents.length - 1 ? 'border-b border-neutral-100' : ''
              }`}
              onClick={() => onToggleRule(doc.id)}
            >
              <input
                type="checkbox"
                checked={selectedRules.has(doc.id)}
                onChange={() => onToggleRule(doc.id)}
                className="w-4 h-4 text-neutral-600 border-neutral-300 rounded focus:ring-neutral-500 ml-7"
              />
              <span className="text-sm text-neutral-700">{doc.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Confirmation Dialog Component
function ConfirmationDialog({
  result,
  onConfirm,
  onCancel,
}: {
  result: AdaptingResult;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  // Group applied rules by category
  const rulesByCategory = result.appliedRules.reduce<Record<string, RuleDocument[]>>(
    (acc, rule) => {
      const category = rule.category || 'other';
      if (!acc[category]) {
        acc[category] = [];
      }
      acc[category].push(rule);
      return acc;
    },
    {}
  );

  const categoryNames: Record<string, string> = {
    frontend: '前端规范',
    backend: '后端规范',
    testing: '测试规范',
    deployment: '部署规范',
    application: '应用规范',
    other: '其他规范',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onCancel}
      />

      {/* Dialog */}
      <div className="relative bg-white rounded-xl shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-neutral-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
              <span className="text-xl">✅</span>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-neutral-900">规范审核完成</h2>
              <p className="text-sm text-neutral-500">
                已审核 {result.appliedRules.length} 项规范
              </p>
            </div>
          </div>
        </div>

        {/* Content - Scrollable */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Applied Rules Section */}
          <div>
            <h3 className="text-sm font-medium text-neutral-700 mb-3">已应用的规范</h3>
            <div className="space-y-3">
              {Object.entries(rulesByCategory).map(([category, rules]) => (
                <div key={category} className="bg-neutral-50 rounded-lg p-3">
                  <div className="text-sm font-medium text-neutral-600 mb-2">
                    {categoryNames[category] || category}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {rules.map((rule) => (
                      <span
                        key={rule.id}
                        className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-neutral-200 text-neutral-700"
                      >
                        {rule.name}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Summary Section */}
          {result.summary && (
            <div>
              <h3 className="text-sm font-medium text-neutral-700 mb-3">审核摘要</h3>
              <div className="bg-neutral-50 rounded-lg p-4 max-h-48 overflow-y-auto">
                <pre className="text-sm text-neutral-600 whitespace-pre-wrap font-sans">
                  {result.summary}
                </pre>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-neutral-200 flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-neutral-600 hover:text-neutral-800 transition-colors"
          >
            返回修改
          </button>
          <button
            onClick={onConfirm}
            className="px-6 py-2 bg-neutral-900 text-white rounded-lg hover:bg-neutral-800 transition-colors font-medium"
          >
            确认并继续
          </button>
        </div>
      </div>
    </div>
  );
}
