/**
 * TerminalSplitView — 分屏布局树的递归渲染器（T-10）+ 分隔条拖拽（T-11）。
 *
 * 结构（信息架构冻结）：
 *  - `pane` 节点 → 一个 `TerminalPane`（自带 tab 条 + active 终端），`key={node.id}` 稳定；
 *  - `split` 节点 → 按 `direction` 用 flex 排布（row = 左右，column = 上下）+ 分隔条，
 *    `key={node.id}`；分隔条带 `data-split-id` / `data-direction`；
 *  - `layout === null` → 单个**隐式 pane**（paneId = `IMPLICIT_PANE_ID`），视觉与
 *    升级前一致：一条 tab 条 + 一个终端。
 *
 * 派生规则（D2）：树只描述排布，不决定终端是否存在。不在任何 pane 里的存活终端
 * （例如 agent 在布局存在之后新起的终端）作为 **tab** 托管给 DFS 首个 pane；
 * 托管位置固定，不随焦点漂移，避免 tab 在 pane 之间跳来跳去。
 *
 * 分隔条拖拽（T-11）的三条纪律：
 *  1. 命中换算走 T-08 的 `resolveRatioFromPointer`（DOM-free），本文件只提供几何；
 *  2. 拖拽期间 ratio 只落在 `SplitNodeView` 的**本地瞬态 state** —— 每帧落盘会让
 *     布局树每帧重建（并连带重渲染所有 pane），松手才一次性提交给 T-09 的 `setRatio`；
 *  3. 拖拽只改 `flex-basis`（CSS 布局），`TerminalPane` 与 `InteractiveTerminalView`
 *     的 key 都不变 —— xterm 实例与 SSE 流在拖拽中不发生任何重建。
 */

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import type { SessionTerminalView } from '../../conversation-runtime/terminals/terminals-api.js';
import { resolveRatioFromPointer, type Rect } from './layout/drop-target.js';
import { clampRatio } from './layout/normalize.js';
import { enumeratePanes, layoutTerminalIds } from './layout/queries.js';
import {
  MAX_RATIO,
  MIN_RATIO,
  type TerminalLayout,
  type TerminalLayoutNode,
  type TerminalPaneNode,
  type TerminalSplitNode,
} from './layout/types.js';
import { TerminalPane } from './TerminalPane.js';
import { useTerminalLayoutContext } from './TerminalLayoutContext.js';

/** 无分屏时渲染的隐式 pane id；从隐式 pane 拆分时它会被物化进树，id 保持不变。 */
export const IMPLICIT_PANE_ID = 'pane-implicit';

/** 键盘调整分隔比例的固定步长（2% / 次）。 */
const KEYBOARD_RATIO_STEP = 0.02;

export interface TerminalSplitViewProps {
  layout: TerminalLayout;
  /** 面板内可见（运行中）终端全集；顺序即 tab 顺序来源。 */
  terminals: readonly SessionTerminalView[];
  /** 隐式 pane 的 active 终端（layout === null 时由 workspace 持久化的选择决定）。 */
  implicitActiveTerminalId: string | null;
}

export function TerminalSplitView({
  layout,
  terminals,
  implicitActiveTerminalId,
}: TerminalSplitViewProps) {
  if (layout === null) {
    return (
      <TerminalPane
        key={IMPLICIT_PANE_ID}
        paneId={IMPLICIT_PANE_ID}
        terminals={terminals}
        activeTerminalId={implicitActiveTerminalId}
      />
    );
  }

  const byId = new Map(terminals.map((terminal) => [terminal.terminalId, terminal]));
  const inTree = layoutTerminalIds(layout);
  const orphanIds = terminals
    .filter((terminal) => !inTree.has(terminal.terminalId))
    .map((terminal) => terminal.terminalId);
  const hostPaneId = enumeratePanes(layout)[0]?.id ?? null;

  const resolveTerminals = (pane: TerminalPaneNode): SessionTerminalView[] => {
    const ids = pane.id === hostPaneId ? [...pane.terminalIds, ...orphanIds] : pane.terminalIds;
    const resolved: SessionTerminalView[] = [];
    for (const id of ids) {
      const terminal = byId.get(id);
      if (terminal) resolved.push(terminal);
    }
    return resolved;
  };

  const renderNode = (node: TerminalLayoutNode): ReactNode => {
    if (node.kind === 'pane') {
      return (
        <TerminalPane
          key={node.id}
          paneId={node.id}
          terminals={resolveTerminals(node)}
          activeTerminalId={node.activeTerminalId}
        />
      );
    }
    const [first, second] = node.children;
    return (
      <SplitNodeView
        key={node.id}
        split={node}
        first={renderNode(first)}
        second={renderNode(second)}
      />
    );
  };

  return <>{renderNode(layout)}</>;
}

