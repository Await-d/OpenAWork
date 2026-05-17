/**
 * 260516-team-phase-e · T-08
 *
 * Adapter 配置面板：右侧设置 Tab 中配置各层 adapter。
 */

import { type CSSProperties } from 'react';

const PANEL_STYLE: CSSProperties = {
  display: 'grid',
  gap: 12,
  padding: 16,
  borderRadius: 12,
  border: '1px solid color-mix(in srgb, var(--border) 72%, transparent)',
  background: 'color-mix(in srgb, var(--surface) 86%, var(--bg))',
};

const ROW_STYLE: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '100px 1fr',
  gap: 8,
  alignItems: 'center',
  padding: '6px 0',
  borderBottom: '1px solid color-mix(in srgb, var(--border) 40%, transparent)',
};

export interface AdapterConfig {
  roleLayer: string;
  adapterKey: string;
  displayName: string;
}

export interface AdapterConfigPanelProps {
  adapters: AdapterConfig[];
  availableAdapterKeys: Array<{ key: string; displayName: string }>;
  onAdapterChange: (roleLayer: string, newAdapterKey: string) => void;
}

export function AdapterConfigPanel({
  adapters,
  availableAdapterKeys,
  onAdapterChange,
}: AdapterConfigPanelProps) {
  return (
    <div style={PANEL_STYLE}>
      <header style={{ display: 'grid', gap: 4 }}>
        <strong style={{ fontSize: 14 }}>角色 Adapter 配置</strong>
        <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
          为每个层级选择 adapter 实现。Adapter 决定该层使用哪个 agent、prompt 模板和工具集。
        </span>
      </header>

      {adapters.map((config) => (
        <div key={config.roleLayer} style={ROW_STYLE}>
          <span style={{ fontSize: 12, fontWeight: 600 }}>{config.roleLayer}</span>
          <select
            value={config.adapterKey}
            onChange={(e) => onAdapterChange(config.roleLayer, e.target.value)}
            style={{
              padding: '4px 8px',
              borderRadius: 6,
              border: '1px solid color-mix(in srgb, var(--border) 72%, transparent)',
              background: 'color-mix(in srgb, var(--bg-2) 80%, var(--bg))',
              color: 'var(--text)',
              fontSize: 12,
            }}
          >
            {availableAdapterKeys.map((opt) => (
              <option key={opt.key} value={opt.key}>
                {opt.displayName}
              </option>
            ))}
          </select>
        </div>
      ))}
    </div>
  );
}
