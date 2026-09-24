import type { ReactElement } from 'react';
import type { PluginDefinition, PluginId } from './plugin-registry.js';

export interface PluginNavProps {
  items: Array<{ definition: PluginDefinition; enabled?: boolean }>;
  selectedId: PluginId;
  onSelect: (id: PluginId) => void;
}

const styles = `
[data-plugin-nav] .pn-item {
  transition: background 100ms ease, color 100ms ease;
}
[data-plugin-nav] .pn-item:hover {
  background: var(--bg-hover);
}
[data-plugin-nav] :where(button):focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  box-shadow: 0 0 0 4px var(--accent-subtle);
}
`;

/**
 * 插件导航：图标 + 名称 + 启用状态点。
 * 描述文案移到详情页头，避免每项两行文字把导航撑高。
 */
export function PluginNav({ items, selectedId, onSelect }: PluginNavProps): ReactElement {
  return (
    <nav
      data-plugin-nav="true"
      aria-label="插件列表"
      style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}
    >
      <style>{styles}</style>

      {items.map(({ definition, enabled }) => {
        const active = selectedId === definition.id;
        return (
          <button
            key={definition.id}
            type="button"
            className="pn-item"
            aria-current={active ? 'true' : undefined}
            onClick={() => onSelect(definition.id)}
            style={{
              alignItems: 'center',
              background: active ? 'var(--accent-muted)' : 'transparent',
              border: 'none',
              borderRadius: 8,
              color: active ? 'var(--accent)' : 'var(--fg-default)',
              cursor: 'pointer',
              display: 'flex',
              gap: 8,
              padding: '7px 10px',
              textAlign: 'left',
            }}
          >
            <span
              aria-hidden
              style={{ display: 'inline-flex', flexShrink: 0, opacity: active ? 1 : 0.75 }}
            >
              {definition.icon}
            </span>
            <span
              style={{
                flex: 1,
                fontSize: 12,
                fontWeight: active ? 600 : 500,
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {definition.label}
            </span>
            {definition.kind === 'resource' ? null : (
              <span
                aria-hidden
                title={enabled ? '已启用' : '未启用'}
                style={{
                  background: enabled ? 'var(--accent)' : 'var(--border-emphasis)',
                  borderRadius: '50%',
                  flexShrink: 0,
                  height: 6,
                  width: 6,
                }}
              />
            )}
          </button>
        );
      })}
    </nav>
  );
}
