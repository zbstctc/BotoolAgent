'use client';

import { useState, useEffect, useCallback } from 'react';
import { CategoryTree, type RuleDocument, type RuleCategory, DEFAULT_CATEGORIES } from './CategoryTree';
import { MarkdownEditor } from './MarkdownEditor';
import { SkillPreviewModal } from './SkillPreviewModal';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface RulesManagerProps {
  className?: string;
}

export function RulesManager({ className }: RulesManagerProps) {
  const [categories, setCategories] = useState<RuleCategory[]>(DEFAULT_CATEGORIES);
  const [selectedDoc, setSelectedDoc] = useState<RuleDocument | null>(null);
  const [content, setContent] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  // New document state
  const [isCreating, setIsCreating] = useState(false);
  const [newDocCategory, setNewDocCategory] = useState<string>('');
  const [newDocName, setNewDocName] = useState<string>('');

  // Delete confirmation state
  const [deleteTarget, setDeleteTarget] = useState<RuleDocument | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Skill preview state
  const [showSkillPreview, setShowSkillPreview] = useState(false);
  const [isGeneratingSkill, setIsGeneratingSkill] = useState(false);
  const [skillStatus, setSkillStatus] = useState<'idle' | 'generating' | 'success' | 'error'>('idle');

  // Load categories and documents
  const loadRules = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/rules');
      if (response.ok) {
        const data = await response.json();
        // Merge loaded documents with default categories
        const updatedCategories = DEFAULT_CATEGORIES.map(cat => ({
          ...cat,
          documents: data.categories[cat.id] || [],
        }));
        setCategories(updatedCategories);
      }
    } catch (error) {
      console.error('Failed to load rules:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRules();
  }, [loadRules]);

  // Load document content
  const loadDocumentContent = useCallback(async (doc: RuleDocument) => {
    try {
      const response = await fetch(`/api/rules/${encodeURIComponent(doc.id)}`);
      if (response.ok) {
        const data = await response.json();
        setContent(data.content || '');
      }
    } catch (error) {
      console.error('Failed to load document:', error);
      setContent('');
    }
  }, []);

  // Handle document selection
  const handleSelectDocument = useCallback((doc: RuleDocument) => {
    setSelectedDoc(doc);
    setIsCreating(false);
    loadDocumentContent(doc);
    setSaveStatus('idle');
  }, [loadDocumentContent]);

  // Handle create new document
  const handleCreateDocument = useCallback((categoryId: string) => {
    setSelectedDoc(null);
    setIsCreating(true);
    setNewDocCategory(categoryId);
    setNewDocName('');
    setContent('# 新规范\n\n在这里编写你的规范内容...\n');
    setSaveStatus('idle');
  }, []);

  // Handle save
  const handleSave = useCallback(async () => {
    if (isCreating && !newDocName.trim()) {
      alert('请输入规范名称');
      return;
    }

    setIsSaving(true);
    setSaveStatus('saving');

    try {
      const response = await fetch('/api/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: isCreating ? newDocCategory : selectedDoc?.category,
          name: isCreating ? newDocName.trim() : selectedDoc?.name,
          content,
        }),
      });

      if (response.ok) {
        setSaveStatus('saved');
        if (isCreating) {
          setIsCreating(false);
          await loadRules();
          // Select the newly created document
          const data = await response.json();
          const [category, name] = data.id.split('/');
          setSelectedDoc({ id: data.id, name, category });
        }
        setTimeout(() => setSaveStatus('idle'), 2000);
      } else {
        setSaveStatus('error');
      }
    } catch (error) {
      console.error('Failed to save:', error);
      setSaveStatus('error');
    } finally {
      setIsSaving(false);
    }
  }, [isCreating, newDocCategory, newDocName, selectedDoc, content, loadRules]);

  // Handle generate skill
  const handleGenerateSkill = useCallback(async () => {
    const category = isCreating ? newDocCategory : selectedDoc?.category;
    const name = isCreating ? newDocName.trim() : selectedDoc?.name;

    if (!category || !name) {
      alert('请先选择或创建规范');
      return;
    }

    setIsGeneratingSkill(true);
    setSkillStatus('generating');

    try {
      const response = await fetch('/api/rules/skill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, name, content }),
      });

      if (response.ok) {
        setSkillStatus('success');
        setTimeout(() => setSkillStatus('idle'), 3000);
      } else {
        setSkillStatus('error');
      }
    } catch (error) {
      console.error('Failed to generate skill:', error);
      setSkillStatus('error');
    } finally {
      setIsGeneratingSkill(false);
    }
  }, [isCreating, newDocCategory, newDocName, selectedDoc, content]);

  // Handle delete document
  const handleDeleteDocument = useCallback((doc: RuleDocument) => {
    setDeleteTarget(doc);
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTarget) return;

    setIsDeleting(true);
    try {
      const response = await fetch(`/api/rules?id=${encodeURIComponent(deleteTarget.id)}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        // If the deleted doc was selected, clear selection
        if (selectedDoc?.id === deleteTarget.id) {
          setSelectedDoc(null);
          setContent('');
        }
        await loadRules();
      } else {
        alert('删除失败，请稍后重试');
      }
    } catch (error) {
      console.error('Failed to delete:', error);
      alert('删除失败，请稍后重试');
    } finally {
      setIsDeleting(false);
      setDeleteTarget(null);
    }
  }, [deleteTarget, selectedDoc, loadRules]);

  // Get current document info for skill preview
  const currentCategory = isCreating ? newDocCategory : selectedDoc?.category;
  const currentName = isCreating ? newDocName.trim() : selectedDoc?.name;

  return (
    <div className={`flex h-full ${className}`}>
      {/* Left: Category Tree */}
      <div className="w-64 flex-shrink-0">
        {isLoading ? (
          <div className="p-4">
            <div className="animate-pulse space-y-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-8 bg-neutral-200 rounded" />
              ))}
            </div>
          </div>
        ) : (
          <CategoryTree
            categories={categories}
            selectedDocId={selectedDoc?.id || null}
            onSelectDocument={handleSelectDocument}
            onCreateDocument={handleCreateDocument}
            onDeleteDocument={handleDeleteDocument}
          />
        )}
      </div>

      {/* Right: Editor */}
      <div className="flex-1 flex flex-col min-w-0">
        {isCreating ? (
          <>
            {/* New Document Header */}
            <div className="p-4 border-b border-neutral-200 bg-neutral-50">
              <div className="flex items-center gap-4">
                <label className="text-sm font-medium text-neutral-700">
                  规范名称：
                </label>
                <input
                  type="text"
                  value={newDocName}
                  onChange={(e) => setNewDocName(e.target.value)}
                  placeholder="输入规范名称..."
                  className="flex-1 px-3 py-1.5 border border-neutral-300 rounded text-sm focus:border-neutral-500 focus:ring-2 focus:ring-neutral-200 outline-none"
                />
                <span className="text-xs text-neutral-500">
                  分类: {categories.find(c => c.id === newDocCategory)?.name}
                </span>
              </div>
            </div>
            <MarkdownEditor
              content={content}
              onChange={setContent}
              onSave={handleSave}
              isSaving={isSaving}
              saveStatus={saveStatus}
              onPreviewSkill={() => setShowSkillPreview(true)}
              onGenerateSkill={handleGenerateSkill}
              isGeneratingSkill={isGeneratingSkill}
              skillStatus={skillStatus}
            />
          </>
        ) : selectedDoc ? (
          <>
            {/* Document Header */}
            <div className="p-4 border-b border-neutral-200 bg-neutral-50">
              <h2 className="text-lg font-semibold text-neutral-900">
                {selectedDoc.name}
              </h2>
              <p className="text-xs text-neutral-500">
                {categories.find(c => c.id === selectedDoc.category)?.name}
              </p>
            </div>
            <MarkdownEditor
              content={content}
              onChange={setContent}
              onSave={handleSave}
              isSaving={isSaving}
              saveStatus={saveStatus}
              onPreviewSkill={() => setShowSkillPreview(true)}
              onGenerateSkill={handleGenerateSkill}
              isGeneratingSkill={isGeneratingSkill}
              skillStatus={skillStatus}
            />
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-neutral-500">
            <div className="text-center">
              <p className="text-lg mb-2">选择或创建规范</p>
              <p className="text-sm">从左侧选择一个规范文档，或点击{'"'}新建规范{'"'}创建</p>
            </div>
          </div>
        )}
      </div>

      {/* Skill Preview Modal */}
      {showSkillPreview && currentCategory && currentName && (
        <SkillPreviewModal
          category={currentCategory}
          name={currentName}
          content={content}
          onClose={() => setShowSkillPreview(false)}
          onGenerate={handleGenerateSkill}
          isGenerating={isGeneratingSkill}
        />
      )}

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>确认删除</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            确定要删除规范 <span className="font-medium text-foreground">&quot;{deleteTarget?.name}&quot;</span> 吗？此操作不可撤销。
          </p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmDelete}
              disabled={isDeleting}
            >
              {isDeleting ? '删除中...' : '删除'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
