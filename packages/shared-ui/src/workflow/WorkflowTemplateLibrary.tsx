import { color } from '../tokens.js';
import { useState } from 'react';
import type { CSSProperties } from 'react';

export interface WorkflowTemplateSummary {
  id: string;
  name: string;
  description: string;
  nodeCount: number;
  isPublic: boolean;
}

export interface WorkflowTemplateLibraryProps {
  templates: WorkflowTemplateSummary[];
  onSelect?: (id: string) => void;
  onSave?: (name: string, desc: string) => void;
  style?: CSSProperties;
}

export function WorkflowTemplateLibrary({
  templates,
  onSelect,
  onSave,
  style,
}: WorkflowTemplateLibraryProps) {
  const [search, setSearch] = useState('');
  const [saveName, setSaveName] = useState('');
  const [saveDesc, setSaveDesc] = useState('');
  const [showSave, setShowSave] = useState(false);

  const filtered = templates.filter(
    (t) =>
      t.name.toLowerCase().includes(search.toLowerCase()) ||
      t.description.toLowerCase().includes(search.toLowerCase()),
  );

  const handleSave = () => {
    if (!saveName.trim()) return;
    onSave?.(saveName.trim(), saveDesc.trim());
    setSaveName('');
    setSaveDesc('');
    setShowSave(false);
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        ...style,
      }}
    >
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          type="text"
          placeholder="搜索模板…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            flex: 1,
            padding: '0.4rem 0.75rem',
            background: 'var(--bg-overlay))',
            border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
            borderRadius: 6,
            color: 'var(--fg-strong))',
            fontSize: 12,
          }}
        />
        {onSave && (
          <button
            type="button"
            onClick={() => setShowSave((v) => !v)}
            style={{
              padding: '0.4rem 0.75rem',
              background: 'var(--accent))',
              border: 'none',
              borderRadius: 6,
              color: color.fgOnAccent,
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            另存为模板
          </button>
        )}
      </div>

      {showSave && onSave && (
        <div
          style={{
            background: 'var(--bg-overlay))',
            border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
            borderRadius: 8,
            padding: '0.75rem 1rem',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <input
            type="text"
            placeholder="模板名称"
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            style={{
              padding: '0.35rem 0.6rem',
              background: 'var(--bg-base))',
              border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
              borderRadius: 5,
              color: 'var(--fg-strong))',
              fontSize: 12,
            }}
          />
          <textarea
            placeholder="描述（可选）"
            value={saveDesc}
            onChange={(e) => setSaveDesc(e.target.value)}
            rows={2}
            style={{
              padding: '0.35rem 0.6rem',
              background: 'var(--bg-base))',
              border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
              borderRadius: 5,
              color: 'var(--fg-strong))',
              fontSize: 12,
              resize: 'vertical',
            }}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={handleSave}
              style={{
                padding: '4px 14px',
                background: 'var(--accent))',
                border: 'none',
                borderRadius: 5,
                color: color.fgOnAccent,
                fontSize: 12,
                cursor: 'pointer',
                fontWeight: 600,
              }}
            >
              保存
            </button>
            <button
              type="button"
              onClick={() => setShowSave(false)}
              style={{
                padding: '4px 14px',
                background: 'none',
                border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
                borderRadius: 5,
                color: 'var(--fg-muted))',
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              取消
            </button>
          </div>
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
          gap: 10,
        }}
      >
        {filtered.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onSelect?.(t.id)}
            style={{
              background: 'var(--bg-overlay))',
              border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
              borderRadius: 8,
              padding: '0.75rem 1rem',
              textAlign: 'left',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                gap: 4,
              }}
            >
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-strong))' }}>
                {t.name}
              </span>
              {t.isPublic && (
                <span
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    color: color.success,
                    background: 'rgba(52,211,153,0.12)',
                    borderRadius: 4,
                    padding: '1px 5px',
                  }}
                >
                  公开
                </span>
              )}
            </div>
            <span style={{ fontSize: 11, color: 'var(--fg-muted))', lineHeight: 1.4 }}>
              {t.description}
            </span>
            <span style={{ fontSize: 10, color: 'var(--fg-muted))' }}>{t.nodeCount} 个节点</span>
          </button>
        ))}
        {filtered.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--fg-muted))', gridColumn: '1/-1' }}>
            未找到模板。
          </div>
        )}
      </div>
    </div>
  );
}
