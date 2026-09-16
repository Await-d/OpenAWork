/**
 * TerminalTabActions — 每个终端组右侧的操作区：新建终端 / 拆分 / 更多。
 *
 * 低频动作（重命名、清屏、合并到分屏、关闭其他 / 全部）统一收进 ⋯ 菜单，
 * 复用 `TerminalContextMenu`（已带 roving 键盘与 ARIA），避免再写一套浮层。
 *
 * 分屏动作（T-10 起启用）：`onRequestSplit` / `onRequestMerge` + 各自的
 * `*DisabledReason`。**reason 存在即禁用**，title 直接用 reason 说明原因
 * （上限 / 已包含所有终端 / 会话未就绪）；不传回调则回退成禁用并提示未接入。
 */

import { useState } from 'react';
import type { SessionTerminalView } from '../../conversation-runtime/terminals/terminals-api.js';
import type { TerminalSplitDirection } from './layout/types.js';
import { TerminalContextMenu, type TerminalContextMenuItem } from './TerminalContextMenu.js';
import { MoreIcon, PlusIcon, SplitIcon } from './TerminalIcons.js';

/** 与面板其它位置一致：这些状态下的持久终端可以接收 stdin。 */
const WRITABLE_STATUSES = new Set(['running', 'idle', 'tmux-spawned']);

/** 方向拆分的菜单文案：row = 左右并排（向右），column = 上下堆叠（向下）。 */
const SPLIT_DIRECTION_LABELS: Record<TerminalSplitDirection, string> = {
  row: '向右拆分',
  column: '向下拆分',
};

const SPLIT_DIRECTION_HINTS: Record<TerminalSplitDirection, string> = {
  row: '左右',
  column: '上下',
};

/** 桌面上两种方向都可用；窄屏由调用方传 `['column']` 覆盖。 */
const DEFAULT_SPLIT_MENU_DIRECTIONS: readonly TerminalSplitDirection[] = ['row', 'column'];

export interface TerminalTabActionsProps {
  activeTerminal: SessionTerminalView | null;
  /** 本组 tab 数（「关闭其他」与「合并到分屏」的判据）。 */
  terminalCount: number;
  /** 面板内全部终端数（「关闭全部」的判据）；缺省按本组算。 */
  totalTerminalCount?: number;
  /** 会话与 token 就绪时才允许新建。 */
  canCreate: boolean;
  creating: boolean;
  onRequestCreate: () => void;
  onRequestRename: () => void;
  onRequestClear: () => void;
  onRequestCloseOthers: () => void;
  onRequestCloseAll: () => void;
  /** ⊟ 拆分本组（POST 新终端 + splitPane）。 */
  onRequestSplit?: () => void;
  /** 存在即禁用 ⊟，文案即原因。 */
  splitDisabledReason?: string;
  /** 可用时 title 里的方向说明（如「左右拆分」）。 */
  splitHint?: string;
  /**
   * ⋯ →「向右拆分 / 向下拆分」：显式指定方向（↔ 桌面端可产出 column 的唯一入口）。
   * 窄屏（<768px）传 `['column']`，只保留「向下拆分」。
   */
  splitMenuDirections?: readonly TerminalSplitDirection[];
  /** ⋯ 方向拆分回调；缺省时这两项按「未接入」禁用。 */
  onRequestSplitWithDirection?: (direction: TerminalSplitDirection) => void;
  /** ⋯ →「合并到分屏」：把其他 tab 并入本组。 */
  onRequestMerge?: () => void;
  /** 存在即禁用「合并到分屏」，文案即原因。 */
  mergeDisabledReason?: string;
}

