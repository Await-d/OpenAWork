/**
 * 260531-team-page · TeamTabBar — 统一的两层 tab 切换栏
 *
 * 取代 TeamPageV2 顶部原先"下划线主 tab + 浮动 accent-pill 对话子视图 +
 * 描边 3D 按钮 + segmented 子 tab"四套视觉语言混用的杂乱实现。
 *
 * 统一为一套视觉系统：
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ 〔概览〕〔对话〕〔任务〕〔度量〕〔治理〕            │ 🏢 3D │   ← 主 tab：segmented 胶囊
 *   ├──────────────────────────────────────────────────────────────┤
 *   │  仪表盘 · 关系图谱 · 健康度                                     │   ← 子 tab：轻量文字胶囊
 *   └──────────────────────────────────────────────────────────────┘
 *
 * 设计要点：
 *   - 主 tab 与子 tab 用同一族"胶囊"视觉，仅尺寸/权重不同，消除拼接感。
 *   - 对话主 tab 不再特殊处理——它的子视图（当前对话/层级/消息）
 *     与其它主 tab 的子 tab 完全一致地渲染。
 *   - 3D 办公作为主 tab 行尾部的独立动作按钮，与主 tab 同族但用分隔线隔开。
 *   - badge（待回复 / 待澄清）统一渲染。
 */

import type { CSSProperties, ReactNode } from 'react';
import {
  PRIMARY_TABS,
  type PrimaryTabKey,
  type SubTabDef,
} from '../../tabs/team-page-v2-tabs.js';
import type { MiddleTabKey } from '../../tabs/MiddleTabRouter.js';
import { TeamRunStatePill } from '../../shared/TeamRunStatePill.js';

// ─── 容器 ────────────────────────────────────────────────────────

const BAR_ROOT_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  flexShrink: 0,
  background: 'var(--bg-overlay)',
  borderBottom: '1px solid color-mix(in srgb, var(--border-default) 45%, transparent)',
};

const PRIMARY_ROW_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 10px 0',
  minWidth: 0,
};

const PRIMARY_GROUP_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 2,
  padding: 3,
  borderRadius: 10,
  background: 'color-mix(in srgb, var(--bg-base) 60%, transparent)',
  border: '1px solid color-mix(in srgb, var(--border-default) 30%, transparent)',
  overflowX: 'auto',
  scrollbarWidth: 'none',
  minWidth: 0,
};

// ─── 主 tab 胶囊 ─────────────────────────────────────────────────

const PRIMARY_PILL_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 14px',
  borderRadius: 8,
  border: '1px solid transparent',
  background: 'transparent',
  color: 'var(--fg-muted)',
  fontSize: 12.5,
  fontWeight: 600,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  flexShrink: 0,
  transition: 'background 140ms ease, color 140ms ease, box-shadow 140ms ease',
};

const PRIMARY_PILL_ACTIVE_STYLE: CSSProperties = {
  ...PRIMARY_PILL_STYLE,
  background: 'var(--bg-overlay)',
  color: 'var(--fg-strong)',
  fontWeight: 700,
  boxShadow: '0 1px 3px rgba(0,0,0,0.12), 0 0 0 1px color-mix(in srgb, var(--accent) 30%, transparent)',
};

// ─── 3D 办公动作按钮 ─────────────────────────────────────────────

const OFFICE_BTN_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  padding: '6px 12px',
  borderRadius: 8,
  border: '1px solid color-mix(in srgb, var(--border-default) 50%, transparent)',
  background: 'transparent',
  color: 'var(--fg-default)',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  flexShrink: 0,
  marginLeft: 'auto',
  transition: 'background 140ms ease, color 140ms ease, border-color 140ms ease',
};

const OFFICE_BTN_ACTIVE_STYLE: CSSProperties = {
  ...OFFICE_BTN_STYLE,
  background: 'color-mix(in srgb, var(--accent) 14%, transparent)',
  border: '1px solid color-mix(in srgb, var(--accent) 50%, transparent)',
  color: 'var(--accent)',
};

// 行尾右对齐由外层 wrapper 负责，这两个内联版本去掉 marginLeft:auto。
const OFFICE_BTN_INLINE_STYLE: CSSProperties = {
  ...OFFICE_BTN_STYLE,
  marginLeft: 0,
};

const OFFICE_BTN_ACTIVE_INLINE_STYLE: CSSProperties = {
  ...OFFICE_BTN_ACTIVE_STYLE,
  marginLeft: 0,
};

// ─── 子 tab 行 ───────────────────────────────────────────────────

