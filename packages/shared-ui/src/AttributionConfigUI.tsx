import type { CSSProperties, ChangeEvent } from 'react';

export interface AttributionConfig {
  coAuthoredBy: boolean;
  assistedBy: boolean;
  authorName?: string;
}

export interface AttributionConfigUIProps {
  coAuthoredBy: boolean;
  assistedBy: boolean;
  authorName?: string;
  onChange: (config: AttributionConfig) => void;
  style?: CSSProperties;
}

function Toggle({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      style={{
        background: enabled ? 'var(--color-accent, #6366f1)' : '#334155',
        border: 'none',
        borderRadius: 12,
        width: 40,
        height: 22,
        cursor: 'pointer',
        position: 'relative',
        flexShrink: 0,
        transition: 'background 0.2s',
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 3,
          left: enabled ? 21 : 3,
          width: 16,
          height: 16,
          borderRadius: '50%',
          background: '#fff',
          transition: 'left 0.2s',
        }}
      />
    </button>
  );
}

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '0.65rem 1rem',
  borderBottom: '1px solid var(--color-border, #334155)',
};

const descStyle: CSSProperties = {
  fontSize: 11,
  color: 'var(--color-muted, #94a3b8)',
  marginTop: 2,
};

export function AttributionConfigUI({
  coAuthoredBy,
  assistedBy,
  authorName,
  onChange,
  style,
}: AttributionConfigUIProps) {
  function update(patch: Partial<AttributionConfig>) {
    onChange({ coAuthoredBy, assistedBy, authorName, ...patch });
  }

  return (
    <div
      style={{
        background: 'var(--color-surface, #1e293b)',
        border: '1px solid var(--color-border, #334155)',
        borderRadius: 12,
        fontFamily: 'system-ui, sans-serif',
        overflow: 'hidden',
        ...style,
      }}
    >
      <div
        style={{
          padding: '0.75rem 1rem',
          borderBottom: '1px solid var(--color-border, #334155)',
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text, #e2e8f0)' }}>
          Commit Attribution
        </span>
      </div>

      <div style={rowStyle}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text, #e2e8f0)' }}>
            Co-Authored-By 联署行
          </div>
          <div style={descStyle}>在提交消息中添加 Co-Authored-By: AI</div>
        </div>
        <Toggle enabled={coAuthoredBy} onToggle={() => update({ coAuthoredBy: !coAuthoredBy })} />
      </div>

      <div style={{ ...rowStyle, borderBottom: 'none' }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text, #e2e8f0)' }}>
            Assisted-By 协助行
          </div>
          <div style={descStyle}>在提交消息中添加 Assisted-By: AI</div>
        </div>
        <Toggle enabled={assistedBy} onToggle={() => update({ assistedBy: !assistedBy })} />
      </div>

      <div
        style={{
          padding: '0.75rem 1rem',
          borderTop: '1px solid var(--color-border, #334155)',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
        }}
      >
        <label
          htmlFor="attribution-author-name"
          style={{ fontSize: 12, color: 'var(--color-muted, #94a3b8)' }}
        >
          作者名称覆盖
        </label>
        <input
          id="attribution-author-name"
          type="text"
          placeholder="留空则使用 git config 中的名称"
          value={authorName ?? ''}
          onChange={(e: ChangeEvent<HTMLInputElement>) => update({ authorName: e.target.value })}
          style={{
            background: 'var(--color-bg, #0f172a)',
            border: '1px solid var(--color-border, #334155)',
            borderRadius: 6,
            color: 'var(--color-text, #e2e8f0)',
            fontSize: 12,
            padding: '0.35rem 0.6rem',
            outline: 'none',
          }}
        />
      </div>
    </div>
  );
}
