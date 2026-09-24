import type { ReactElement } from 'react';
import type { PluginToolInfo } from './plugin-registry.js';

export interface PluginToolSummaryProps {
  tools: PluginToolInfo[];
}

/**
 * 工具摘要：工具名 + 一句话用途 + 单行参数列表。
 *
 * 旧版为每个工具铺一整张卡片，并把参数逐个渲染成 chip（desktop_automation
 * 一处就有 15 个），是设置页臃肿的主要来源；这里压成 2–3 行/工具。
 */
export function PluginToolSummary({ tools }: PluginToolSummaryProps): ReactElement | null {
  if (tools.length === 0) {
    return null;
  }

  return (
    <section
      style={{
        background: 'var(--bg-overlay)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 12,
        display: 'grid',
        gap: 12,
        padding: '12px 14px',
      }}
    >
      <h3 style={{ color: 'var(--fg-strong)', fontSize: 12, fontWeight: 700, margin: 0 }}>
        注入工具
      </h3>

      <div style={{ display: 'grid', gap: 10 }}>
        {tools.map((tool) => (
          <div key={tool.name} style={{ display: 'grid', gap: 2, minWidth: 0 }}>
            <div
              style={{
                color: 'var(--fg-strong)',
                fontFamily: "'JetBrains Mono', 'Fira Code', ui-monospace, monospace",
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              {tool.name}
            </div>
            <div style={{ color: 'var(--fg-default)', fontSize: 11, lineHeight: 1.6 }}>
              {tool.summary}
            </div>
            <div style={{ color: 'var(--fg-muted)', fontSize: 11, lineHeight: 1.6 }}>
              参数：{tool.params.join('、')}
            </div>
            {tool.requirement ? (
              <div style={{ color: 'var(--contrast)', fontSize: 11, lineHeight: 1.6 }}>
                条件：{tool.requirement}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}
