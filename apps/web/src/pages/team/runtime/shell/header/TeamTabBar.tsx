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

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { PRIMARY_TABS, type PrimaryTabKey, type SubTabDef } from '../../tabs/team-page-v2-tabs.js';
import type { MiddleTabKey } from '../../tabs/MiddleTabRouter.js';
import { TeamRunStatePill } from '../../shared/TeamRunStatePill.js';

// ─── 容器 ────────────────────────────────────────────────────────

const BAR_ROOT_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  flexShrink: 0,
  background: 'var(--bg-overlay)',
  borderBottom: '1px solid color-mix(in srgb, var(--border-default) 30%, transparent)',
};

const PRIMARY_ROW_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '4px 10px',
  minWidth: 0,
};

const PRIMARY_GROUP_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 1,
  padding: 1,
  borderRadius: 6,
  background: 'var(--bg-surface)',
  overflowX: 'auto',
  scrollbarWidth: 'none',
  minWidth: 0,
};

// ─── 主 tab 胶囊 ─────────────────────────────────────────────────

const PRIMARY_PILL_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '4px 10px',
  borderRadius: 5,
  border: 'none',
  background: 'transparent',
  color: 'var(--fg-muted)',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  flexShrink: 0,
  transition: 'background 100ms ease, color 100ms ease',
};

const PRIMARY_PILL_ACTIVE_STYLE: CSSProperties = {
  ...PRIMARY_PILL_STYLE,
  background: 'var(--bg-overlay)',
  color: 'var(--fg-strong)',
  fontWeight: 700,
};

// ─── 3D 办公动作按钮 ─────────────────────────────────────────────

const OFFICE_BTN_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '4px 8px',
  borderRadius: 5,
  border: '1px solid color-mix(in srgb, var(--border-default) 40%, transparent)',
  background: 'transparent',
  color: 'var(--fg-default)',
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  flexShrink: 0,
  marginLeft: 'auto',
  transition: 'background 100ms ease, color 100ms ease',
};

const OFFICE_BTN_ACTIVE_STYLE: CSSProperties = {
  ...OFFICE_BTN_STYLE,
  background: 'color-mix(in srgb, var(--accent) 10%, transparent)',
  borderColor: 'color-mix(in srgb, var(--accent) 40%, transparent)',
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
  padding: '0 10px 4px',
  overflowX: 'auto',
  scrollbarWidth: 'none',
  minWidth: 0,
};

const SUB_PILL_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '3px 8px',
  borderRadius: 4,
  border: 'none',
  background: 'transparent',
  color: 'var(--fg-subtle)',
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  flexShrink: 0,
  transition: 'background 100ms ease, color 100ms ease',
};

const SUB_PILL_ACTIVE_STYLE: CSSProperties = {
  ...SUB_PILL_STYLE,
  background: 'color-mix(in srgb, var(--accent) 10%, transparent)',
  color: 'var(--accent)',
  fontWeight: 700,
};

// ─── 单行超级栏（variant='single'，方案 G）────────────────────────

const SINGLE_CONTEXT_ROW_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  padding: '4px 10px',
  minWidth: 0,
};

const SINGLE_NAV_ROW_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '0 10px 4px',
  minWidth: 0,
};

const LEADING_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  flex: '1 1 420px',
  minWidth: 0,
  minHeight: 28,
};

const CONTEXT_TRAILING_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: 6,
  flex: '1 1 320px',
  minWidth: 0,
};

const SINGLE_PRIMARY_GROUP_STYLE: CSSProperties = {
  ...PRIMARY_GROUP_STYLE,
  flex: '1 1 280px',
  minWidth: 0,
  flexWrap: 'nowrap',
  overflowX: 'visible',
  position: 'relative',
  // 压缩优先级最低：尽量保住主 tab 可见，真不够了再靠「更多 ▾」溢出兜底。
  flexShrink: 1,
};

/** 单行超级栏内嵌的状态栏（centerSlot）包裹层：最优先让位、可整体收缩到 0。 */
const CENTER_SLOT_STYLE: CSSProperties = {
  display: 'inline-flex',
  minWidth: 0,
  flexGrow: 1,
  flexShrink: 8,
  flexBasis: 'auto',
  overflow: 'hidden',
  padding: '2px 4px',
  borderRadius: 4,
  background: 'var(--bg-surface)',
};

const SINGLE_ACTIONS_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  flexShrink: 0,
};

/** 隐藏的测量行：渲染全部主 tab 的自然宽度，供溢出计算用，不参与可视布局。 */
const GHOST_ROW_STYLE: CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  display: 'inline-flex',
  gap: 2,
  visibility: 'hidden',
  pointerEvents: 'none',
  zIndex: -1,
  whiteSpace: 'nowrap',
};

