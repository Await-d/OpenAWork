import type { CSSProperties } from 'react';
import { agentTeamsTabs } from '../../data/team-runtime-ui-config.js';
import type { AgentTeamsTabKey } from '../../data/team-runtime-types.js';
import { Icon } from '../../shared/TeamIcons.js';
import type { IconKey } from '../../shared/TeamIcons.js';

const ROW_STYLE: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 12,
  alignItems: 'center',
  minHeight: 38,
  padding: '0 16px',
  borderTop: '1px solid var(--border-subtle)',
  borderBottom: '1px solid var(--border-default)',
  background: 'var(--bg-base)',
};

const TAB_LIST_STYLE: CSSProperties = {
  display: 'flex',
  gap: 2,
  alignItems: 'center',
};

const TAB_BTN_BASE_STYLE: CSSProperties = {
  position: 'relative',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  minHeight: 30,
  padding: '0 10px',
  borderRadius: 999,
  fontSize: 12,
  cursor: 'pointer',
};

const POPUP_BTN_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  color: 'var(--fg-muted)',
  fontSize: 11,
  background: 'none',
  border: '1px solid transparent',
  borderRadius: 6,
  cursor: 'pointer',
  padding: '2px 6px',
};

export function TabRow({
  activeTab,
  onSelect,
}: {
  activeTab: AgentTeamsTabKey;
  onSelect: (tab: AgentTeamsTabKey) => void;
}) {
  return (
    <div style={ROW_STYLE}>
      <div style={TAB_LIST_STYLE}>
        {agentTeamsTabs.map((tab) => {
          const active = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onSelect(tab.id)}
              className="team-tab-pill"
              data-active={active || undefined}
              style={{
                ...TAB_BTN_BASE_STYLE,
                border: active
                  ? '1px solid color-mix(in oklch, var(--accent) 40%, transparent)'
                  : '1px solid transparent',
                background: active
                  ? 'color-mix(in oklch, var(--accent) 10%, var(--bg-overlay)'
                  : 'transparent',
                color: active ? 'var(--fg-strong)' : 'var(--fg-muted)',
                fontWeight: active ? 700 : 500,
              }}
            >
              <Icon
                name={tab.icon as IconKey}
                size={12}
                color={active ? 'var(--accent)' : 'var(--fg-muted)'}
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
                    background: active ? 'var(--accent)' : 'var(--bg-surface)',
                    color: active ? 'var(--fg-strong)' : 'var(--fg-strong)',
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
              `<!DOCTYPE html><html><head><meta charset="utf-8"><title>团队工作空间 · 弹出窗口</title><style>body{background:var(--bg-raised);color:var(--fg-strong);font-family:Inter,"PingFang SC",sans-serif;margin:0;padding:16px;overflow:auto}h2{font-size:18px;font-weight:800;margin:0 0 12px;padding-bottom:8px;border-bottom:1px solid rgba(255,255,255,0.1)}.content-clone{opacity:0.85;pointer-events:none}</style></head><body><h2>团队工作空间 · 弹出窗口</h2><div class="content-clone">${content}</div></body></html>`,
            );
            w.document.close();
          }
        }}
        className="team-hover-surface-bordered"
        style={POPUP_BTN_STYLE}
      >
        <Icon name="expand-right" size={11} color="var(--fg-muted)" />
        <span>弹出</span>
      </button>
    </div>
  );
}
