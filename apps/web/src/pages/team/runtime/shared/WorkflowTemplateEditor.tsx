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
  border: '1px solid color-mix(in srgb, var(--border-default) 72%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 86%, var(--bg-base))',
};

const TEXTAREA_STYLE: CSSProperties = {
  width: '100%',
  minHeight: 300,
  padding: 10,
  borderRadius: 8,
  border: '1px solid color-mix(in srgb, var(--border-default) 72%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 80%, var(--bg-base))',
  color: 'var(--fg-strong)',
  fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
  fontSize: 12,
  lineHeight: 1.5,
  resize: 'vertical',
};

export interface WorkflowTemplateEditorProps {
  initialJson: string;
  onSave: (json: string) => Promise<void>;
}

/**
 * 校验模板 JSON；成功返回 null，失败返回错误信息。
 *
 * 必须留在模块级：try 内的 `JSON.parse` + 三元判定是值块，会让编译器报
 * "Support value blocks ... within a try/catch statement" 并放弃优化整个组件（实测）。
 */
function parseTemplateJsonOnce(json: string): string | null {
  try {
    JSON.parse(json);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : 'JSON 格式错误';
  }
}

/**
 * 模板保存的统一包装：置 saving / 清 saved → try → catch 交给 `onError` → finally 清 saving。
 *
 * 必须留在模块级：React Compiler 1.0.0 不支持 `try/catch` 的 finally 子句（实测）。
 */
async function runTemplateSaveOnce(ctx: {
  setSaving: (saving: boolean) => void;
  setSaved: (saved: boolean) => void;
  onError: (error: unknown) => void;
  run: () => Promise<void>;
}): Promise<void> {
  ctx.setSaving(true);
  ctx.setSaved(false);
  try {
    await ctx.run();
  } catch (error) {
    ctx.onError(error);
  } finally {
    ctx.setSaving(false);
  }
}

export function WorkflowTemplateEditor({ initialJson, onSave }: WorkflowTemplateEditorProps) {
  const [draft, setDraft] = useState(initialJson);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // 解析（含 try/catch 与值块）下沉到模块级 `parseTemplateJsonOnce`。
  const validate = useCallback((json: string): boolean => {
    const parseError = parseTemplateJsonOnce(json);
    setError(parseError);
    return parseError === null;
  }, []);

  const handleSave = async () => {
    if (!validate(draft)) return;
    // 置 saving / 清 saved 与 try/catch/finally 一起下沉到模块级 `runTemplateSaveOnce`。
    await runTemplateSaveOnce({
      setSaving,
      setSaved,
      onError: (err) => {
        setError(err instanceof Error ? err.message : '保存失败');
      },
      run: async () => {
        await onSave(draft);
        setSaved(true);
      },
    });
  };

  return (
    <div style={EDITOR_STYLE}>
      <header style={{ display: 'grid', gap: 4 }}>
        <strong style={{ fontSize: 14 }}>Workflow 模板编辑器</strong>
        <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
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

      {error ? <span style={{ fontSize: 12, color: 'var(--danger)' }}>{error}</span> : null}
      {saved ? <span style={{ fontSize: 12, color: 'var(--success)' }}>已保存</span> : null}

      <button
        type="button"
        disabled={saving || !!error}
        onClick={() => void handleSave()}
        style={{
          justifySelf: 'start',
          padding: '6px 14px',
          borderRadius: 8,
          border: '1px solid color-mix(in srgb, var(--accent) 40%, transparent)',
          background: 'color-mix(in srgb, var(--accent) 16%, var(--bg-overlay))',
          color: 'var(--fg-strong)',
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
