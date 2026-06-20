/**
 * TeamTopBar · 单行顶部导航栏
 *
 * 取代原 TeamTabBar variant="single" 的三行超级栏（上下文行 + 主 tab 行 + 子 tab 行），
 * 压缩为一行：
 *   [工作区切换器] │ [概览][对话][任务][度量][治理] │ [运行状态pill] [3D]
 *
 * 子 tab 不再独立成行，移到右侧面板顶部。
 */

import { type CSSProperties, type ReactNode } from 'react';
import { PRIMARY_TABS, type PrimaryTabKey } from '../../tabs/team-page-v2-tabs.js';
import { TeamRunStatePill } from '../../shared/TeamRunStatePill.js';

const TOP_BAR_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '0 12px',
  height: 44,
  flexShrink: 0,
  background: 'var(--bg-overlay)',
  borderBottom: '1px solid color-mix(in srgb, var(--border-default) 30%, transparent)',
};

const LEADING_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  flexShrink: 0,
};

const TAB_GROUP_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 1,
  padding: 1,
  borderRadius: 8,
  background: 'var(--bg-surface)',
  flex: 1,
  justifyContent: 'center',
  minWidth: 0,
  overflow: 'hidden',
};

const TAB_PILL_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '5px 12px',
  borderRadius: 6,
  border: 'none',
  background: 'transparent',
  color: 'var(--fg-muted)',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  flexShrink: 0,
  transition: 'background 120ms ease, color 120ms ease',
};

const TAB_PILL_ACTIVE_STYLE: CSSProperties = {
  ...TAB_PILL_STYLE,
  background: 'var(--bg-overlay)',
  color: 'var(--fg-strong)',
  fontWeight: 700,
  boxShadow: 'var(--shadow-sm)',
};

const TRAILING_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  flexShrink: 0,
};

const OFFICE_BTN_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '5px 10px',
  borderRadius: 6,
  border: '1px solid color-mix(in srgb, var(--border-default) 40%, transparent)',
  background: 'transparent',
  color: 'var(--fg-default)',
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  flexShrink: 0,
  transition: 'background 120ms ease, color 120ms ease',
};

const OFFICE_BTN_ACTIVE_STYLE: CSSProperties = {
  ...OFFICE_BTN_STYLE,
  background: 'color-mix(in srgb, var(--accent) 10%, transparent)',
  borderColor: 'color-mix(in srgb, var(--accent) 40%, transparent)',
  color: 'var(--accent)',
};

function Badge({ count, tone }: { count: number; tone: 'danger' | 'warning' }): ReactNode {
  if (count <= 0) return null;
  return (
    <span
      aria-label={`${count} 项待处理`}
      style={{
        marginLeft: 2,
        padding: '0 6px',
        minWidth: 17,
        height: 17,
        borderRadius: 999,
        background: tone === 'danger' ? 'var(--danger)' : 'var(--warning)',
        color: 'var(--fg-on-accent)',
        fontSize: 10,
        fontWeight: 700,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}

function primaryBadge(
  key: PrimaryTabKey,
  unreadCount: number,
  clarificationPending: number,
): { count: number; tone: 'danger' | 'warning' } | null {
  if (key === 'conversation' && unreadCount > 0) return { count: unreadCount, tone: 'danger' };
  if (key === 'tasks' && clarificationPending > 0)
    return { count: clarificationPending, tone: 'warning' };
  return null;
}

export interface TeamTopBarProps {
  activePrimary: PrimaryTabKey | null;
  onPrimaryChange: (key: PrimaryTabKey) => void;
  unreadCount: number;
  clarificationPending: number;
  showOffice: boolean;
  officeActive: boolean;
  onOfficeClick: () => void;
  /** 最左侧：工作区切换器 + 当前会话信息 */
  leadingSlot: ReactNode;
}

export function TeamTopBar({
  activePrimary,
  onPrimaryChange,
  unreadCount,
  clarificationPending,
  showOffice,
  officeActive,
  onOfficeClick,
  leadingSlot,
}: TeamTopBarProps) {
  return (
    <header style={TOP_BAR_STYLE} role="banner">
      <span style={LEADING_STYLE}>{leadingSlot}</span>

      <div style={TAB_GROUP_STYLE} role="tablist" aria-label="主分类切换">
        {PRIMARY_TABS.map((primary) => {
          const active = !officeActive && activePrimary === primary.key;
          const badge = primaryBadge(primary.key, unreadCount, clarificationPending);
          return (
            <button
              key={primary.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onPrimaryChange(primary.key)}
              className="team-tab-pill"
              data-active={active || undefined}
              style={active ? TAB_PILL_ACTIVE_STYLE : TAB_PILL_STYLE}
              title={primary.label}
            >
              <span aria-hidden style={{ fontSize: 13 }}>
                {primary.icon}
              </span>
              <span>{primary.label}</span>
              {badge ? <Badge count={badge.count} tone={badge.tone} /> : null}
            </button>
          );
        })}
      </div>

      <span style={TRAILING_STYLE}>
        <TeamRunStatePill />
        {showOffice ? (
          <button
            type="button"
            onClick={onOfficeClick}
            aria-pressed={officeActive}
            title={officeActive ? '全屏 3D 办公（ESC 关闭）' : '切到 3D 办公视图'}
            className="team-tab-pill"
            data-active={officeActive || undefined}
            style={officeActive ? OFFICE_BTN_ACTIVE_STYLE : OFFICE_BTN_STYLE}
          >
            <span aria-hidden style={{ fontSize: 13 }}>
              🏢
            </span>
            <span>3D</span>
          </button>
        ) : null}
      </span>
    </header>
  );
}
