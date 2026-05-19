import { useCallback, useMemo, useRef, useState } from 'react';
import { usePromptTemplateStore, type PromptTemplate } from '../../../stores/chat/prompt-templates.js';

interface PromptTemplatePanelProps {
  isOpen: boolean;
  onClose: () => void;
  onInsert: (content: string) => void;
}

export function PromptTemplatePanel({ isOpen, onClose, onInsert }: PromptTemplatePanelProps) {
  const { templates, addTemplate, updateTemplate, removeTemplate, incrementUsage } =
    usePromptTemplateStore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [filterCategory, setFilterCategory] = useState<string | null>(null);

  const categories = useMemo(() => {
    const cats = new Set<string>();
    for (const t of templates) {
      if (t.category) cats.add(t.category);
    }
    return Array.from(cats).sort();
  }, [templates]);

  const filteredTemplates = useMemo(() => {
    let result = templates;
    if (filterCategory) {
      result = result.filter((t) => t.category === filterCategory);
    }
    // Sort by usage count descending, then by updatedAt descending
    return [...result].sort((a, b) => b.usageCount - a.usageCount || b.updatedAt - a.updatedAt);
  }, [templates, filterCategory]);

  const handleUseTemplate = useCallback(
    (template: PromptTemplate) => {
      incrementUsage(template.id);
      onInsert(template.content);
      onClose();
    },
    [incrementUsage, onInsert, onClose],
  );

  if (!isOpen) return null;

  return (
    <div
      className="prompt-template-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="presentation"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9998,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '12vh',
        background: 'rgba(0, 0, 0, 0.35)',
        backdropFilter: 'blur(2px)',
      }}
    >
      <div
        role="dialog"
        aria-label="提示词模板"
        data-testid="prompt-template-panel"
        style={{
          width: '100%',
          maxWidth: 520,
          maxHeight: '65vh',
          display: 'flex',
          flexDirection: 'column',
          borderRadius: 12,
          border: '1px solid var(--border-default)',
          background: 'var(--bg-overlay)',
          boxShadow: '0 16px 48px rgba(0,0,0,0.25)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            borderBottom: '1px solid var(--border-subtle)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)' }}>
              📋 提示词模板
            </span>
            <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{templates.length} 个模板</span>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              type="button"
              onClick={() => setShowAddForm(true)}
              style={{
                height: 26,
                padding: '0 10px',
                borderRadius: 5,
                border: '1px solid var(--border-default)',
                background: 'var(--accent)',
                color: 'var(--fg-on-accent)',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              + 新建
            </button>
            <button
              type="button"
              onClick={onClose}
              style={{
                width: 26,
                height: 26,
                borderRadius: 5,
                border: 'none',
                background: 'transparent',
                color: 'var(--fg-muted)',
                fontSize: 14,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* Category filter */}
        {categories.length > 0 && (
          <div
            style={{
              display: 'flex',
              gap: 4,
              padding: '8px 16px',
              borderBottom: '1px solid var(--border-subtle)',
              flexWrap: 'wrap',
            }}
          >
            <button
              type="button"
              onClick={() => setFilterCategory(null)}
              style={{
                height: 22,
                padding: '0 8px',
                borderRadius: 11,
                border: '1px solid var(--border-subtle)',
                background: filterCategory === null ? 'var(--accent)' : 'transparent',
                color: filterCategory === null ? 'var(--fg-on-accent)' : 'var(--fg-default)',
                fontSize: 10,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              全部
            </button>
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setFilterCategory(cat)}
                style={{
                  height: 22,
                  padding: '0 8px',
                  borderRadius: 11,
                  border: '1px solid var(--border-subtle)',
                  background: filterCategory === cat ? 'var(--accent)' : 'transparent',
                  color: filterCategory === cat ? 'var(--fg-on-accent)' : 'var(--fg-default)',
                  fontSize: 10,
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                {cat}
              </button>
            ))}
          </div>
        )}

        {/* Add form */}
        {showAddForm && (
          <AddTemplateForm
            onAdd={(label, content, category) => {
              addTemplate({ label, content, category: category || undefined });
              setShowAddForm(false);
            }}
            onCancel={() => setShowAddForm(false)}
          />
        )}

        {/* Template list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
          {filteredTemplates.length === 0 ? (
            <div
              style={{
                padding: '32px 16px',
                textAlign: 'center',
                color: 'var(--fg-muted)',
                fontSize: 13,
              }}
            >
              {templates.length === 0 ? '还没有模板，点击"新建"创建第一个' : '当前分类下没有模板'}
            </div>
          ) : (
            filteredTemplates.map((template) => (
              <TemplateRow
                key={template.id}
                template={template}
                isEditing={editingId === template.id}
                onUse={() => handleUseTemplate(template)}
                onEdit={() => setEditingId(template.id)}
                onCancelEdit={() => setEditingId(null)}
                onSaveEdit={(label, content, category) => {
                  updateTemplate(template.id, { label, content, category: category || undefined });
                  setEditingId(null);
                }}
                onDelete={() => removeTemplate(template.id)}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function AddTemplateForm({
  onAdd,
  onCancel,
}: {
  onAdd: (label: string, content: string, category: string) => void;
  onCancel: () => void;
}) {
  const labelRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const categoryRef = useRef<HTMLInputElement>(null);

  return (
    <div
      style={{
        padding: '12px 16px',
        borderBottom: '1px solid var(--border-subtle)',
        background: 'color-mix(in oklch, var(--accent) 4%, var(--bg-overlay))',
      }}
    >
      <input
        ref={labelRef}
        type="text"
        placeholder="模板名称"
        style={{
          width: '100%',
          padding: '6px 8px',
          borderRadius: 5,
          border: '1px solid var(--border-default)',
          background: 'var(--bg-overlay)',
          color: 'var(--text-1)',
          fontSize: 12,
          marginBottom: 6,
        }}
      />
      <textarea
        ref={contentRef}
        placeholder="模板内容（支持换行）"
        rows={3}
        style={{
          width: '100%',
          padding: '6px 8px',
          borderRadius: 5,
          border: '1px solid var(--border-default)',
          background: 'var(--bg-overlay)',
          color: 'var(--text-1)',
          fontSize: 12,
          resize: 'vertical',
          marginBottom: 6,
        }}
      />
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input
          ref={categoryRef}
          type="text"
          placeholder="分类（可选）"
          style={{
            flex: 1,
            padding: '5px 8px',
            borderRadius: 5,
            border: '1px solid var(--border-default)',
            background: 'var(--bg-overlay)',
            color: 'var(--text-1)',
            fontSize: 11,
          }}
        />
        <button
          type="button"
          onClick={() => {
            const label = labelRef.current?.value.trim();
            const content = contentRef.current?.value.trim();
            const category = categoryRef.current?.value.trim() ?? '';
            if (label && content) onAdd(label, content, category);
          }}
          style={{
            height: 26,
            padding: '0 10px',
            borderRadius: 5,
            border: 'none',
            background: 'var(--accent)',
            color: 'var(--fg-on-accent)',
            fontSize: 11,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          保存
        </button>
        <button
          type="button"
          onClick={onCancel}
          style={{
            height: 26,
            padding: '0 8px',
            borderRadius: 5,
            border: '1px solid var(--border-default)',
            background: 'transparent',
            color: 'var(--fg-default)',
            fontSize: 11,
            cursor: 'pointer',
          }}
        >
          取消
        </button>
      </div>
    </div>
  );
}

function TemplateRow({
  template,
  isEditing,
  onUse,
  onEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
}: {
  template: PromptTemplate;
  isEditing: boolean;
  onUse: () => void;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: (label: string, content: string, category: string) => void;
  onDelete: () => void;
}) {
  const labelRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const categoryRef = useRef<HTMLInputElement>(null);

  if (isEditing) {
    return (
      <div
        style={{
          padding: '10px 16px',
          borderBottom: '1px solid var(--border-subtle)',
          background: 'color-mix(in oklch, var(--accent) 4%, var(--bg-overlay))',
        }}
      >
        <input
          ref={labelRef}
          type="text"
          defaultValue={template.label}
          style={{
            width: '100%',
            padding: '5px 8px',
            borderRadius: 5,
            border: '1px solid var(--border-default)',
            background: 'var(--bg-overlay)',
            color: 'var(--text-1)',
            fontSize: 12,
            marginBottom: 4,
          }}
        />
        <textarea
          ref={contentRef}
          defaultValue={template.content}
          rows={3}
          style={{
            width: '100%',
            padding: '5px 8px',
            borderRadius: 5,
            border: '1px solid var(--border-default)',
            background: 'var(--bg-overlay)',
            color: 'var(--text-1)',
            fontSize: 12,
            resize: 'vertical',
            marginBottom: 4,
          }}
        />
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            ref={categoryRef}
            type="text"
            defaultValue={template.category ?? ''}
            placeholder="分类"
            style={{
              flex: 1,
              padding: '4px 8px',
              borderRadius: 5,
              border: '1px solid var(--border-default)',
              background: 'var(--bg-overlay)',
              color: 'var(--text-1)',
              fontSize: 11,
            }}
          />
          <button
            type="button"
            onClick={() => {
              const label = labelRef.current?.value.trim();
              const content = contentRef.current?.value.trim();
              const category = categoryRef.current?.value.trim() ?? '';
              if (label && content) onSaveEdit(label, content, category);
            }}
            style={{
              height: 24,
              padding: '0 8px',
              borderRadius: 4,
              border: 'none',
              background: 'var(--accent)',
              color: 'var(--fg-on-accent)',
              fontSize: 10,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            保存
          </button>
          <button
            type="button"
            onClick={onCancelEdit}
            style={{
              height: 24,
              padding: '0 8px',
              borderRadius: 4,
              border: '1px solid var(--border-default)',
              background: 'transparent',
              color: 'var(--fg-default)',
              fontSize: 10,
              cursor: 'pointer',
            }}
          >
            取消
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 16px',
        cursor: 'pointer',
        borderRadius: 6,
        margin: '0 4px',
        transition: 'background 80ms ease',
      }}
      onClick={onUse}
      className="ui-hover-tint-bg"
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <span
            style={{
              fontSize: 12,
              fontWeight: 500,
              color: 'var(--text-1)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {template.label}
          </span>
          {template.category && (
            <span
              style={{
                fontSize: 9,
                padding: '1px 5px',
                borderRadius: 8,
                background: 'color-mix(in oklch, var(--accent) 12%, transparent)',
                color: 'var(--accent)',
                fontWeight: 500,
                flexShrink: 0,
              }}
            >
              {template.category}
            </span>
          )}
        </div>
        <div
          style={{
            fontSize: 11,
            color: 'var(--fg-muted)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            marginTop: 2,
          }}
        >
          {template.content.slice(0, 80)}
          {template.content.length > 80 ? '…' : ''}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 2, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={onEdit}
          title="编辑"
          style={{
            width: 22,
            height: 22,
            borderRadius: 4,
            border: 'none',
            background: 'transparent',
            color: 'var(--fg-muted)',
            fontSize: 11,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          ✎
        </button>
        <button
          type="button"
          onClick={onDelete}
          title="删除"
          style={{
            width: 22,
            height: 22,
            borderRadius: 4,
            border: 'none',
            background: 'transparent',
            color: 'var(--fg-muted)',
            fontSize: 11,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          🗑
        </button>
      </div>
    </div>
  );
}
