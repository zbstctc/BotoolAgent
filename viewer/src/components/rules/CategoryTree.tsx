'use client';

import { useState } from 'react';

export interface RuleDocument {
  id: string;
  name: string;
  category: string;
  updatedAt?: string;
}

export interface RuleCategory {
  id: string;
  name: string;
  icon: string;
  documents: RuleDocument[];
}

interface CategoryTreeProps {
  categories: RuleCategory[];
  selectedDocId: string | null;
  onSelectDocument: (doc: RuleDocument) => void;
  onCreateDocument: (categoryId: string) => void;
}

const DEFAULT_CATEGORIES: RuleCategory[] = [
  { id: 'frontend', name: '前端规范', icon: '🎨', documents: [] },
  { id: 'backend', name: '后端规范', icon: '⚙️', documents: [] },
  { id: 'testing', name: '测试规范', icon: '🧪', documents: [] },
  { id: 'deployment', name: '部署规范', icon: '🚀', documents: [] },
  { id: 'application', name: '应用规范', icon: '📱', documents: [] },
  { id: 'other', name: '其他规范', icon: '📋', documents: [] },
];

export function CategoryTree({
  categories = DEFAULT_CATEGORIES,
  selectedDocId,
  onSelectDocument,
  onCreateDocument,
}: CategoryTreeProps) {
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(categories.map(c => c.id))
  );

  const toggleCategory = (categoryId: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(categoryId)) {
        next.delete(categoryId);
      } else {
        next.add(categoryId);
      }
      return next;
    });
  };

  return (
    <div className="flex flex-col h-full bg-white border-r border-neutral-200">
      {/* Header */}
      <div className="p-4 border-b border-neutral-200">
        <h2 className="text-sm font-semibold text-neutral-900">规范分类</h2>
      </div>

      {/* Category List */}
      <div className="flex-1 overflow-y-auto p-2">
        {categories.map((category) => (
          <CategoryItem
            key={category.id}
            category={category}
            isExpanded={expandedCategories.has(category.id)}
            selectedDocId={selectedDocId}
            onToggle={() => toggleCategory(category.id)}
            onSelectDocument={onSelectDocument}
            onCreateDocument={() => onCreateDocument(category.id)}
          />
        ))}
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-neutral-200">
        <button
          onClick={() => onCreateDocument('other')}
          className="w-full py-2 px-4 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          + 新建规范
        </button>
      </div>
    </div>
  );
}

function CategoryItem({
  category,
  isExpanded,
  selectedDocId,
  onToggle,
  onSelectDocument,
  onCreateDocument,
}: {
  category: RuleCategory;
  isExpanded: boolean;
  selectedDocId: string | null;
  onToggle: () => void;
  onSelectDocument: (doc: RuleDocument) => void;
  onCreateDocument: () => void;
}) {
  return (
    <div className="mb-1">
      {/* Category Header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-neutral-100 transition-colors text-left"
      >
        <span className="text-lg">{category.icon}</span>
        <span className="flex-1 text-sm font-medium text-neutral-700">
          {category.name}
        </span>
        <span className="text-xs text-neutral-400">
          {category.documents.length}
        </span>
        <span className={`text-neutral-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`}>
          ▶
        </span>
      </button>

      {/* Documents */}
      {isExpanded && (
        <div className="ml-8 space-y-0.5">
          {category.documents.length > 0 ? (
            category.documents.map((doc) => (
              <button
                key={doc.id}
                onClick={() => onSelectDocument(doc)}
                className={`w-full text-left px-3 py-1.5 rounded text-sm transition-colors ${
                  selectedDocId === doc.id
                    ? 'bg-blue-100 text-blue-700'
                    : 'text-neutral-600 hover:bg-neutral-100'
                }`}
              >
                {doc.name}
              </button>
            ))
          ) : (
            <p className="px-3 py-1.5 text-xs text-neutral-400">暂无规范</p>
          )}
          <button
            onClick={onCreateDocument}
            className="w-full text-left px-3 py-1.5 rounded text-xs text-blue-600 hover:bg-blue-50 transition-colors"
          >
            + 添加规范
          </button>
        </div>
      )}
    </div>
  );
}

export { DEFAULT_CATEGORIES };