const CARET_STYLE: CSSProperties = {
  fontSize: 9,
  opacity: 0.7,
  marginLeft: 1,
};

const DROPDOWN_STYLE: CSSProperties = {
  position: 'fixed',
  zIndex: 1000,
  minWidth: 184,
  padding: 5,
  borderRadius: 10,
  background: 'var(--bg-overlay)',
  border: '1px solid var(--border-default)',
  boxShadow: 'var(--shadow-lg)',
};

const DROPDOWN_ITEM_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  padding: '8px 10px',
  borderRadius: 7,
  border: 'none',
  background: 'transparent',
  color: 'var(--fg-default)',
  fontSize: 12,
  fontWeight: 600,
  textAlign: 'left',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const DROPDOWN_ITEM_ACTIVE_STYLE: CSSProperties = {
  ...DROPDOWN_ITEM_STYLE,
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
  /** 失败任务数（任务主 tab 上的红色气泡，引导用户查看任务看板）。 */
  failedTaskCount?: number;
  /** 是否显示 3D 办公入口（移动端隐藏）。 */
  showOffice: boolean;
  /** 当前是否处于 3D 办公视图。 */
  officeActive: boolean;
  /** 点击 3D：非激活→切入；已激活→全屏。 */
  onOfficeClick: () => void;
  /**
   * 布局变体：
   *   - 'rows'（默认）：主 tab 行 + 子 tab 行两条横栏（旧行为，保持向下兼容）。
   *   - 'single'：单条超级栏。主 tab 用带 ▾ 的胶囊，子 tab 收进点击浮出的下拉，
   *     额外通过 leadingSlot / trailingSlot 接收工作区切换器、运行状态、暂停等，
   *     把原来的 page-header + 两层 tab 合并为一条（方案 G）。
   */
  variant?: 'rows' | 'single';
  /** 单行模式下，超级栏最左侧的内容（如团队标题 + 工作区切换器）。 */
  leadingSlot?: ReactNode;
  /** 单行模式下，主 tab 组与右侧操作之间的内容（如运行状态栏）。 */
  centerSlot?: ReactNode;
  /** 单行模式下，最右侧操作区（如暂停按钮、治理齿轮）；显示在运行胶囊与 3D 之后。 */
  trailingSlot?: ReactNode;
}

/** 主 tab 上的 badge 计数。 */
function primaryBadge(
  key: PrimaryTabKey,
  unreadCount: number,
  clarificationPending: number,
  failedTaskCount: number,
): { count: number; tone: 'danger' | 'warning' } | null {
  if (key === 'conversation' && unreadCount > 0) return { count: unreadCount, tone: 'danger' };
  // 任务 tab：失败任务数优先用红色 danger 气泡，
  // 其次待澄清用黄色 warning 气泡
  if (key === 'tasks') {
    if (failedTaskCount > 0) return { count: failedTaskCount, tone: 'danger' };
    if (clarificationPending > 0) return { count: clarificationPending, tone: 'warning' };
  }
  return null;
}

