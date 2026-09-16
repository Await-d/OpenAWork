/**
 * 260531-team-page · TeamTabBar — 统一的两层 tab 切换栏
 *
 * 取代 TeamPageV2 顶部原先"下划线主 tab + 浮动 accent-pill 对话子视图 +
 * 描边 3D 按钮 + segmented 子 tab"四套视觉语言混用的杂乱实现。
 *
 * 统一为一套视觉系统：
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ 〔概览〕〔对话〕〔任务〕〔度量〕〔治理〕            │ 3D │   ← 主 tab：segmented 胶囊
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
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { PRIMARY_TABS, type PrimaryTabKey, type SubTabDef } from '../../tabs/team-page-v2-tabs.js';
import { TeamTabIcon } from '../../tabs/team-tab-icons.js';
import type { MiddleTabKey } from '../../tabs/MiddleTabRouter.js';
import { TeamRunStatePill } from '../../shared/TeamRunStatePill.js';
import { shouldMergeSubTabs } from './team-tab-bar-layout.js';

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
  // 点击目标 ≥28px 高：功能切换要容易命中，不能只追求视觉紧凑。
  padding: '6px 12px',
  borderRadius: 6,
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
  padding: '6px 10px',
  borderRadius: 6,
  border: 'none',
  background: 'color-mix(in srgb, var(--fg-muted) 10%, transparent)',
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
  background: 'color-mix(in srgb, var(--accent) 16%, transparent)',
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
  padding: '0 10px 3px',
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

/**
 * 上下文行合并阈值（px，以 tab bar 自身宽度测量）。
 * ≥ 该值：leading（工作区/会话）+ centerSlot（运行状态操作）+ trailing（摘要）
 *   三栏同处一行；
 * < 该值：centerSlot 自动降级为独立状态行，避免三栏互相挤压裁切。
 */
const CONTEXT_MERGE_MIN_WIDTH = 1040;

const SINGLE_CONTEXT_ROW_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  padding: '3px 10px',
  minWidth: 0,
};

const SINGLE_NAV_ROW_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '2px 10px',
  minWidth: 0,
};

const SINGLE_STATUS_ROW_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  padding: '2px 10px',
  minWidth: 0,
};

const LEADING_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  // 三栏同行时：吸收剩余空间（grow），空间不足时按「摘要 → 标题 → 操作」
  // 的优先级让位（leading shrink 3 / trailing shrink 6 / center shrink 1）。
  flex: '1 3 320px',
  minWidth: 0,
  minHeight: 26,
};

const CONTEXT_TRAILING_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: 6,
  flex: '0 6 auto',
  minWidth: 0,
  maxWidth: '100%',
};

/**
 * 主 tab 组外壳：只做弹性伸缩与遮罩定位（position: relative），
 * 真正的横向滚动交给内部 `.team-tab-bar__tab-scroll`。
 */
const NAV_PRIMARY_WRAP_STYLE: CSSProperties = {
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  // 压缩优先级最低：尽量保住主 tab 可见，真放不下时内部横向滚动兜底。
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: 280,
  minWidth: 0,
};

/**
 * 主 tab 横向滚动容器：窄屏不折叠、不换行，直接横向滚动
 * （触控滑动、滚轮、键盘方向键都可操作；滚动条隐藏，靠两端渐隐提示）。
 */
const SINGLE_PRIMARY_GROUP_STYLE: CSSProperties = {
  ...PRIMARY_GROUP_STYLE,
  flex: '1 1 auto',
  minWidth: 0,
  flexWrap: 'nowrap',
  overflowX: 'auto',
  scrollbarWidth: 'none',
  overscrollBehaviorX: 'contain',
};

/** 左右两端渐隐遮罩：提示「这边还有更多主 tab」，不吃指针事件。 */
const EDGE_MASK_LEFT_STYLE: CSSProperties = {
  position: 'absolute',
  top: 0,
  bottom: 0,
  left: 0,
  width: 20,
  borderRadius: '6px 0 0 6px',
  background: 'linear-gradient(to right, var(--bg-surface), transparent)',
  pointerEvents: 'none',
  zIndex: 1,
  transition: 'opacity 140ms ease',
};

