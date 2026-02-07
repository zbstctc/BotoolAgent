'use client';

import { useState, useMemo } from 'react';

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
  onDeleteDocument?: (doc: RuleDocument) => void;
}

const DEFAULT_CATEGORIES: RuleCategory[] = [
  { id: 'frontend', name: '前端规范', icon: '', documents: [] },
  { id: 'backend', name: '后端规范', icon: '', documents: [] },
  { id: 'testing', name: '测试规范', icon: '', documents: [] },
  { id: 'deployment', name: '部署规范', icon: '', documents: [] },
  { id: 'application', name: '应用规范', icon: '', documents: [] },
  { id: 'other', name: '其他规范', icon: '', documents: [] },
];

export function CategoryTree({
  categories = DEFAULT_CATEGORIES,
  selectedDocId,
  onSelectDocument,
  onCreateDocument,
  onDeleteDocument,
}: CategoryTreeProps) {
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(categories.map(c => c.id))
  );
  const [searchQuery, setSearchQuery] = useState('');

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

  // Filter categories based on search query
  const filteredCategories = useMemo(() => {
    if (!searchQuery.trim()) return categories;
    const query = searchQuery.toLowerCase();
    return categories.map(cat => ({
      ...cat,
      documents: cat.documents.filter(doc =>
        doc.name.toLowerCase().includes(query)
      ),
    }));
  }, [categories, searchQuery]);

  // Count total filtered results
  const totalResults = useMemo(() => {
    return filteredCategories.reduce((sum, cat) => sum + cat.documents.length, 0);
  }, [filteredCategories]);

  const totalDocs = useMemo(() => {
    return categories.reduce((sum, cat) => sum + cat.documents.length, 0);
  }, [categories]);

  return (
    <div className="flex flex-col h-full bg-white border-r border-neutral-200">
      {/* Header */}
      <div className="p-4 border-b border-neutral-200">
        <h2 className="text-sm font-semibold text-neutral-900 mb-3">规范分类</h2>
        {/* Search */}
        <div className="relative">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索规范..."
            className="w-full pl-8 pr-3 py-1.5 text-sm border border-neutral-300 rounded-lg placeholder:text-neutral-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition-all"
          />
        </div>
        {searchQuery.trim() && (
          <p className="text-xs text-neutral-500 mt-2">
            找到 {totalResults} / {totalDocs} 条结果
          </p>
        )}
      </div>

      {/* Category List */}
      <div className="flex-1 overflow-y-auto p-2">
        {filteredCategories.map((category) => (
          <CategoryItem
            key={category.id}
            category={category}
            isExpanded={expandedCategories.has(category.id) || searchQuery.trim().length > 0}
            selectedDocId={selectedDocId}
            onToggle={() => toggleCategory(category.id)}
            onSelectDocument={onSelectDocument}
            onCreateDocument={() => onCreateDocument(category.id)}
            onDeleteDocument={onDeleteDocument}
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
  onDeleteDocument,
}: {
  category: RuleCategory;
  isExpanded: boolean;
  selectedDocId: string | null;
  onToggle: () => void;
  onSelectDocument: (doc: RuleDocument) => void;
  onCreateDocument: () => void;
  onDeleteDocument?: (doc: RuleDocument) => void;
}) {
  return (
    <div className="mb-1">
      {/* Category Header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-neutral-100 transition-colors text-left"
      >
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
              <div
                key={doc.id}
                className={`group flex items-center rounded transition-colors ${
                  selectedDocId === doc.id
                    ? 'bg-blue-100 text-blue-700'
                    : 'text-neutral-600 hover:bg-neutral-100'
                }`}
              >
                <button
                  onClick={() => onSelectDocument(doc)}
                  className="flex-1 text-left px-3 py-1.5 text-sm truncate"
                >
                  {doc.name}
                </button>
                {/* Action buttons - visible on hover */}
                <div className="flex items-center gap-0.5 pr-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => onSelectDocument(doc)}
                    className="p-1 rounded hover:bg-neutral-200 text-neutral-400 hover:text-neutral-600 transition-colors"
                    title="编辑"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                  {onDeleteDocument && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteDocument(doc);
                      }}
                      className="p-1 rounded hover:bg-red-100 text-neutral-400 hover:text-red-600 transition-colors"
                      title="删除"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
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
