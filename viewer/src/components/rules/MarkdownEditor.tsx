'use client';

import { useState, useCallback } from 'react';

interface MarkdownEditorProps {
  content: string;
  onChange: (content: string) => void;
  onSave: () => void;
  isSaving?: boolean;
  saveStatus?: 'idle' | 'saving' | 'saved' | 'error';
}

export function MarkdownEditor({
  content,
  onChange,
  onSave,
  isSaving,
  saveStatus = 'idle',
}: MarkdownEditorProps) {
  const [showPreview, setShowPreview] = useState(true);

  // Insert markdown syntax at cursor
  const insertMarkdown = useCallback((before: string, after: string = '') => {
    const textarea = document.getElementById('markdown-editor') as HTMLTextAreaElement;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = content.substring(start, end);
    const newText = content.substring(0, start) + before + selectedText + after + content.substring(end);

    onChange(newText);

    // Restore cursor position
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + before.length, end + before.length);
    }, 0);
  }, [content, onChange]);

  const handleBold = () => insertMarkdown('**', '**');
  const handleItalic = () => insertMarkdown('*', '*');
  const handleCode = () => insertMarkdown('`', '`');
  const handleLink = () => insertMarkdown('[', '](url)');
  const handleList = () => insertMarkdown('\n- ');
  const handleCodeBlock = () => insertMarkdown('\n```\n', '\n```\n');

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Toolbar */}
      <div className="flex items-center justify-between p-3 border-b border-neutral-200 bg-neutral-50">
        <div className="flex items-center gap-1">
          <ToolbarButton onClick={handleBold} title="加粗">
            <strong>B</strong>
          </ToolbarButton>
          <ToolbarButton onClick={handleItalic} title="斜体">
            <em>I</em>
          </ToolbarButton>
          <ToolbarButton onClick={handleCode} title="行内代码">
            {'</>'}
          </ToolbarButton>
          <ToolbarButton onClick={handleCodeBlock} title="代码块">
            {'{ }'}
          </ToolbarButton>
          <ToolbarButton onClick={handleLink} title="链接">
            🔗
          </ToolbarButton>
          <ToolbarButton onClick={handleList} title="列表">
            •
          </ToolbarButton>
        </div>

        <div className="flex items-center gap-3">
          {/* Preview Toggle */}
          <button
            onClick={() => setShowPreview(!showPreview)}
            className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
              showPreview
                ? 'bg-blue-100 text-blue-700'
                : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
            }`}
          >
            {showPreview ? '隐藏预览' : '显示预览'}
          </button>

          {/* Save Status */}
          {saveStatus !== 'idle' && (
            <span className={`text-xs ${
              saveStatus === 'saving' ? 'text-yellow-600' :
              saveStatus === 'saved' ? 'text-green-600' :
              'text-red-600'
            }`}>
              {saveStatus === 'saving' ? '保存中...' :
               saveStatus === 'saved' ? '已保存' :
               '保存失败'}
            </span>
          )}

          {/* Save Button */}
          <button
            onClick={onSave}
            disabled={isSaving}
            className="px-4 py-1.5 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed transition-colors"
          >
            {isSaving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>

      {/* Editor Area */}
      <div className={`flex-1 flex overflow-hidden ${showPreview ? 'divide-x divide-neutral-200' : ''}`}>
        {/* Editor */}
        <div className={`${showPreview ? 'w-1/2' : 'w-full'} flex flex-col`}>
          <textarea
            id="markdown-editor"
            value={content}
            onChange={(e) => onChange(e.target.value)}
            placeholder="在这里编写 Markdown 规范文档..."
            className="flex-1 p-4 text-sm font-mono text-neutral-900 resize-none outline-none"
          />
        </div>

        {/* Preview */}
        {showPreview && (
          <div className="w-1/2 overflow-y-auto p-4 bg-neutral-50">
            <div className="prose prose-sm max-w-none">
              <MarkdownPreview content={content} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ToolbarButton({
  onClick,
  title,
  children,
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="w-8 h-8 flex items-center justify-center rounded hover:bg-neutral-200 text-neutral-600 text-sm transition-colors"
    >
      {children}
    </button>
  );
}

function MarkdownPreview({ content }: { content: string }) {
  // Simple markdown to HTML conversion
  const html = content
    // Headers
    .replace(/^### (.*$)/gim, '<h3>$1</h3>')
    .replace(/^## (.*$)/gim, '<h2>$1</h2>')
    .replace(/^# (.*$)/gim, '<h1>$1</h1>')
    // Bold
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    // Code blocks
    .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
    // Inline code
    .replace(/`(.*?)`/g, '<code>$1</code>')
    // Links
    .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2">$1</a>')
    // Lists
    .replace(/^\- (.*$)/gim, '<li>$1</li>')
    // Paragraphs
    .replace(/\n\n/g, '</p><p>')
    // Line breaks
    .replace(/\n/g, '<br/>');

  return (
    <div
      dangerouslySetInnerHTML={{ __html: `<p>${html}</p>` }}
      className="[&_h1]:text-xl [&_h1]:font-bold [&_h1]:mb-4 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mb-3 [&_h3]:text-base [&_h3]:font-medium [&_h3]:mb-2 [&_code]:bg-neutral-200 [&_code]:px-1 [&_code]:rounded [&_pre]:bg-neutral-800 [&_pre]:text-white [&_pre]:p-3 [&_pre]:rounded [&_pre]:overflow-x-auto [&_a]:text-blue-600 [&_a]:underline [&_li]:ml-4 [&_li]:list-disc"
    />
  );
}
