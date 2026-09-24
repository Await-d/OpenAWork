import type { ReactElement } from 'react';
import type { PluginDefinition } from './plugin-registry.js';
import { SettingsToggle } from '../shared/settings-toggle.js';

export interface PluginDetailHeaderProps {
  definition: PluginDefinition;
  /** 开关型插件的当前启用状态；resource 类型插件不传。 */
  enabled?: boolean;
  onToggle?: (next: boolean) => void;
}

/**
 * 插件详情页头：图标 + 名称 + 说明 + 状态徽章 + 主开关。
 * 所有插件共用同一模板，替代旧版每个插件各写一份的内联头部。
 */
export function PluginDetailHeader({
  definition,
  enabled,
  onToggle,
}: PluginDetailHeaderProps): ReactElement {
  const hasToggle = typeof enabled === 'boolean' && Boolean(onToggle);
  const statusText = definition.kind === 'resource' ? null : enabled ? '已启用' : '未启用';
  const hint = enabled ? definition.enabledHint : definition.disabledHint;

  return (
    <header style={{ display: 'grid', gap: 8 }}>
      <div
        style={{
          alignItems: 'flex-start',
          display: 'flex',
          flexWrap: 'wrap',
          gap: 12,
          justifyContent: 'space-between',
        }}
      >
        <div style={{ alignItems: 'flex-start', display: 'flex', gap: 10, minWidth: 0 }}>
          <span
            aria-hidden
            style={{
              alignItems: 'center',
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 8,
              color: 'var(--accent)',
              display: 'inline-flex',
              flexShrink: 0,
              height: 30,
              justifyContent: 'center',
              width: 30,
            }}
          >
            {definition.icon}
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <h2 style={{ color: 'var(--fg-strong)', fontSize: 16, fontWeight: 700, margin: 0 }}>
                {definition.label}
              </h2>
              {statusText ? (
                <span
                  style={{
                    background: enabled ? 'var(--accent-muted)' : 'var(--bg-surface)',
                    border: `1px solid ${enabled ? 'var(--accent-border)' : 'var(--border-default)'}`,
                    borderRadius: 9999,
                    color: enabled ? 'var(--accent)' : 'var(--fg-muted)',
                    fontSize: 10,
                    fontWeight: 600,
                    padding: '1px 8px',
                  }}
                >
                  {statusText}
                </span>
              ) : null}
            </div>
            <p
              style={{ color: 'var(--fg-muted)', fontSize: 12, lineHeight: 1.6, margin: '2px 0 0' }}
            >
              {definition.description}
            </p>
          </div>
        </div>

        {hasToggle ? (
          <div style={{ alignItems: 'center', display: 'flex', gap: 8, flexShrink: 0 }}>
            <SettingsToggle
              checked={enabled === true}
              onChange={(next) => onToggle?.(next)}
              ariaLabel="启用插件"
            />
          </div>
        ) : null}
      </div>

      {hint ? (
        <p style={{ color: 'var(--fg-muted)', fontSize: 11, lineHeight: 1.6, margin: 0 }}>{hint}</p>
      ) : null}
    </header>
  );
}
