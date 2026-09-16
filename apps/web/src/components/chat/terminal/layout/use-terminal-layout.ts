/**
 * `useTerminalLayout` —— 终端分屏布局的持久化 hook。
 *
 * 两条铁律（来自 workflow 的「⚠️ 最危险的交互」）：
 *
 * 1. **归一化只在渲染路径发生，且只在存活终端集合可信时用真实集合。**
 *    `normalizeLayout` 的 `null` 语义是「调用方还不知道有哪些终端 → 原样返回」。
 *    切会话瞬间上游 terminals 还是空快照，此时若把空集合传进去，会判定「终端都没了」
 *    并清空布局 —— 所以 `liveIdsTrusted` 为 false（或集合为 null）时**必须传 null**。
 * 2. **持久化只有一条路径：用户主动操作。** hook 内没有任何「归一化后自动落盘」的
 *    effect —— 那正是「每次切会话永久销毁用户布局」的唯一成因。渲染路径只读不写。
 */

import { terminalPanelSessionKeyFor, useUIStateStore } from '../../../../stores/ui/uiState.js';
import {
  insertTerminalIntoPane,
  moveTerminal as applyMoveTerminal,
  removePane as applyRemovePane,
  removeTerminal as applyRemoveTerminal,
  setPaneActiveTerminal,
  setSplitRatio,
  splitPane as applySplitPane,
} from './mutations.js';
import { normalizeLayout } from './normalize.js';
import type { TerminalDropTarget, TerminalLayout, TerminalSplitDirection } from './types.js';

export interface UseTerminalLayoutOptions {
  /** 当前会话的终端 id 集合；**未知时传 null**（见「最危险的交互」） */
  liveTerminalIds: ReadonlySet<string> | null;
  /** 「上游终端集合是否可信完整」——由调用方按 `!loading && lastSyncedAtMs !== null` 决定 */
  liveIdsTrusted: boolean;
  /** 分屏上限，默认 MAX_PANES(4)。 */
  maxPanes?: number;
}

export interface UseTerminalLayoutResult {
  /** 归一后的布局（渲染用，只读）；null = 无分屏（单组隐式 pane） */
  layout: TerminalLayout | null;
  /** 当前会话桶键（= terminalPanelSessionKeyFor(lastChatPath)） */
  sessionKey: string;
  /** 以下都是**用户主动操作**入口：内部先归一化再落盘（唯一允许持久化的路径） */
  splitPane(
    paneId: string,
    direction: TerminalSplitDirection,
    newPaneId: string,
    seedTerminalId?: string,
  ): void;
  removePane(paneId: string): void;
  removeTerminal(terminalId: string): void;
  moveTerminal(terminalId: string, target: TerminalDropTarget, newPaneId: string): void;
  insertTerminal(paneId: string, terminalId: string, index?: number): void;
  setActiveTerminal(paneId: string, terminalId: string): void;
  setRatio(splitId: string, ratio: number): void;
  /** 一键清空当前会话布局（调试 / 用户「重置布局」） */
  resetLayout(): void;
}

/**
 * 落盘前归一化用的存活集合。
 *
 * 用户操作可能引入**上游尚未同步**的终端（split 的种子 / insert 的终端），若直接拿
 * 上游集合归一，会把它当死终端立刻摘掉 —— 刚拆出来的 pane 下一次渲染就没了（红色用例
 * 就是这个 bug）。所以把这些显式引入的 id 补进集合；`liveIds === null`（未可信）时
 * 仍返回 null，与渲染路径共用同一条「原样返回」防线。
 */
function withIntroducedLiveIds(
  liveIds: ReadonlySet<string> | null,
  introduced: readonly (string | undefined)[],
): ReadonlySet<string> | null {
  if (liveIds === null) return null;
  const extra = introduced.filter((id): id is string => typeof id === 'string');
  if (extra.length === 0) return liveIds;
  return new Set([...liveIds, ...extra]);
}

export function useTerminalLayout(options: UseTerminalLayoutOptions): UseTerminalLayoutResult {
  const { liveTerminalIds, liveIdsTrusted, maxPanes } = options;

  const lastChatPath = useUIStateStore((state) => state.lastChatPath);
  const sessionKey = terminalPanelSessionKeyFor(lastChatPath);
  const storedLayout = useUIStateStore(
    (state) => state.terminalLayoutBySession[sessionKey] ?? null,
  );
  const setTerminalLayoutForSession = useUIStateStore((state) => state.setTerminalLayoutForSession);

  // 未可信时传 null（= 「还不知道有哪些终端」→ 原样返回），可信时才传真实集合。
  // 绝不能退化成空集合：那会让 normalizeLayout 判定「终端都没了」并清空布局。
  const liveIds: ReadonlySet<string> | null = liveIdsTrusted ? liveTerminalIds : null;

  const layout = normalizeLayout(storedLayout, liveIds, { maxPanes });

  const commit = (next: TerminalLayout, introduced: readonly (string | undefined)[] = []): void => {
    setTerminalLayoutForSession(
      sessionKey,
      normalizeLayout(next, withIntroducedLiveIds(liveIds, introduced), { maxPanes }),
    );
  };

  return {
    layout,
    sessionKey,
    splitPane: (paneId, direction, newPaneId, seedTerminalId) => {
      const next = applySplitPane(layout, paneId, direction, newPaneId, {
        maxPanes,
        seedTerminalId,
      });
      if (next !== layout) commit(next, [seedTerminalId]);
    },
    removePane: (paneId) => {
      const next = applyRemovePane(layout, paneId);
      if (next !== layout) commit(next);
    },
    removeTerminal: (terminalId) => {
      const next = applyRemoveTerminal(layout, terminalId);
      if (next !== layout) commit(next);
    },
    moveTerminal: (terminalId, target, newPaneId) => {
      const next = applyMoveTerminal(layout, terminalId, target, { newPaneId, maxPanes });
      if (next !== layout) commit(next, [terminalId]);
    },
    insertTerminal: (paneId, terminalId, index) => {
      const next = insertTerminalIntoPane(layout, paneId, terminalId, index);
      if (next !== layout) commit(next, [terminalId]);
    },
    setActiveTerminal: (paneId, terminalId) => {
      const next = setPaneActiveTerminal(layout, paneId, terminalId);
      if (next !== layout) commit(next);
    },
    setRatio: (splitId, ratio) => {
      const next = setSplitRatio(layout, splitId, ratio);
      if (next !== layout) commit(next);
    },
    resetLayout: () => {
      // 清空是用户主动操作，属于允许持久化的路径。
      setTerminalLayoutForSession(sessionKey, null);
    },
  };
}
