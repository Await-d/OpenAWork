import { color, font, radius, spacing } from '../tokens.js';
import type { CSSProperties } from 'react';
import { useState } from 'react';

export interface RegistrySource {
  id: string;
  name: string;
  url: string;
  type: 'official' | 'community' | 'enterprise' | 'local';
  enabled: boolean;
  trust: 'full' | 'verified' | 'untrusted';
  readonly?: boolean;
}

export interface RegistrySourceManagerProps {
  sources: RegistrySource[];
  onAdd: (url: string) => void;
  onRemove: (id: string) => void;
  onToggle: (id: string, enabled: boolean) => void;
}

const TYPE_LABEL: Record<string, string> = {
  official: '官方',
  community: '社区',
  enterprise: '企业',
  local: '本地',
};

const TRUST_LABEL: Record<string, string> = {
  full: '完全信任',
  verified: '已校验',
  untrusted: '未信任',
};

const TRUST_TONE: Record<string, string> = {
  full: color.success,
  verified: color.accent,
  untrusted: color.danger,
};

/** 紧凑注册源管理：单层面板 + 行式布局，操作带 focus ring 与危险二次确认。 */
const styles = `
[data-openawork-registry-sources] .rs-row:hover {
  background: var(--bg-raised);
}
[data-openawork-registry-sources] .rs-action {
  background: transparent;
  border: 1px solid transparent;
  border-radius: ${radius.sm}px;
  color: ${color.fgMuted};
  cursor: pointer;
  font-size: 11px;
  font-weight: 600;
  padding: 3px 8px;
  transition: background 100ms ease, color 100ms ease;
}
[data-openawork-registry-sources] .rs-action:hover {
  background: var(--bg-hover);
  color: var(--fg-default);
}
[data-openawork-registry-sources] .rs-action[data-tone='danger']:hover {
  background: ${color.complementMuted};
  color: ${color.complement};
}
[data-openawork-registry-sources] .rs-action[data-tone='accent'] {
  color: ${color.accent};
}
[data-openawork-registry-sources] .rs-action[data-tone='accent']:hover {
  background: ${color.accentMuted};
}
[data-openawork-registry-sources] :where(button, input):focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  box-shadow: 0 0 0 4px var(--accent-subtle);
}
[data-openawork-registry-sources] .rs-action[data-tone='danger']:focus-visible {
  outline-color: ${color.complement};
  box-shadow: 0 0 0 4px ${color.complementSubtle};
}
`;

const panelStyle: CSSProperties = {
  background: color.bgOverlay,
  border: `1px solid ${color.borderSubtle}`,
  borderRadius: radius.lg,
  fontFamily: font.sans,
  overflow: 'hidden',
};

const inputStyle: CSSProperties = {
  background: color.bgBase,
  border: `1px solid ${color.borderDefault}`,
  borderRadius: radius.sm,
  boxSizing: 'border-box',
  color: color.fgDefault,
  flex: '1 1 200px',
  fontSize: 12,
  height: 30,
  minWidth: 0,
  padding: `0 ${spacing[2] + 2}px`,
};

function SourceSwitch({
  source,
  onToggle,
}: {
  source: RegistrySource;
  onToggle: (id: string, enabled: boolean) => void;
}) {
  if (source.readonly) {
    return (
      <span
        title="官方来源为只读，不可停用或移除"
        style={{
          background: color.bgSurface,
          border: `1px solid ${color.borderDefault}`,
          borderRadius: radius.xs,
          color: color.fgMuted,
          fontSize: 10,
          fontWeight: 700,
          padding: '2px 6px',
          whiteSpace: 'nowrap',
        }}
      >
        只读
      </span>
    );
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={source.enabled}
      aria-label={`${source.enabled ? '禁用' : '启用'}注册源 ${source.name}`}
      title={source.enabled ? '点击禁用' : '点击启用'}
      onClick={() => onToggle(source.id, !source.enabled)}
      style={{
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        flexShrink: 0,
        padding: 0,
      }}
    >
      <span
        aria-hidden
        style={{
          background: source.enabled ? color.accent : 'var(--switch-track-off)',
          borderRadius: radius.pill,
          display: 'block',
          height: 20,
          position: 'relative',
          transition: 'background 160ms ease',
          width: 36,
        }}
      >
        <span
          style={{
            background: color.bgOverlay,
            borderRadius: '50%',
            boxShadow: 'var(--shadow-sm)',
            height: 16,
            left: source.enabled ? 18 : 2,
            position: 'absolute',
            top: 2,
            transition: 'left 160ms ease',
            width: 16,
          }}
        />
      </span>
    </button>
  );
}