const SUB_ROW_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 2,
  padding: '6px 12px 8px',
  overflowX: 'auto',
  scrollbarWidth: 'none',
  minWidth: 0,
};

const SUB_PILL_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  padding: '4px 12px',
  borderRadius: 999,
  border: '1px solid transparent',
  background: 'transparent',
  color: 'var(--fg-muted)',
  fontSize: 11.5,
  fontWeight: 600,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  flexShrink: 0,
  transition: 'background 140ms ease, color 140ms ease',
};

const SUB_PILL_ACTIVE_STYLE: CSSProperties = {
  ...SUB_PILL_STYLE,
  background: 'color-mix(in srgb, var(--accent) 16%, transparent)',
  color: 'var(--accent)',
  fontWeight: 700,
};

// ─── Badge ───────────────────────────────────────────────────────

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

export interface TeamTabBarProps {
  activePrimary: PrimaryTabKey | null;
  middleTab: MiddleTabKey;
  onPrimaryChange: (key: PrimaryTabKey) => void;
  onMiddleChange: (key: MiddleTabKey) => void;
  /** 待回复数（对话主 tab + messages 子 tab 上的红点）。 */
  unreadCount: number;
  /** 待澄清数（任务主 tab 上的黄点）。 */
  clarificationPending: number;
  /** 是否显示 3D 办公入口（移动端隐藏）。 */
  showOffice: boolean;
  /** 当前是否处于 3D 办公视图。 */
  officeActive: boolean;
  /** 点击 3D：非激活→切入；已激活→全屏。 */
  onOfficeClick: () => void;
}

/** 主 tab 上的 badge 计数。 */
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

export function TeamTabBar({
  activePrimary,
  middleTab,
  onPrimaryChange,
  onMiddleChange,
  unreadCount,
  clarificationPending,
  showOffice,
  officeActive,
  onOfficeClick,
}: TeamTabBarProps) {
  const subTabs: ReadonlyArray<SubTabDef> =
    activePrimary && !officeActive
      ? (PRIMARY_TABS.find((tab) => tab.key === activePrimary)?.children ?? [])
      : [];

  return (
    <div style={BAR_ROOT_STYLE}>
      {/* 主 tab 行 */}
      <div style={PRIMARY_ROW_STYLE}>
        <div style={PRIMARY_GROUP_STYLE} role="tablist" aria-label="主分类切换">
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
                style={active ? PRIMARY_PILL_ACTIVE_STYLE : PRIMARY_PILL_STYLE}
              >
                <span aria-hidden style={{ fontSize: 14 }}>
                  {primary.icon}
                </span>
                <span>{primary.label}</span>
                {badge ? <Badge count={badge.count} tone={badge.tone} /> : null}
              </button>
            );
          })}
        </div>

        {/* 右侧：全局运行状态胶囊（任意 tab 可见）+ 3D 办公入口 */}
        <span
          style={{
            marginLeft: 'auto',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            flexShrink: 0,
          }}
        >
          <TeamRunStatePill />
          {showOffice ? (
            <button
              type="button"
              onClick={onOfficeClick}
              aria-pressed={officeActive}
              title={officeActive ? '全屏 3D 办公（ESC 关闭）' : '切到 3D 办公视图'}
              className="team-tab-pill"
              data-active={officeActive || undefined}
              style={officeActive ? OFFICE_BTN_ACTIVE_INLINE_STYLE : OFFICE_BTN_INLINE_STYLE}
            >
              <span aria-hidden style={{ fontSize: 14 }}>
                🏢
              </span>
              <span>3D 办公</span>
              {officeActive ? (
                <span aria-hidden style={{ fontSize: 11, opacity: 0.8 }}>
                  ⛶
                </span>
              ) : null}
            </button>
          ) : null}
        </span>
      </div>

      {/* 子 tab 行：当前主 tab 有 >1 个子视图时显示 */}
      {subTabs.length > 1 ? (
        <div style={SUB_ROW_STYLE} role="tablist" aria-label="子视图切换">
          {subTabs.map((sub) => {
            const active = middleTab === sub.key;
            return (
              <button
                key={sub.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onMiddleChange(sub.key)}
                className="team-sub-tab"
                data-active={active || undefined}
                style={active ? SUB_PILL_ACTIVE_STYLE : SUB_PILL_STYLE}
              >
                <span aria-hidden>{sub.icon}</span>
                <span>{sub.label}</span>
                {sub.key === 'messages' && unreadCount > 0 ? (
                  <Badge count={unreadCount} tone="danger" />
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
