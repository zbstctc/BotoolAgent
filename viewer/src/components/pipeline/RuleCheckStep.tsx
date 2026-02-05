'use client';

import { useState, useEffect, useCallback } from 'react';

export interface RuleDocument {
  id: string;
  name: string;
  category: string;
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

const DEFAULT_CATEGORIES: Omit<RuleCategory, 'documents'>[] = [
  { id: 'frontend', name: '前端规范', icon: '🎨' },
  { id: 'backend', name: '后端规范', icon: '⚙️' },
  { id: 'testing', name: '测试规范', icon: '🧪' },
  { id: 'deployment', name: '部署规范', icon: '🚀' },
  { id: 'application', name: '应用规范', icon: '📱' },
  { id: 'other', name: '其他规范', icon: '📋' },
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

  // Calculate totals
  const totalRules = categories.reduce((sum, cat) => sum + cat.documents.length, 0);
  const selectedCount = selectedRules.size;
  const allSelected = totalRules > 0 && selectedCount === totalRules;

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-neutral-600">正在加载规范...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 mb-4">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            重试
          </button>
        </div>
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
              已选 <span className="font-semibold text-blue-600">{selectedCount}</span> / {totalRules} 项
            </span>
            <button
              onClick={toggleAllRules}
              className="px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50 rounded transition-colors"
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
          onClick={() => onComplete(getSelectedRulesArray())}
          className="px-6 py-2 rounded-lg font-medium transition-colors bg-blue-600 text-white hover:bg-blue-700 ml-auto"
        >
          {selectedCount > 0 ? `确认选择 (${selectedCount} 项)` : '跳过规范检查'}
        </button>
      </div>
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
            className="w-4 h-4 text-blue-600 border-neutral-300 rounded focus:ring-blue-500"
          />
        </div>

        {/* Icon and Name */}
        <span className="text-xl">{category.icon}</span>
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
                className="w-4 h-4 text-blue-600 border-neutral-300 rounded focus:ring-blue-500 ml-7"
              />
              <span className="text-sm text-neutral-700">{doc.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