export function TerminalTabActions({
  activeTerminal,
  terminalCount,
  totalTerminalCount,
  canCreate,
  creating,
  onRequestCreate,
  onRequestRename,
  onRequestClear,
  onRequestCloseOthers,
  onRequestCloseAll,
  onRequestSplit,
  splitDisabledReason,
  splitHint,
  splitMenuDirections = DEFAULT_SPLIT_MENU_DIRECTIONS,
  onRequestSplitWithDirection,
  onRequestMerge,
  mergeDisabledReason,
}: TerminalTabActionsProps) {
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null);

  // 清屏走既有 stdin 能力（`\x0c` = Ctrl+L，仓库定义为 shell 清屏语义），
  // 只有可交互的持久终端才接受 stdin，其余状态下禁用该项。
  const canClear =
    activeTerminal !== null &&
    activeTerminal.kind === 'foreground' &&
    WRITABLE_STATUSES.has(activeTerminal.status);

  const splitDisabled = onRequestSplit === undefined || splitDisabledReason !== undefined;
  const splitTitle = splitDisabled
    ? (splitDisabledReason ?? '分屏未接入')
    : `拆分当前组（${splitHint ?? '左右拆分'}，新建终端）`;
  const mergeDisabled = onRequestMerge === undefined || mergeDisabledReason !== undefined;
  const mergeTitle = mergeDisabled
    ? (mergeDisabledReason ?? '合并未接入')
    : '把其他终端 tab 合并进当前组';

  const directionItems: TerminalContextMenuItem[] = splitMenuDirections.map((direction, index) => {
    const disabled = onRequestSplitWithDirection === undefined || splitDisabledReason !== undefined;
    const title = disabled
      ? (splitDisabledReason ?? '分屏未接入')
      : `拆分当前组（${SPLIT_DIRECTION_HINTS[direction]}，新建终端）`;
    return {
      id: `split-${direction}`,
      label: SPLIT_DIRECTION_LABELS[direction],
      separatorBefore: index === 0,
      title,
      disabled,
      onSelect: () => onRequestSplitWithDirection?.(direction),
    };
  });

  const items: TerminalContextMenuItem[] = [
    {
      id: 'rename',
      label: '重命名',
      title: '重命名当前终端',
      disabled: activeTerminal === null,
      onSelect: onRequestRename,
    },
    {
      id: 'clear',
      label: '清屏',
      hint: 'Ctrl+L',
      title: '请求 shell 清屏（等价 Ctrl+L）',
      disabled: !canClear,
      onSelect: onRequestClear,
    },
    ...directionItems,
    {
      id: 'merge-split',
      label: '合并到分屏',
      title: mergeTitle,
      disabled: mergeDisabled,
      onSelect: onRequestMerge ?? (() => undefined),
    },
    {
      id: 'close-others',
      label: '关闭其他终端',
      separatorBefore: true,
      disabled: terminalCount <= 1,
      onSelect: onRequestCloseOthers,
    },
    {
      id: 'close-all',
      label: '关闭全部终端',
      disabled: (totalTerminalCount ?? terminalCount) === 0,
      onSelect: onRequestCloseAll,
    },
  ];

  return (
    <>
      <button
        type="button"
        className="terminal-panel__icon-btn"
        aria-label="新建终端"
        title="新建终端"
        disabled={!canCreate || creating}
        data-busy={creating ? 'true' : 'false'}
        data-testid="terminal-tab-actions-create"
        onClick={onRequestCreate}
      >
        <PlusIcon size={14} />
      </button>
      <button
        type="button"
        className="terminal-panel__icon-btn"
        aria-label="拆分终端"
        title={splitTitle}
        disabled={splitDisabled}
        data-testid="terminal-tab-actions-split"
        onClick={onRequestSplit}
      >
        <SplitIcon size={14} />
      </button>
      <button
        type="button"
        className="terminal-panel__icon-btn"
        aria-label="更多终端操作"
        title="更多终端操作"
        aria-haspopup="menu"
        aria-expanded={menuPosition !== null}
        data-open={menuPosition !== null ? 'true' : 'false'}
        data-testid="terminal-tab-actions-more"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setMenuPosition({ x: rect.left, y: rect.bottom + 4 });
        }}
      >
        <MoreIcon size={14} />
      </button>
      {menuPosition ? (
        <TerminalContextMenu
          x={menuPosition.x}
          y={menuPosition.y}
          items={items}
          onClose={() => setMenuPosition(null)}
        />
      ) : null}
    </>
  );
}
