/**
 * 终端菜单的纯构建层：方向拆分项的共用构造 + 内容区右键菜单的命令段。
 *
 * 为什么单独成模块：方向拆分项要同时出现在 ⋯ 菜单（`TerminalTabActions`）与终端
 * 内容区右键菜单两处，「上限 / 空组 / 未就绪」这类禁用措辞只能有一份来源，
 * 否则同一拒绝原因迟早漂移成两种说法。
 *
 * 本模块无 React 依赖、不持有状态：调用方（pane / tab 条）负责把动作回调传进来。
 */

import type { TerminalSplitDirection } from './layout/types.js';
import type { TerminalContextMenuItem } from './TerminalContextMenu.js';

/** 方向拆分的菜单文案：row = 左右并排（向右），column = 上下堆叠（向下）。 */
export const SPLIT_DIRECTION_LABELS: Record<TerminalSplitDirection, string> = {
  row: '向右拆分',
  column: '向下拆分',
};

export const SPLIT_DIRECTION_HINTS: Record<TerminalSplitDirection, string> = {
  row: '左右',
  column: '上下',
};

export interface SplitDirectionItemsOptions {
  /** 方向拆分回调；缺省时这些项按「未接入」禁用（该回退只服务 ⋯ 菜单）。 */
  onRequestSplitWithDirection?: (direction: TerminalSplitDirection) => void;
  /** 存在即禁用，本值即原因（pane 上限 / 空组 / 会话未就绪，由调用方按既有优先级算好）。 */
  splitDisabledReason?: string;
  /**
   * id 前缀。两个菜单由不同组件渲染（`data-testid` 也是 `terminal-context-menu-${id}`），
   * 内容区菜单用 `terminal-` 与 ⋯ 菜单的 `split-` 区分开，测试与调试才有稳定的定位锚点。
   */
  idPrefix?: string;
}

/**
 * 方向拆分项，与 ⋯ 菜单既有构造逐字对应：
 * 首项带分隔线（把方向项与上方条目分组）、`split-${direction}` 缺省 id、
 * 「reason 存在即禁用，title 即 reason；未接入则回退未接入」。
 */
export function buildSplitDirectionItems(
  directions: readonly TerminalSplitDirection[],
  options: SplitDirectionItemsOptions,
): TerminalContextMenuItem[] {
  const { onRequestSplitWithDirection, splitDisabledReason, idPrefix = '' } = options;
  return directions.map((direction, index) => {
    const disabled = onRequestSplitWithDirection === undefined || splitDisabledReason !== undefined;
    const title = disabled
      ? (splitDisabledReason ?? '分屏未接入')
      : `拆分当前组（${SPLIT_DIRECTION_HINTS[direction]}，新建终端）`;
    return {
      id: `${idPrefix}split-${direction}`,
      label: SPLIT_DIRECTION_LABELS[direction],
      separatorBefore: index === 0,
      title,
      disabled,
      onSelect: () => onRequestSplitWithDirection?.(direction),
    };
  });
}

/** 空组的统一措辞：与 `TerminalPane` 既有 splitDisabledReason 完全同一字面量。 */
const NO_TERMINAL_REASON = '当前组没有终端，先新建一个';
/** 会话未就绪的既有措辞（同上，与 `TerminalPane` 保持一致）。 */
const SESSION_NOT_READY_REASON = '会话未就绪，无法新建终端';

/**
 * 缺省动作目标 = 内容区菜单（phase 1）的既有口径：本组当前活动终端。
 *
 * `long` 进「终止 / 重命名」，`short` 进「关闭其他」的从句 —— 后者处在介词结构里，
 * 需要更短的词，因此两个槽位分开而不是同一份文案。默认值必须让三个 title
 * 与既有字面量逐字一致，内容区菜单才不会因为引入描述符而改文案。
 */
const DEFAULT_ACTION_TARGET: { long: string; short: string } = {
  long: '当前组的活动终端',
  short: '活动终端',
};