interface SplitNodeViewProps {
  split: TerminalSplitNode;
  /**
   * 已渲染好的两个子树。
   *
   * 以 props 形式传入（而不是在这里递归）是有意的：拖拽期间的 ratio 变化只让
   * `SplitNodeView` 自己重渲染，`first` / `second` 的元素引用不变 → React 直接跳过
   * 整棵子树，xterm 实例与 SSE 流因此绝无重建可能。
   */
  first: ReactNode;
  second: ReactNode;
}

function SplitNodeView({ split, first, second }: SplitNodeViewProps) {
  const { actions } = useTerminalLayoutContext();
  const containerRef = useRef<HTMLDivElement | null>(null);
  // 拖拽期间的瞬态比例；null = 未拖拽（用树里的持久 ratio）。
  const [dragRatio, setDragRatio] = useState<number | null>(null);
  const dragging = dragRatio !== null;
  const ratio = dragRatio ?? split.ratio;
  const horizontal = split.direction === 'row';

  // 拖拽中指针可能跑出窗口：pointer capture 保证事件持续回传，同时锁住光标与文本选择，
  // 否则拖过 pane 边界会触发文本选中，视觉上像在拖选而不是拖分隔条。
  useEffect(() => {
    if (!dragging) return;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = horizontal ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
  }, [dragging, horizontal]);

  const readBox = (): Rect | null => {
    const box = containerRef.current?.getBoundingClientRect();
    if (!box) return null;
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    event.preventDefault();
    // 捕获挂在分隔条上：指针离开命中区（甚至离开窗口）后 pointermove 仍回传到这里。
    event.currentTarget.setPointerCapture(event.pointerId);
    const box = readBox();
    if (!box) return;
    setDragRatio(
      resolveRatioFromPointer(
        box,
        split.direction,
        { x: event.clientX, y: event.clientY },
        MIN_RATIO,
      ),
    );
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (dragRatio === null) return;
    const box = readBox();
    if (!box) return;
    setDragRatio(
      resolveRatioFromPointer(
        box,
        split.direction,
        { x: event.clientX, y: event.clientY },
        MIN_RATIO,
      ),
    );
  };

  /** pointerup / pointercancel 的统一收口：**唯一**一次落盘发生在这里（拖拽中不落盘）。 */
  const stopDrag = (event: PointerEvent<HTMLDivElement>): void => {
    if (dragRatio === null) return;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // 指针捕获可能已被浏览器（或 jsdom 替身）释放，忽略。
    }
    setDragRatio(null);
    actions.setRatio(split.id, dragRatio);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const current = dragRatio ?? split.ratio;
    let next: number | null = null;
    if (event.key === (horizontal ? 'ArrowLeft' : 'ArrowUp')) {
      next = current - KEYBOARD_RATIO_STEP;
    } else if (event.key === (horizontal ? 'ArrowRight' : 'ArrowDown')) {
      next = current + KEYBOARD_RATIO_STEP;
    } else if (event.key === 'Home') {
      next = MIN_RATIO;
    } else if (event.key === 'End') {
      next = MAX_RATIO;
    }
    if (next === null) return;
    event.preventDefault();
    // 键盘是离散操作：没有「拖拽中」的中间态，直接落盘一次。
    setDragRatio(null);
    actions.setRatio(split.id, clampRatio(next));
  };

  return (
    <div
      ref={containerRef}
      className="terminal-split"
      data-direction={split.direction}
      data-split-id={split.id}
      data-dragging={dragging ? 'true' : 'false'}
      data-testid={`terminal-split-${split.id}`}
    >
      <div className="terminal-split__child" style={{ flexBasis: `${ratio * 100}%` }}>
        {first}
      </div>
      <div
        className="terminal-split__divider"
        role="separator"
        aria-label="调整分屏比例"
        aria-orientation={horizontal ? 'vertical' : 'horizontal'}
        aria-valuemin={Math.round(MIN_RATIO * 100)}
        aria-valuemax={Math.round(MAX_RATIO * 100)}
        aria-valuenow={Math.round(ratio * 100)}
        tabIndex={0}
        data-split-id={split.id}
        data-direction={split.direction}
        data-split-ratio={ratio}
        data-dragging={dragging ? 'true' : 'false'}
        title="拖拽调整分屏比例（←/→ 或 ↑/↓ 微调，Home/End 到边界）"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={stopDrag}
        onPointerCancel={stopDrag}
        onKeyDown={handleKeyDown}
      />
      <div className="terminal-split__child terminal-split__child--grow">{second}</div>
    </div>
  );
}
