/**
 * 知识图谱 · 拖拽弹性跟随控制器（非 React）。
 *
 * 拖拽节点时，以 `requestAnimationFrame` 合并高频 pointer move：读出当前实时坐标，
 * 把被拖节点当**固定约束**对有界邻域做一次短的力模拟 reheating，再把邻居批量平移到新位置
 * （G6 `translateElementTo`）。每帧只重解邻域（图距离 ≤ 2 跳）且有固定迭代上限，
 * 因此不存在旧渲染器那种无界 rAF 物理循环；松手后位置由 pin 持久化，布局重新 settle。
 */

import type { Graph, Point } from '@antv/g6';
import type { GraphViewportSize } from './knowledge-graph-layout.js';
import type { GraphModel } from './knowledge-graph-model.js';
import type { GraphPinMap } from './knowledge-graph-pins.js';
import { computeReheatedPositions } from './knowledge-graph-runtime.js';

export interface DragFollowDeps {
  readonly graph: Graph;
  readonly getModel: () => GraphModel | null;
  readonly getPins: () => GraphPinMap;
  readonly getViewport: () => GraphViewportSize | null;
  readonly reducedMotion: boolean;
}

export interface DragFollowController {
  /** 记录当前被拖拽节点并调度一帧跟随（同一帧内多次调用只会排一帧）。 */
  move(nodeId: string): void;
  /** 结束本次拖拽并取消未执行帧。 */
  stop(): void;
  dispose(): void;
}

/** 小于该位移不触发平移，避免无意义的重绘与动画。 */
const MOVE_EPSILON = 0.5;

function toCoordinates(position: Point): { x: number; y: number } {
  return { x: Number(position[0] ?? 0), y: Number(position[1] ?? 0) };
}

export function createDragFollow(deps: DragFollowDeps): DragFollowController {
  let frame = 0;
  let draggedId: string | null = null;
  let disposed = false;

  const stop = (): void => {
    draggedId = null;
    if (frame !== 0) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
  };

  const runFrame = (): void => {
    frame = 0;
    const { graph } = deps;
    const viewport = deps.getViewport();
    const model = deps.getModel();
    const activeId = draggedId;
    if (disposed || graph.destroyed || !activeId || !viewport || !model) {
      return;
    }
    if (viewport.width <= 0 || viewport.height <= 0) {
      return;
    }

    const positions = new Map<string, { x: number; y: number }>();
    for (const node of model.nodes) {
      positions.set(node.id, toCoordinates(graph.getElementPosition(node.id)));
    }

    const moved = computeReheatedPositions({
      model,
      viewport,
      pins: deps.getPins(),
      positions,
      dragId: activeId,
    });

    const moves: Record<string, Point> = {};
    let moveCount = 0;
    for (const [id, target] of moved) {
      const current = positions.get(id);
      if (current && Math.hypot(target.x - current.x, target.y - current.y) < MOVE_EPSILON) {
        continue;
      }
      moves[id] = [target.x, target.y];
      moveCount += 1;
    }
    if (moveCount > 0) {
      // 逐帧直接写坐标，不叠加补间：rAF 本身就是 60fps 的平滑来源，而每帧再起一段
      // 140ms 动画会让同一元素上堆积上百段并行动画（软件 WebGL 直接崩标签页）。
      // 释放后的重排由 G6 主题的 update 动画负责缓入。
      void graph.translateElementTo(moves, false);
    }
  };

  const move = (nodeId: string): void => {
    if (disposed) {
      return;
    }
    draggedId = nodeId;
    if (frame !== 0) {
      return;
    }
    frame = requestAnimationFrame(runFrame);
  };

  return {
    move,
    stop,
    dispose: () => {
      disposed = true;
      stop();
    },
  };
}