const EDGE_MASK_RIGHT_STYLE: CSSProperties = {
  ...EDGE_MASK_LEFT_STYLE,
  left: 'auto',
  right: 0,
  borderRadius: '0 6px 6px 0',
  background: 'linear-gradient(to left, var(--bg-surface), transparent)',
};

/** 单行超级栏内嵌的状态栏（centerSlot）包裹层：三栏同行时居中、最后让位收缩。 */
const CENTER_SLOT_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  minWidth: 0,
  flexGrow: 0,
  flexShrink: 1,
  flexBasis: 'auto',
  overflow: 'hidden',
  padding: '2px 0',
  borderRadius: 4,
};

const SINGLE_ACTIONS_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  flexShrink: 0,
};

/** 合并态：主 tab 组不再吸收剩余空间，让子 tab 组紧跟其后。 */
const MERGED_NAV_PRIMARY_WRAP_STYLE: CSSProperties = {
  ...NAV_PRIMARY_WRAP_STYLE,
  flexGrow: 0,
  flexShrink: 1,
  flexBasis: 'auto',
};

/** 主 tab 与内联子 tab 之间的竖直分隔线。 */
const NAV_DIVIDER_STYLE: CSSProperties = {
  width: 1,
  height: 16,
  flexShrink: 0,
  margin: '0 2px',
  background: 'color-mix(in srgb, var(--border-default) 55%, transparent)',
};

/** 合并态：内联子 tab 组（空间不足时优先让位裁切，不挤压主 tab）。 */
const NAV_SUB_GROUP_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 2,
  minWidth: 0,
  flexShrink: 1,
  overflow: 'hidden',
};