export function TeamTabBar({
  activePrimary,
  middleTab,
  onPrimaryChange,
  onMiddleChange,
  unreadCount,
  clarificationPending,
  failedTaskCount = 0,
  showOffice,
  officeActive,
  onOfficeClick,
  variant = 'rows',
  leadingSlot,
  centerSlot,
  trailingSlot,
}: TeamTabBarProps) {
  const subTabs: ReadonlyArray<SubTabDef> =
    activePrimary && !officeActive
      ? (PRIMARY_TABS.find((tab) => tab.key === activePrimary)?.children ?? [])
      : [];

  if (variant === 'single') {
    return (
      <SingleRowTabBar
        activePrimary={activePrimary}
        middleTab={middleTab}
        onPrimaryChange={onPrimaryChange}
        onMiddleChange={onMiddleChange}
        unreadCount={unreadCount}
        clarificationPending={clarificationPending}
        failedTaskCount={failedTaskCount}
        showOffice={showOffice}
        officeActive={officeActive}
        onOfficeClick={onOfficeClick}
        leadingSlot={leadingSlot}
        centerSlot={centerSlot}
        trailingSlot={trailingSlot}
      />
    );
  }

  return (
    <div style={BAR_ROOT_STYLE}>
      {/* 主 tab 行 */}
      <div style={PRIMARY_ROW_STYLE}>
        <div style={PRIMARY_GROUP_STYLE} role="tablist" aria-label="主分类切换">
          {PRIMARY_TABS.map((primary) => {
            const active = !officeActive && activePrimary === primary.key;
            const badge = primaryBadge(primary.key, unreadCount, clarificationPending, failedTaskCount);
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

// ─── 单行超级栏实现（方案 G）──────────────────────────────────

type SingleRowProps = Pick<
  TeamTabBarProps,
  | 'activePrimary'
  | 'middleTab'
  | 'onPrimaryChange'
  | 'onMiddleChange'
  | 'unreadCount'
  | 'clarificationPending'
  | 'failedTaskCount'
  | 'showOffice'
  | 'officeActive'
  | 'onOfficeClick'
  | 'leadingSlot'
  | 'centerSlot'
  | 'trailingSlot'
>;

/**
 * 单条超级栏：把工作区切换（leadingSlot）+ 主 tab（带子 tab 下拉）+ 运行状态
 * （centerSlot）+ 3D / 暂停 / 治理（trailingSlot）压进一行。
 *
 * 主 tab 胶囊点击行为：
 *   - 若该主 tab 只有 1 个子视图（如对话场景下的退化）：直接切换，不弹下拉。
 *   - 若有多个子视图：单击切到该主 tab（并落到默认/当前子 tab）同时展开下拉，
 *     下拉里可进一步选具体子 tab。再次点击同一主 tab 收起下拉。
 */
function SingleRowTabBar({
  activePrimary,
  middleTab,
  onPrimaryChange,
  onMiddleChange,
  unreadCount,
  clarificationPending,
  failedTaskCount = 0,
  showOffice,
  officeActive,
  onOfficeClick,
  leadingSlot,
  centerSlot,
  trailingSlot,
}: SingleRowProps) {
  // 主 tab「更多」溢出菜单的展开态与锚点。
  const [moreOpen, setMoreOpen] = useState(false);
  const [moreRect, setMoreRect] = useState<DOMRect | null>(null);
  // 可见主 tab 数量（其余进「更多」）。初值先全显，测量后收敛。
  const [visibleCount, setVisibleCount] = useState<number>(PRIMARY_TABS.length);

  const rootRef = useRef<HTMLDivElement>(null);
  const groupRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const moreBtnRef = useRef<HTMLButtonElement | null>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  // 点击外部 / Esc 收起「更多」菜单
  useEffect(() => {
    if (!moreOpen) return undefined;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (moreMenuRef.current?.contains(target)) return;
      setMoreOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMoreOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [moreOpen]);

  // 「更多」菜单锚点定位。
  useLayoutEffect(() => {
    if (!moreOpen) {
      setMoreRect(null);
      return undefined;
    }
    const measure = () => {
      if (moreBtnRef.current) setMoreRect(moreBtnRef.current.getBoundingClientRect());
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [moreOpen]);

  // 响应式溢出测量：用 ghost 行测每个主 tab 的自然宽度，按可用宽度决定显示几个，
  // 其余收进「更多 ▾」。容器宽度变化（ResizeObserver）时重算。
  useLayoutEffect(() => {
    const group = groupRef.current;
    const ghost = ghostRef.current;
    if (!group || !ghost) return undefined;

    const recompute = () => {
      const avail = group.clientWidth;
      const pills = Array.from(ghost.children) as HTMLElement[];
      if (pills.length === 0) return;
      // 测不到宽度（如 jsdom 或尚未布局）时，保持全部可见，避免误折叠。
      if (avail === 0) {
        setVisibleCount(PRIMARY_TABS.length);
        return;
      }
      const gap = 2;
      // 预留「更多」按钮宽度（固定估值，足够容纳「更多 ▾」）。
      const moreWidth = 64;
      // 先尝试全部放下
      const widths = pills.map((p) => p.offsetWidth);
      const totalAll = widths.reduce((a, b) => a + b + gap, 0);
      if (totalAll <= avail) {
        setVisibleCount(PRIMARY_TABS.length);
        return;
      }
      // 放不下：逐个累加，给「更多」留位
      let used = moreWidth;
      let count = 0;
      for (let i = 0; i < widths.length; i++) {
        const w = widths[i]! + gap;
        if (used + w <= avail) {
          used += w;
          count += 1;
        } else break;
      }
      setVisibleCount(Math.max(1, count));
    };

    recompute();
    // ResizeObserver 在部分测试环境（jsdom）下不存在；降级为 window resize 监听，
    // 保证功能可用且不抛错。
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(recompute);
      ro.observe(group);
      return () => ro.disconnect();
    }
    window.addEventListener('resize', recompute);
    return () => window.removeEventListener('resize', recompute);
  }, []);

  const handlePrimaryClick = (primary: (typeof PRIMARY_TABS)[number]) => {
    onPrimaryChange(primary.key);
    setMoreOpen(false);
  };

  const visibleTabs = PRIMARY_TABS.slice(0, visibleCount);
  const overflowTabs = PRIMARY_TABS.slice(visibleCount);
  const overflowActive = overflowTabs.some((p) => !officeActive && activePrimary === p.key);

  // 当前主 tab 的子视图（常驻第二行）。office 视图下不显示子 tab。
  const subTabs: ReadonlyArray<SubTabDef> =
    activePrimary && !officeActive
      ? (PRIMARY_TABS.find((tab) => tab.key === activePrimary)?.children ?? [])
      : [];

  const renderPrimaryPill = (primary: (typeof PRIMARY_TABS)[number]) => {
    const active = !officeActive && activePrimary === primary.key;
    const badge = primaryBadge(primary.key, unreadCount, clarificationPending, failedTaskCount);
    return (
      <button
        key={primary.key}
        type="button"
        role="tab"
        aria-selected={active}
        onClick={() => handlePrimaryClick(primary)}
        className="team-tab-pill"
        data-active={active || undefined}
        style={active ? PRIMARY_PILL_ACTIVE_STYLE : PRIMARY_PILL_STYLE}
        title={primary.label}
      >
        <span aria-hidden style={{ fontSize: 14 }}>
          {primary.icon}
        </span>
        <span>{primary.label}</span>
        {badge ? <Badge count={badge.count} tone={badge.tone} /> : null}
      </button>
    );
  };

  return (
    <div ref={rootRef} style={BAR_ROOT_STYLE}>
      {/* 第 ① 行：上下文信息。工作区 / 当前会话与统计分开，避免导航行被挤压。 */}
      <div style={SINGLE_CONTEXT_ROW_STYLE}>
        {leadingSlot ? <span style={LEADING_STYLE}>{leadingSlot}</span> : null}
        {trailingSlot ? <span style={CONTEXT_TRAILING_STYLE}>{trailingSlot}</span> : null}
      </div>

      {/* 第 ② 行：主 tab（窄屏溢出「更多」）+ 运行状态 + 3D。 */}
      <div style={SINGLE_NAV_ROW_STYLE}>
        <div
          ref={groupRef}
          style={SINGLE_PRIMARY_GROUP_STYLE}
          role="tablist"
          aria-label="主分类切换"
        >
          {/* 隐藏测量行：始终渲染全部主 tab 以获取自然宽度 */}
          <div ref={ghostRef} style={GHOST_ROW_STYLE} aria-hidden>
            {PRIMARY_TABS.map((primary) => (
              <span key={primary.key} style={PRIMARY_PILL_STYLE}>
                <span style={{ fontSize: 14 }}>{primary.icon}</span>
                <span>{primary.label}</span>
              </span>
            ))}
          </div>

          {visibleTabs.map(renderPrimaryPill)}

          {overflowTabs.length > 0 ? (
            <button
              ref={moreBtnRef}
              type="button"
              aria-haspopup="menu"
              aria-expanded={moreOpen}
              onClick={() => {
                setMoreOpen((v) => !v);
              }}
              className="team-tab-pill"
              data-active={overflowActive || undefined}
              style={overflowActive ? PRIMARY_PILL_ACTIVE_STYLE : PRIMARY_PILL_STYLE}
              title="更多分类"
            >
              <span>更多</span>
              <span style={CARET_STYLE}>▾</span>
            </button>
          ) : null}
        </div>

        {/* 「更多」溢出菜单：portal + fixed */}
        {moreOpen && moreRect && overflowTabs.length > 0
          ? createPortal(
              <div
                ref={moreMenuRef}
                role="menu"
                aria-label="更多主分类"
                style={{
                  ...DROPDOWN_STYLE,
                  top: moreRect.bottom + 5,
                  left: Math.max(8, moreRect.right - 184),
                }}
              >
                {overflowTabs.map((primary) => {
                  const active = !officeActive && activePrimary === primary.key;
                  const badge = primaryBadge(primary.key, unreadCount, clarificationPending, failedTaskCount);
                  return (
                    <button
                      key={primary.key}
                      type="button"
                      role="menuitemradio"
                      aria-checked={active}
                      onClick={() => {
                        onPrimaryChange(primary.key);
                        setMoreOpen(false);
                      }}
                      className="team-sub-tab"
                      data-active={active || undefined}
                      style={active ? DROPDOWN_ITEM_ACTIVE_STYLE : DROPDOWN_ITEM_STYLE}
                    >
                      <span aria-hidden>{primary.icon}</span>
                      <span style={{ flex: 1 }}>{primary.label}</span>
                      {badge ? <Badge count={badge.count} tone={badge.tone} /> : null}
                    </button>
                  );
                })}
              </div>,
              document.body,
            )
          : null}

        {centerSlot ? <span style={CENTER_SLOT_STYLE}>{centerSlot}</span> : null}

        <span style={SINGLE_ACTIONS_STYLE}>
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
              <span>3D</span>
            </button>
          ) : null}
        </span>
      </div>

      {/* 第 ③ 行：当前主 tab 的子视图，常驻可见、一键直达（>1 个时才显示）。 */}
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
