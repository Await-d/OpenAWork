/**
 * 260516-team-phase-e · T-06
 *
 * 模板编辑器：JSON 编辑 + 预览 + step 配置。
 * MVP：textarea JSON 编辑 + 实时校验 + 保存。
 */

import { useCallback, useState, type CSSProperties } from 'react';

const EDITOR_STYLE: CSSProperties = {
  display: 'grid',
  gap: 12,
  padding: 16,
  borderRadius: 12,
  border: '1px solid color-mix(in srgb, var(--border) 72%, transparent)',
  background: 'color-mix(in srgb, var(--surface) 86%, var(--bg))',
};

const TEXTAREA_STYLE: CSSProperties = {
  width: '100%',
  minHeight: 300,
  padding: 10,
  borderRadius: 8,
  border: '1px solid color-mix(in srgb, var(--border) 72%, transparent)',
  background: 'color-mix(in srgb, var(--bg-2) 80%, var(--bg))',
  color: 'var(--text)',
  fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
  fontSize: 12,
  lineHeight: 1.5,
  resize: 'vertical',
};

export interface WorkflowTemplateEditorProps {
  initialJson: string;
  onSave: (json: string) => Promise<void>;
}

export function WorkflowTemplateEditor({ initialJson, onSave }: WorkflowTemplateEditorProps) {
  const [draft, setDraft] = useState(initialJson);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const validate = useCallback((json: string): boolean => {
    try {
      JSON.parse(json);
      setError(null);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'JSON 格式错误');
      return false;
    }
  }, []);

  const handleSave = async () => {
    if (!validate(draft)) return;
    setSaving(true);
    setSaved(false);
    try {
      await onSave(draft);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={EDITOR_STYLE}>
      <header style={{ display: 'grid', gap: 4 }}>
        <strong style={{ fontSize: 14 }}>Workflow 模板编辑器</strong>
        <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
          编辑 workflow 的 JSON 定义。保存后立即生效。
        </span>
      </header>

      <textarea
        aria-label="Workflow JSON 编辑器"
        style={TEXTAREA_STYLE}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          validate(e.target.value);
          setSaved(false);
        }}
        spellCheck={false}
      />

      {error ? (
        <span style={{ fontSize: 12, color: 'var(--danger, #d4574e)' }}>{error}</span>
      ) : null}
      {saved ? (
        <span style={{ fontSize: 12, color: 'var(--success, var(--success, var(--success, #3dd49a)))' }}>已保存</span>
      ) : null}

      <button
        type="button"
        disabled={saving || !!error}
        onClick={() => void handleSave()}
        style={{
          justifySelf: 'start',
          padding: '6px 14px',
          borderRadius: 8,
          border: '1px solid color-mix(in srgb, var(--accent) 40%, transparent)',
          background: 'color-mix(in srgb, var(--accent) 16%, var(--surface))',
          color: 'var(--text)',
          fontSize: 12,
          fontWeight: 700,
          cursor: 'pointer',
        }}
      >
        {saving ? '保存中…' : '保存'}
      </button>
    </div>
  );
}