/** 子 tab 自然宽度测量行：始终渲染（不参与布局），供合并判定用。 */
const SUB_GHOST_ROW_STYLE: CSSProperties = {
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

/**
 * 隐藏的测量行：渲染全部主 tab 的自然宽度，供子 tab 合并判定用。
 * 零尺寸 + overflow: hidden——它挂在横向滚动容器里，绝不能撑出可滚区域。
 * （子项带 flexShrink: 0，即使父级宽 0 也保持自然宽度，测量结果不受影响。）
 */
const GHOST_ROW_STYLE: CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  width: 0,
  height: 0,
  overflow: 'hidden',
  display: 'inline-flex',
  gap: 2,
  visibility: 'hidden',
  pointerEvents: 'none',
  zIndex: -1,
  whiteSpace: 'nowrap',
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
   *   - 'single'：单条超级栏。主 tab 窄屏不折叠、改为横向滚动；额外通过
   *     leadingSlot / trailingSlot 接收工作区切换器、运行状态、暂停等，
   *     把原来的 page-header + 两层 tab 合并为一条（方案 G）。
   */
  variant?: 'rows' | 'single';
  /** 单行模式下，超级栏最左侧的内容（如团队标题 + 工作区切换器）。 */
  leadingSlot?: ReactNode;
  /** 单行模式下，主 tab 组与右侧操作之间的内容（如运行状态栏）。 */
  centerSlot?: ReactNode;
  /**
   * 强制把 centerSlot（运行状态操作）降级为独立状态行。
   * 默认 false：宽度充足（≥ CONTEXT_MERGE_MIN_WIDTH）时与 leading / trailing
   * 三栏同行；宽度不足时组件内部自动降级，无需调用方干预。
   * 传 true 用于窄屏形态（如 tablet）直接锁定降级，跳过内部测量。
   */
  stackCenterSlot?: boolean;
  /**
   * 隐藏导航行尾部 TeamRunStatePill。
   * classic 顶栏已用 TeamStatusBar 展示状态时避免双份状态胶囊。
   */
  hideRunStatePill?: boolean;
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
  stackCenterSlot = false,
  hideRunStatePill = false,
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
        stackCenterSlot={stackCenterSlot}
        hideRunStatePill={hideRunStatePill}
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
            const badge = primaryBadge(
              primary.key,
              unreadCount,
              clarificationPending,
              failedTaskCount,
            );
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
                <TeamTabIcon name={primary.icon} />
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
              <TeamTabIcon name="office" />
              <span>3D 办公</span>
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
                <TeamTabIcon name={sub.icon} size={13} />
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
  | 'stackCenterSlot'
  | 'hideRunStatePill'
  | 'trailingSlot'
>;

/**
 * 单条超级栏：把工作区切换（leadingSlot）+ 主 tab + 运行状态（centerSlot）
 * + 3D / 暂停 / 治理（trailingSlot）压进一行。
 *
 * 主 tab 胶囊点击行为：一击直达，没有二级下拉。
 *   - 窄屏放不下时不折叠，主 tab 组横向滚动（触控滑动 / 滚轮 / ←→ 均可）；
 *     两端渐隐提示还有内容，激活项会自动滚进可视区。
 *   - 子 tab：宽屏时并入本行（分隔线区隔），窄屏时另起一行常驻。
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
  stackCenterSlot = false,
  hideRunStatePill = false,
  trailingSlot,
}: SingleRowProps) {
  // 上下文行是否需要让 centerSlot 降级为独立状态行。初值 false（先按合并渲染），
  // 首帧测量后收敛；jsdom / 未布局（宽度为 0）时保持合并，避免误降级。
  const [narrowContext, setNarrowContext] = useState(false);
  // 子 tab 是否并入主 tab 行（nav 行）。初值 false（保持独立行），测量后收敛。
  const [navMerge, setNavMerge] = useState(false);
  // 主 tab 横向滚动：左右两端是否还有内容（决定渐隐遮罩显隐）。
  const [scrollEdges, setScrollEdges] = useState({ left: false, right: false });

  const rootRef = useRef<HTMLDivElement>(null);
  const groupRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const subGhostRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<HTMLSpanElement | null>(null);

  // 主 tab 横向滚动：滚动位置或内容宽度变化时刷新两端渐隐遮罩。
  // 依赖项覆盖会改变 tab 宽度的输入（badge 数量、激活项、合并态）。
  useLayoutEffect(() => {
    const group = groupRef.current;
    if (!group) return undefined;
    const sync = () => {
      const maxScroll = group.scrollWidth - group.clientWidth;
      // jsdom / 未布局时 scrollWidth 与 clientWidth 同为 0：保持无遮罩。
      const left = group.scrollLeft > 1;
      const right = maxScroll > 1 && group.scrollLeft < maxScroll - 1;
      setScrollEdges((prev) =>
        prev.left === left && prev.right === right ? prev : { left, right },
      );
    };
    sync();
    group.addEventListener('scroll', sync, { passive: true });
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(sync);
      ro.observe(group);
      return () => {
        group.removeEventListener('scroll', sync);
        ro.disconnect();
      };
    }
    window.addEventListener('resize', sync);
    return () => {
      group.removeEventListener('scroll', sync);
      window.removeEventListener('resize', sync);
    };
  }, [activePrimary, officeActive, unreadCount, clarificationPending, failedTaskCount, navMerge]);

  // 激活项滚进可视区：从别处切回来 / 键盘跨过滚动区时，
  // 别让「当前在哪个分类」藏在滚动区外。
  useLayoutEffect(() => {
    const group = groupRef.current;
    // jsdom / 未布局（宽度为 0）时不做滚动，避免噪声。
    if (!group || group.clientWidth === 0) return undefined;
    const active = group.querySelector<HTMLElement>('[data-tab-key][data-active="true"]');
    if (!active) return undefined;
    const groupRect = group.getBoundingClientRect();
    const activeRect = active.getBoundingClientRect();
    const margin = 8;
    if (activeRect.left < groupRect.left + margin) {
      group.scrollLeft -= groupRect.left + margin - activeRect.left;
    } else if (activeRect.right > groupRect.right - margin) {
      group.scrollLeft += activeRect.right - (groupRect.right - margin);
    }
    return undefined;
  }, [activePrimary, officeActive, navMerge]);

  // 纵向滚轮 → 横向滚动：桌面鼠标不用按 Shift 也能翻主 tab。
  useEffect(() => {
    const group = groupRef.current;
    if (!group) return undefined;
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY === 0 || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      const maxScroll = group.scrollWidth - group.clientWidth;
      if (maxScroll <= 1) return;
      const before = group.scrollLeft;
      const next = Math.min(maxScroll, Math.max(0, before + event.deltaY));
      // 已经顶到两端时不动手，把这一滚交还给页面纵向滚动。
      if (next === before) return;
      group.scrollLeft = next;
      event.preventDefault();
    };
    // passive: false —— 需要 preventDefault 阻止滚动外溢到页面。
    group.addEventListener('wheel', onWheel, { passive: false });
    return () => group.removeEventListener('wheel', onWheel);
  }, []);

  // 上下文行自适应：宽度足够（≥ CONTEXT_MERGE_MIN_WIDTH）时，
  // leading / centerSlot（运行状态与操作）/ trailing（摘要）三栏同行；
  // 不足时 centerSlot 自动降级为独立状态行，避免三栏互相挤压裁切。
  // 外部 stackCenterSlot 可强制降级（如 tablet）。
  useLayoutEffect(() => {
    if (stackCenterSlot || !centerSlot) return undefined;
    const el = rootRef.current;
    if (!el) return undefined;
    const measure = () => {
      const width = el.clientWidth;
      setNarrowContext(width > 0 && width < CONTEXT_MERGE_MIN_WIDTH);
    };
    measure();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      return () => ro.disconnect();
    }
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [centerSlot, stackCenterSlot]);

  const handlePrimaryClick = (primary: (typeof PRIMARY_TABS)[number]) => {
    onPrimaryChange(primary.key);
  };

  // 生效的降级标记：外部强制（tablet）或宽度不足自动降级。
  const effectiveStack = stackCenterSlot || narrowContext;
  const hasContextRow = Boolean(leadingSlot || trailingSlot || (centerSlot && !effectiveStack));

  // 当前主 tab 的子视图。office 视图下不显示子 tab；宽屏时会并入 nav 行。
  const subTabs: ReadonlyArray<SubTabDef> =
    activePrimary && !officeActive
      ? (PRIMARY_TABS.find((tab) => tab.key === activePrimary)?.children ?? [])
      : [];

  const renderSubPill = (sub: SubTabDef) => {
    const active = middleTab === sub.key;
    return (
      <button
        key={sub.key}
        type="button"
        role="tab"
        aria-selected={active}
        onClick={() => onMiddleChange(sub.key)}
        className="team-sub-tab"
        data-sub-key={sub.key}
        data-active={active || undefined}
        style={active ? SUB_PILL_ACTIVE_STYLE : SUB_PILL_STYLE}
      >
        <TeamTabIcon name={sub.icon} size={13} />
        <span>{sub.label}</span>
        {sub.key === 'messages' && unreadCount > 0 ? (
          <Badge count={unreadCount} tone="danger" />
        ) : null}
      </button>
    );
  };

  // 键盘方向键在 tab 组内切换（ARIA tabs 模式）：← → 循环移动，Home / End 到首尾。
  // 键盘切换后把焦点跟随到目标 tab，保证连续导航不中断。
  const movePrimaryByKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const keys = PRIMARY_TABS.map((tab) => tab.key);
    let nextKey: PrimaryTabKey | null = null;
    if (event.key === 'ArrowRight') {
      const currentIndex = activePrimary ? keys.indexOf(activePrimary) : -1;
      nextKey = keys[(currentIndex + 1) % keys.length] ?? null;
    } else if (event.key === 'ArrowLeft') {
      const currentIndex = activePrimary ? Math.max(keys.indexOf(activePrimary), 0) : 0;
      nextKey = keys[(currentIndex - 1 + keys.length) % keys.length] ?? null;
    } else if (event.key === 'Home') {
      nextKey = keys[0] ?? null;
    } else if (event.key === 'End') {
      nextKey = keys[keys.length - 1] ?? null;
    }
    if (!nextKey) return;
    event.preventDefault();
    if (nextKey !== activePrimary) {
      onPrimaryChange(nextKey);
    }
    requestAnimationFrame(() => {
      groupRef.current?.querySelector<HTMLButtonElement>(`[data-tab-key="${nextKey}"]`)?.focus();
    });
  };

  const moveSubByKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const keys = subTabs.map((tab) => tab.key);
    if (keys.length === 0) return;
    let nextKey: MiddleTabKey | null = null;
    if (event.key === 'ArrowRight') {
      const currentIndex = keys.indexOf(middleTab);
      nextKey = keys[(currentIndex + 1) % keys.length] ?? null;
    } else if (event.key === 'ArrowLeft') {
      const currentIndex = Math.max(keys.indexOf(middleTab), 0);
      nextKey = keys[(currentIndex - 1 + keys.length) % keys.length] ?? null;
    } else if (event.key === 'Home') {
      nextKey = keys[0] ?? null;
    } else if (event.key === 'End') {
      nextKey = keys[keys.length - 1] ?? null;
    }
    if (!nextKey) return;
    event.preventDefault();
    if (nextKey !== middleTab) {
      onMiddleChange(nextKey);
    }
    requestAnimationFrame(() => {
      rootRef.current?.querySelector<HTMLButtonElement>(`[data-sub-key="${nextKey}"]`)?.focus();
    });
  };

  // 子 tab 并入 nav 行的自适应测量：主 tab 全量自然宽 + 子 tab 自然宽 +
  // 右侧操作区 + 余量能放进 nav 行时合并，否则保持独立子 tab 行。
  // jsdom / 未布局（宽度为 0）时保持独立行（保守，避免误合并）。
  const subTabsKey = subTabs.map((sub) => sub.key).join('|');
  useLayoutEffect(() => {
    const root = rootRef.current;
    const subGhost = subGhostRef.current;
    if (!root || !subGhost) {
      setNavMerge(false);
      return undefined;
    }
    const measure = () => {
      const ghost = ghostRef.current;
      const actions = actionsRef.current;
      const GAP = 2;
      const sumWidth = (parent: HTMLElement | null) =>
        parent
          ? Array.from(parent.children).reduce<number>(
              (acc, el) => acc + (el as HTMLElement).offsetWidth + GAP,
              0,
            )
          : 0;
      setNavMerge(
        shouldMergeSubTabs({
          navWidth: root.clientWidth,
          mainWidth: sumWidth(ghost),
          subWidth: sumWidth(subGhost),
          actionsWidth: actions?.offsetWidth ?? 0,
        }),
      );
    };
    measure();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(measure);
      ro.observe(root);
      if (actionsRef.current) ro.observe(actionsRef.current);
      return () => ro.disconnect();
    }
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [subTabsKey]);

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
        data-tab-key={primary.key}
        data-active={active || undefined}
        style={active ? PRIMARY_PILL_ACTIVE_STYLE : PRIMARY_PILL_STYLE}
        title={primary.label}
      >
        <TeamTabIcon name={primary.icon} />
        <span>{primary.label}</span>
        {badge ? <Badge count={badge.count} tone={badge.tone} /> : null}
      </button>
    );
  };

  return (
    <div
      ref={rootRef}
      className="team-tab-bar team-tab-bar--single"
      data-hide-run-state-pill={hideRunStatePill ? 'true' : undefined}
      data-stack-center={effectiveStack ? 'true' : undefined}
      style={BAR_ROOT_STYLE}
    >
      {/* 第 ① 行：上下文信息。宽度足够时 leading（工作区/会话）+ centerSlot
          （运行状态与操作）+ trailing（摘要）三栏同行，最大化利用横向空间、
          压缩顶部纵向占据；不足时 centerSlot 降级为下一行独立状态行。 */}
      {hasContextRow ? (
        <div className="team-tab-bar__context" style={SINGLE_CONTEXT_ROW_STYLE}>
          {leadingSlot ? (
            <span className="team-tab-bar__leading" style={LEADING_STYLE}>
              {leadingSlot}
            </span>
          ) : null}
          {centerSlot && !effectiveStack ? (
            <span className="team-tab-bar__center" style={CENTER_SLOT_STYLE}>
              {centerSlot}
            </span>
          ) : null}
          {trailingSlot ? (
            <span className="team-tab-bar__trailing" style={CONTEXT_TRAILING_STYLE}>
              {trailingSlot}
            </span>
          ) : null}
        </div>
      ) : null}

      {centerSlot && effectiveStack ? (
        <div className="team-tab-bar__status" style={SINGLE_STATUS_ROW_STYLE}>
          <span style={CENTER_SLOT_STYLE}>{centerSlot}</span>
        </div>
      ) : null}

      {/* 第 ② 行：主 tab（窄屏横向滚动、不折叠；宽屏时子 tab 并入本行）+
          运行状态 + 3D。 */}
      <div
        className="team-tab-bar__nav"
        style={SINGLE_NAV_ROW_STYLE}
        data-merged-sub={navMerge ? 'true' : undefined}
      >
        {/* 外壳只负责定位两端遮罩；滚动发生在内部容器，滚轮 / 触控 / ←→ 都能翻。 */}
        <div style={navMerge ? MERGED_NAV_PRIMARY_WRAP_STYLE : NAV_PRIMARY_WRAP_STYLE}>
          <div
            ref={groupRef}
            className="team-tab-bar__tab-scroll"
            style={SINGLE_PRIMARY_GROUP_STYLE}
            role="tablist"
            aria-label="主分类切换"
            onKeyDown={movePrimaryByKeyboard}
          >
            {/* 隐藏测量行：渲染全部主 tab 的自然宽度，供子 tab 合并判定用 */}
            <div ref={ghostRef} style={GHOST_ROW_STYLE} aria-hidden>
              {PRIMARY_TABS.map((primary) => {
                const ghostBadge = primaryBadge(
                  primary.key,
                  unreadCount,
                  clarificationPending,
                  failedTaskCount,
                );
                return (
                  <span key={primary.key} style={PRIMARY_PILL_STYLE}>
                    <TeamTabIcon name={primary.icon} />
                    <span>{primary.label}</span>
                    {ghostBadge ? <Badge count={ghostBadge.count} tone={ghostBadge.tone} /> : null}
                  </span>
                );
              })}
            </div>

            {PRIMARY_TABS.map(renderPrimaryPill)}
          </div>

          {/* 两端渐隐：提示「这一侧还有主 tab 可以滚出来」 */}
          <span
            className="team-tab-bar__edge-mask"
            style={{ ...EDGE_MASK_LEFT_STYLE, opacity: scrollEdges.left ? 1 : 0 }}
            aria-hidden
          />
          <span
            className="team-tab-bar__edge-mask"
            style={{ ...EDGE_MASK_RIGHT_STYLE, opacity: scrollEdges.right ? 1 : 0 }}
            aria-hidden
          />
        </div>

        {/* 合并态：子 tab 内联在主 tab 组后，用分隔线与主 tab 区隔。 */}
        {navMerge && subTabs.length > 1 ? (
          <>
            <span style={NAV_DIVIDER_STYLE} aria-hidden />
            <div
              className="team-tab-bar__sub-inline"
              style={NAV_SUB_GROUP_STYLE}
              role="tablist"
              aria-label="子视图切换"
            >
              {subTabs.map(renderSubPill)}
            </div>
          </>
        ) : null}

        {/* 子 tab 自然宽度测量行（始终渲染，不可见、不占位）。 */}
        {subTabs.length > 1 ? (
          <div ref={subGhostRef} style={SUB_GHOST_ROW_STYLE} aria-hidden>
            {subTabs.map((sub) => (
              <span key={sub.key} style={SUB_PILL_STYLE}>
                <TeamTabIcon name={sub.icon} size={13} />
                <span>{sub.label}</span>
                {sub.key === 'messages' && unreadCount > 0 ? (
                  <Badge count={unreadCount} tone="danger" />
                ) : null}
              </span>
            ))}
          </div>
        ) : null}

        <span ref={actionsRef} style={SINGLE_ACTIONS_STYLE}>
          {hideRunStatePill ? null : <TeamRunStatePill />}
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
              <TeamTabIcon name="office" />
              <span>3D</span>
            </button>
          ) : null}
        </span>
      </div>

      {/* 第 ③ 行：当前主 tab 的子视图（仅在未并入 nav 行时独立成行）。 */}
      {!navMerge && subTabs.length > 1 ? (
        <div
          className="team-tab-bar__sub-row"
          style={SUB_ROW_STYLE}
          role="tablist"
          aria-label="子视图切换"
          onKeyDown={moveSubByKeyboard}
        >
          {subTabs.map(renderSubPill)}
        </div>
      ) : null}
    </div>
  );
}
