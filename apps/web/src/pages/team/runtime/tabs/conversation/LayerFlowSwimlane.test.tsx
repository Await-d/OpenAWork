// @vitest-environment jsdom
/**
 * 260916-层级可视化重构 · 泳道轨迹画布 smoke 测试
 *
 * 覆盖：泳道标签全量渲染、节点与连线绘制、点击回调、聚焦淡化、空态文案区分。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type {
  HandoffEntry,
  LayerNode,
  TeamRoleLayer,
} from '../../../../../stores/team/team-events.js';
import { LayerFlowSwimlane } from './LayerFlowSwimlane.js';
import { buildLayerSwimlaneModel, type SwimlaneModel } from './layer-flow-swimlane-model.js';

function makeHandoff(overrides: Partial<HandoffEntry> & { id: string }): HandoffEntry {
  return {
    fromRoleLayer: 'reception',
    state: 'completed',
    toRoleLayer: 'pm1',
    updatedAt: 1_000,
    ...overrides,
  };
}

function buildModel(handoffs: HandoffEntry[], nodes: LayerNode[] = []): SwimlaneModel {
  return buildLayerSwimlaneModel({
    densityMode: 'all',
    handoffs,
    nodes,
    selectedHandoffId: null,
  });
}

function renderSwimlane(
  model: SwimlaneModel,
  options: {
    onSelectHandoff?: (handoffId: string) => void;
    onSelectLane?: (layer: TeamRoleLayer) => void;
    selectedHandoffId?: string | null;
    totalHandoffCount?: number;
  } = {},
) {
  return render(
    <LayerFlowSwimlane
      availableHeight={800}
      model={model}
      onSelectHandoff={options.onSelectHandoff ?? (() => undefined)}
      onSelectLane={options.onSelectLane ?? (() => undefined)}
      selectedHandoffId={options.selectedHandoffId ?? null}
      totalHandoffCount={options.totalHandoffCount ?? model.nodes.length}
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('LayerFlowSwimlane', () => {
  it('渲染全部泳道标签与轨迹节点，点击节点回调 handoffId', () => {
    const onSelectHandoff = vi.fn();
    const model = buildModel([
      makeHandoff({ id: 'h1', summary: '接待派发规划', updatedAt: 1_000 }),
      makeHandoff({
        fromRoleLayer: 'reviewer',
        id: 'h2',
        state: 'running',
        summary: '评审打回执行',
        toRoleLayer: 'executor',
        updatedAt: 2_000,
      }),
    ]);

    const { container } = renderSwimlane(model, { onSelectHandoff });

    expect(screen.getByText('接待层')).toBeTruthy();
    expect(screen.getByText('PM1 规划层')).toBeTruthy();
    expect(screen.getByText('执行层')).toBeTruthy();
    expect(container.querySelectorAll('.team-conv-swimlane__link')).toHaveLength(2);

    const node = container.querySelector('[data-swimlane-handoff="h2"]');
    expect(node).toBeTruthy();
    fireEvent.click(node as HTMLElement);
    expect(onSelectHandoff).toHaveBeenCalledWith('h2');
    expect(node?.getAttribute('data-active')).toBe('true');
  });

  it('点击有会话的泳道标签回调层级；无会话泳道不可点', () => {
    const onSelectLane = vi.fn();
    const model = buildModel(
      [makeHandoff({ id: 'h1' })],
      [
        {
          parentSessionId: null,
          roleLayer: 'pm1',
          sessionId: 'sess-pm1',
          state: 'completed',
        },
      ],
    );

    renderSwimlane(model, { onSelectLane });

    fireEvent.click(screen.getByText('PM1 规划层'));
    expect(onSelectLane).toHaveBeenCalledWith('pm1');

    const reviewerLabel = screen.getByText('评审层').closest('button');
    expect(reviewerLabel?.disabled).toBe(true);
  });

  it('无交接时显示空提示；有交接但被密度筛掉时显示筛选提示', () => {
    const { unmount } = renderSwimlane(buildModel([]), { totalHandoffCount: 0 });
    expect(screen.getByText('当前会话树内还没有跨层交接')).toBeTruthy();
    unmount();

    renderSwimlane(buildModel([]), { totalHandoffCount: 3 });
    expect(screen.getByText('当前筛选下没有可显示的交接')).toBeTruthy();
    expect(screen.getByText(/共 3 条交接被「活跃」密度过滤/)).toBeTruthy();
  });

  it('tester 层的交接落在评审泳道而不是被丢弃', () => {
    const model = buildModel([
      makeHandoff({ id: 'to-tester', toRoleLayer: 'tester', updatedAt: 1_000 }),
    ]);

    const { container } = renderSwimlane(model);

    const node = container.querySelector('[data-swimlane-handoff="to-tester"]');
    expect(node).toBeTruthy();
    expect(node?.getAttribute('data-layer')).toBe('tester');
  });

  it('选中交接后沿链聚焦：链外节点与连线淡化，链上保持', () => {
    const model = buildModel([
      makeHandoff({
        fromSessionId: 'S0',
        id: 'chain-1',
        summary: '接待派发规划',
        toSessionId: 'S1',
        updatedAt: 1_000,
      }),
      makeHandoff({
        fromRoleLayer: 'pm1',
        fromSessionId: 'S1',
        id: 'chain-2',
        toRoleLayer: 'pm2',
        toSessionId: 'S2',
        updatedAt: 2_000,
      }),
      makeHandoff({
        fromSessionId: 'X0',
        id: 'other-1',
        summary: '另一条链',
        toSessionId: 'X1',
        updatedAt: 3_000,
      }),
    ]);

    const { container } = renderSwimlane(model, { selectedHandoffId: 'chain-1' });

    expect(
      container.querySelector('[data-swimlane-handoff="chain-2"]')?.getAttribute('data-dim'),
    ).toBe('false');
    expect(
      container.querySelector('[data-swimlane-handoff="other-1"]')?.getAttribute('data-dim'),
    ).toBe('true');

    const dimmedLinks = container.querySelectorAll('.team-conv-swimlane__link[data-dim="true"]');
    expect(dimmedLinks).toHaveLength(1);
  });
});
