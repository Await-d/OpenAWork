import type { AgentTeamsTabKey } from './team-runtime-reference-mock.js';
import { agentTeamsTabs } from './team-runtime-reference-mock.js';
import { Icon } from './TeamIcons.js';
import type { IconKey } from './TeamIcons.js';

export function TabRow({
  activeTab,
  onSelect,
}: {
  activeTab: AgentTeamsTabKey;
  onSelect: (tab: AgentTeamsTabKey) => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: 12,
        alignItems: 'center',
        minHeight: 38,
        padding: '0 16px',
        borderTop: '1px solid var(--border-subtle)',
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg)',
      }}
    >
      <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
        {agentTeamsTabs.map((tab) => {
          const active = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onSelect(tab.id)}
              style={{
                position: 'relative',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                minHeight: 30,
                padding: '0 10px',
                borderRadius: 999,
                border: active
                  ? '1px solid color-mix(in oklch, var(--accent) 40%, transparent)'
                  : '1px solid transparent',
                background: active
                  ? 'color-mix(in oklch, var(--accent) 10%, var(--surface))'
                  : 'transparent',
                color: active ? 'var(--text)' : 'var(--text-3)',
                fontSize: 12,
                fontWeight: active ? 700 : 500,
                cursor: 'pointer',
                transition: 'background 0.15s, color 0.15s, border-color 0.15s',
              }}
              onMouseEnter={(e) => {
                if (!active) {
                  e.currentTarget.style.background = 'var(--surface-hover)';
                  e.currentTarget.style.color = 'var(--text-2)';
                }
              }}
              onMouseLeave={(e) => {
                if (!active) {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = 'var(--text-3)';
                }
              }}
            >
              <Icon
                name={tab.icon as IconKey}
                size={12}
                color={active ? 'var(--accent)' : 'var(--text-3)'}
                style={{ opacity: active ? 1 : 0.7 }}
              />
              <span>{tab.label}</span>
              {tab.badge ? (
                <span
                  style={{
                    minWidth: 16,
                    height: 16,
                    padding: '0 5px',
                    borderRadius: 999,
                    background: active ? 'var(--accent)' : 'var(--surface-2)',
                    color: active ? 'oklch(0.98 0 0)' : 'var(--text)',
                    fontSize: 9,
                    fontWeight: 800,
                    display: 'grid',
                    placeItems: 'center',
                  }}
                >
                  {tab.badge}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => {
          const main =
            document.querySelector('[role="tabpanel"]') ??
            document.querySelector('main') ??
            document.querySelector('section');
          const content = main?.innerHTML ?? '';
          const rect = main?.getBoundingClientRect() ?? { width: 800, height: 600 };
          const w = window.open(
            '',
            '_blank',
            `width=${Math.round(rect.width)},height=${Math.round(rect.height)}`,
          );
          if (w) {
            w.document.write(
              `<!DOCTYPE html><html><head><meta charset="utf-8"><title>团队工作空间 · 弹出窗口</title><style>body{background:oklch(0.13 0.014 50);color:oklch(0.95 0.008 70);font-family:Inter,"PingFang SC",sans-serif;margin:0;padding:16px;overflow:auto}h2{font-size:18px;font-weight:800;margin:0 0 12px;padding-bottom:8px;border-bottom:1px solid rgba(255,255,255,0.1)}.content-clone{opacity:0.85;pointer-events:none}</style></head><body><h2>团队工作空间 · 弹出窗口</h2><div class="content-clone">${content}</div></body></html>`,
            );
            w.document.close();
          }
        }}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          color: 'var(--text-3)',
          fontSize: 11,
          background: 'none',
          border: '1px solid transparent',
          borderRadius: 6,
          cursor: 'pointer',
          padding: '2px 6px',
          transition: 'background 0.15s, border-color 0.15s',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--surface)';
          e.currentTarget.style.borderColor = 'var(--border-subtle)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'none';
          e.currentTarget.style.borderColor = 'transparent';
        }}
      >
        <Icon name="expand-right" size={11} color="var(--text-3)" />
        <span>弹出</span>
      </button>
    </div>
  );
}
