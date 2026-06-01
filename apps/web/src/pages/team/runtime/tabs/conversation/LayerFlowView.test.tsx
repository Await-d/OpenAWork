// @vitest-environment jsdom
/**
 * LayerFlowView smoke：
 *   - 无数据 → 空态
 *   - 有 handoff → 流水线 5 层节点 + 时间线行渲染；点击有 session 的层级节点 → 右侧
 *     渲染对应 TeamConversationView；点击时间线行 → 同样打开会话 + 详情头。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  useHandoffStore,
  useLayerStore,
  type HandoffEntry,
  type LayerNode,
} from '../../../../../stores/team/team-events.js';

vi.mock('../../../conversation/TeamConversationView.js', () => ({
  TeamConversationView: ({ sessionId }: { sessionId: string }) => (
    <div data-testid="team-session-view-mock" data-session-id={sessionId} />
  ),
}));

import { LayerFlowView } from './LayerFlowView.js';

function seedHandoff(entry: HandoffEntry) {
  useHandoffStore.setState({ handoffs: new Map([[entry.id, entry]]) });
}

function seedNodes(nodes: LayerNode[]) {
  useLayerStore.setState({ nodes: new Map(nodes.map((n) => [n.sessionId, n])) });
}

beforeEach(() => {
  useHandoffStore.getState().clear();
  useLayerStore.getState().clear();
});

afterEach(() => {
  cleanup();
  useHandoffStore.getState().clear();
  useLayerStore.getState().clear();
  vi.restoreAllMocks();
});

describe('LayerFlowView', () => {
  it('无数据时显示空态', () => {
    render(<LayerFlowView />);
    expect(screen.getByText('还没有跨层流动')).toBeTruthy();
  });

  it('有 handoff 时渲染 5 层流水线节点与默认右侧引导', () => {
    seedNodes([
      { sessionId: 'sess-pm1', roleLayer: 'pm1', parentSessionId: null, state: 'running' },
    ]);
    seedHandoff({
      id: 'h-1',
      state: 'running',
      fromRoleLayer: 'reception',
      toRoleLayer: 'pm1',
      sessionId: 'sess-pm1',
      updatedAt: Date.now(),
    });

    render(<LayerFlowView />);

    // 5 层节点的短名都在（接待/规划/管控/执行/评审）。短名也可能出现在时间线行里，
    // 故用 getAllByText 容忍多处匹配。
    for (const short of ['接待', '规划', '管控', '执行', '评审']) {
      expect(screen.getAllByText(short).length).toBeGreaterThanOrEqual(1);
    }
    // 默认右侧引导
    expect(screen.getByText('选择上方节点或左侧消息查看详情')).toBeTruthy();
    expect(screen.queryByTestId('team-session-view-mock')).toBeNull();
  });

  it('点击有 session 的层级节点打开该层对话', () => {
    seedNodes([
      { sessionId: 'sess-pm1', roleLayer: 'pm1', parentSessionId: null, state: 'running' },
    ]);
    seedHandoff({
      id: 'h-2',
      state: 'running',
      fromRoleLayer: 'reception',
      toRoleLayer: 'pm1',
      sessionId: 'sess-pm1',
      updatedAt: Date.now(),
    });

    render(<LayerFlowView />);

    fireEvent.click(screen.getByTitle('查看PM1 规划层对话'));
    const view = screen.getByTestId('team-session-view-mock');
    expect(view.getAttribute('data-session-id')).toBe('sess-pm1');
  });

  it('点击时间线消息行打开会话并显示详情头', () => {
    seedHandoff({
      id: 'h-3',
      state: 'completed',
      fromRoleLayer: 'pm1',
      toRoleLayer: 'pm2',
      sessionId: 'sess-pm2',
      summary: '把规划结果交给管控层做架构审查',
      updatedAt: Date.now(),
    });

    render(<LayerFlowView />);

    // 时间线行里有摘要文案
    expect(screen.getByText('把规划结果交给管控层做架构审查')).toBeTruthy();
    // 点击行 → 打开会话
    fireEvent.click(screen.getAllByText('把规划结果交给管控层做架构审查')[0]!);
    const view = screen.getByTestId('team-session-view-mock');
    expect(view.getAttribute('data-session-id')).toBe('sess-pm2');
  });
});