export interface TerminalCommandItemsInput {
  /** 本组终端数：「终止 / 重命名 / 关闭其他」的判据（0 = 空组）。 */
  terminalCount: number;
  /** 面板内全部终端数：「关闭全部」的判据（0 = 没有任何可关闭的终端）。 */
  totalTerminalCount: number;
  /** 会话与 token 就绪；未就绪时创建 / 拆分都不该放行。 */
  sessionReady: boolean;
  /**
   * 面板内任意 pane 正在创建 / 拆分（`busyPaneId !== null`）。
   * 创建动作有并发重入保护，此时必须禁用「新建终端」而不是让点击静默落空。
   */
  creating: boolean;
  /** 已按既有优先级（上限 > 空组 > 未就绪）算好的拆分拒绝原因；存在即禁用两项拆分。 */
  splitDisabledReason?: string;
  /** 允许的方向：窄屏（<768px）只保留 column。 */
  splitDirections: readonly TerminalSplitDirection[];
  /**
   * 动作目标描述符（可选）：`long` 进 终止 / 重命名 的 title，`short` 进 关闭其他 的 title。
   *
   * 为什么由调用方传描述而不是再写一个 builder：内容区菜单针对「本组活动终端」，
   * tab 右键菜单针对「被点击的那个 tab」，两者项集、顺序、分隔线与措辞模板完全同一套，
   * 只有目标词不同。拆成两个 builder 必然出现「一侧改了标题、另一侧忘了同步」的漂移；
   * 同一模板 + 调用方描述符才能保证两个菜单说同一套话。缺省即内容区菜单既有口径。
   */
  target?: { long: string; short: string };
  onRequestCreate: () => void;
  onRequestSplit: (direction: TerminalSplitDirection) => void;
  onRequestKill: () => void;
  onRequestRename: () => void;
  onRequestCloseOthers: () => void;
  onRequestCloseAll: () => void;
}

/**
 * 内容区右键菜单的命令段（剪贴板段之前在 `useTerminalSession` 里拼接）。
 *
 * 顺序对齐 VS Code 终端右键菜单：新建 → 拆分方向 → 终止 → 重命名 → 关闭类。
 * 禁用项一律带 `title`：菜单项没有二次解释的机会，禁用却不说原因等于让用户猜。
 */
export function buildTerminalCommandItems(
  input: TerminalCommandItemsInput,
): TerminalContextMenuItem[] {
  const hasTerminals = input.terminalCount > 0;
  const target = input.target ?? DEFAULT_ACTION_TARGET;

  return [
    {
      id: 'terminal-new',
      label: '新建终端',
      title: !input.sessionReady
        ? SESSION_NOT_READY_REASON
        : input.creating
          ? '正在创建终端，请稍候'
          : '在当前组新建一个终端',
      disabled: !input.sessionReady || input.creating,
      onSelect: input.onRequestCreate,
    },
    ...buildSplitDirectionItems(input.splitDirections, {
      idPrefix: 'terminal-',
      onRequestSplitWithDirection: input.onRequestSplit,
      splitDisabledReason: input.splitDisabledReason,
    }),
    {
      id: 'terminal-kill',
      label: '终止终端',
      title: hasTerminals ? `终止${target.long}` : NO_TERMINAL_REASON,
      disabled: !hasTerminals,
      onSelect: input.onRequestKill,
    },
    {
      id: 'terminal-rename',
      label: '重命名',
      title: hasTerminals ? `重命名${target.long}` : NO_TERMINAL_REASON,
      disabled: !hasTerminals,
      onSelect: input.onRequestRename,
    },
    {
      id: 'terminal-close-others',
      label: '关闭其他终端',
      // 与「关闭全部」同组：上方是单终端动作，从这里开始是对整组的批量关闭。
      separatorBefore: true,
      title: !hasTerminals
        ? NO_TERMINAL_REASON
        : input.terminalCount > 1
          ? `关闭当前组内除${target.short}外的终端`
          : '当前组只有一个终端，没有其他终端可关闭',
      disabled: input.terminalCount <= 1,
      onSelect: input.onRequestCloseOthers,
    },
    {
      id: 'terminal-close-all',
      label: '关闭全部终端',
      title: input.totalTerminalCount > 0 ? '关闭面板内全部终端' : NO_TERMINAL_REASON,
      disabled: input.totalTerminalCount === 0,
      onSelect: input.onRequestCloseAll,
    },
  ];
}