export function RegistrySourceManager({
  sources,
  onAdd,
  onRemove,
  onToggle,
}: RegistrySourceManagerProps) {
  const [url, setUrl] = useState('');
  const [confirmingRemovalId, setConfirmingRemovalId] = useState<string | null>(null);

  function handleAdd() {
    const trimmed = url.trim();
    if (trimmed) {
      onAdd(trimmed);
      setUrl('');
    }
  }

  return (
    <div data-openawork-registry-sources="true" style={panelStyle}>
      <style>{styles}</style>
      <div
        style={{
          alignItems: 'center',
          borderBottom: `1px solid ${color.borderSubtle}`,
          display: 'flex',
          gap: spacing[3],
          justifyContent: 'space-between',
          padding: `${spacing[3]}px ${spacing[4]}px`,
        }}
      >
        <h2 style={{ color: color.fgDefault, fontSize: 12, fontWeight: 600, margin: 0 }}>
          注册源管理
        </h2>
        <span style={{ color: color.fgMuted, fontSize: 11 }}>{sources.length} 个来源</span>
      </div>

      {sources.length === 0 ? (
        <div
          style={{
            color: color.fgMuted,
            fontSize: 12,
            padding: `${spacing[6]}px ${spacing[4]}px`,
            textAlign: 'center',
          }}
        >
          暂无配置的来源。
        </div>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {sources.map((src) => (
            <li
              className="rs-row"
              key={src.id}
              style={{
                alignItems: 'center',
                borderTop: `1px solid ${color.borderSubtle}`,
                display: 'flex',
                flexWrap: 'wrap',
                gap: `${spacing[2]}px ${spacing[3]}px`,
                opacity: src.enabled ? 1 : 0.6,
                padding: `${spacing[2] + 2}px ${spacing[4]}px`,
                transition: 'background 100ms ease',
              }}
            >
              <div style={{ flex: '1 1 180px', minWidth: 0 }}>
                <div
                  style={{
                    color: color.fgStrong,
                    fontSize: 12,
                    fontWeight: 600,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={src.name}
                >
                  {src.name}
                </div>
                <div
                  style={{
                    color: color.fgMuted,
                    fontFamily: font.mono,
                    fontSize: 11,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={src.url}
                >
                  {src.url}
                </div>
              </div>

              <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                <span
                  style={{
                    background: color.bgSurface,
                    border: `1px solid ${color.borderDefault}`,
                    borderRadius: radius.xs,
                    color: color.fgDefault,
                    fontSize: 10,
                    fontWeight: 600,
                    padding: '1px 6px',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {TYPE_LABEL[src.type] ?? src.type}
                </span>
                <span
                  style={{
                    color: TRUST_TONE[src.trust] ?? color.fgMuted,
                    fontSize: 10,
                    fontWeight: 700,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {TRUST_LABEL[src.trust] ?? src.trust}
                </span>
              </div>

              <div
                style={{
                  alignItems: 'center',
                  display: 'flex',
                  gap: spacing[2],
                  marginLeft: 'auto',
                }}
              >
                <SourceSwitch source={src} onToggle={onToggle} />
                {src.readonly ? null : confirmingRemovalId === src.id ? (
                  <>
                    <button
                      type="button"
                      className="rs-action"
                      onClick={() => setConfirmingRemovalId(null)}
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      className="rs-action"
                      data-tone="danger"
                      onClick={() => {
                        setConfirmingRemovalId(null);
                        onRemove(src.id);
                      }}
                    >
                      确认移除
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="rs-action"
                    data-tone="danger"
                    onClick={() => setConfirmingRemovalId(src.id)}
                  >
                    移除
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <div
        style={{
          alignItems: 'center',
          borderTop: `1px solid ${color.borderSubtle}`,
          display: 'flex',
          flexWrap: 'wrap',
          gap: spacing[2],
          padding: `${spacing[3]}px ${spacing[4]}px`,
        }}
      >
        <input
          style={inputStyle}
          type="text"
          placeholder="https://registry.example.com"
          aria-label="注册源地址"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleAdd();
          }}
        />
        <button type="button" className="rs-action" data-tone="accent" onClick={handleAdd}>
          添加来源
        </button>
      </div>
    </div>
  );
}
