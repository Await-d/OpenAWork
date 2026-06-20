// @vitest-environment jsdom
/**
 * 260517 · LayeredConversationView 双栏 Smoke 测试
 *
 * 验收历史层级对话：点击层级会话行后右栏按普通对话渲染对应 session。
 * 再次点击同条层级行取消选中。
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
  TeamConversationView: ({
    compact,
    focusedLayer,
    sessionId,
  }: {
    compact?: boolean;
    focusedLayer?: string | null;
    sessionId: string;
  }) => (
    <div
      data-compact={compact === true ? 'true' : 'false'}
      data-focused-layer={focusedLayer ?? ''}
      data-session-id={sessionId}
      data-testid="team-session-view-mock"
    />
  ),
}));

vi.mock('./CrossLayerConversationView.js', () => ({
  CrossLayerConversationView: ({
    selectedTeam,
  }: {
    selectedTeam?: { id: string; title: string } | null;
  }) => (
    <div
      data-selected-team-id={selectedTeam?.id ?? ''}
      data-selected-team-title={selectedTeam?.title ?? ''}
      data-testid="cross-layer-view-mock"
    />
  ),
}));

import { LayeredConversationView } from './LayeredConversationView.js';

function seedHandoff(entry: HandoffEntry) {
  const map = new Map<string, HandoffEntry>([[entry.id, entry]]);
  useHandoffStore.setState({ handoffs: map });
}

function seedLayerNodes(nodes: LayerNode[]) {
  const map = new Map<string, LayerNode>(nodes.map((n) => [n.sessionId, n]));
  useLayerStore.setState({ nodes: map });
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

describe('LayeredConversationView — 双栏交互', () => {
  it('无 handoff / 节点时显示空态', () => {
    render(<LayeredConversationView />);
    expect(screen.getByText('暂无层级对话数据')).toBeTruthy();
  });

  it('有 handoff 时左栏渲染行，右栏默认欢迎面板', () => {
    seedLayerNodes([
      {
        sessionId: 'sess-pm1-001',
        roleLayer: 'pm1',
        parentSessionId: null,
        state: 'running',
      },
    ]);
    seedHandoff({
      id: 'handoff-001',
      state: 'running',
      fromRoleLayer: 'reception',
      toRoleLayer: 'pm1',
      sessionId: 'sess-pm1-001',
      updatedAt: Date.now(),
    });

    render(<LayeredConversationView />);

    expect(screen.getByText('选择左侧层级查看历史对话')).toBeTruthy();
    expect(screen.queryByTestId('team-session-view-mock')).toBeNull();
  });

  it('没有 handoff 但有历史层级节点时，仍可打开该层级会话', () => {
    seedLayerNodes([
      {
        sessionId: 'sess-pm1-history-only',
        roleLayer: 'pm1',
        parentSessionId: 'sess-root-history-only',
        state: 'completed',
        title: '历史 PM1 会话',
      },
    ]);

    render(<LayeredConversationView />);

    const view = screen.getByTestId('team-session-view-mock');
    expect(view.getAttribute('data-session-id')).toBe('sess-pm1-history-only');
  });

  it('点击层级行后右栏渲染对应 session 的 TeamConversationView', () => {
    seedLayerNodes([
      {
        sessionId: 'sess-pm1-002',
        roleLayer: 'pm1',
        parentSessionId: null,
        state: 'running',
      },
    ]);
    seedHandoff({
      id: 'handoff-002',
      state: 'running',
      fromRoleLayer: 'reception',
      toRoleLayer: 'pm1',
      sessionId: 'sess-pm1-002',
      updatedAt: Date.now(),
    });

    render(<LayeredConversationView />);

    // timeline 行通过 sessionId 文案找
    const row = screen.getByTitle('查看会话 sess-pm1-002');
    fireEvent.click(row);

    const view = screen.getByTestId('team-session-view-mock');
    expect(view.getAttribute('data-session-id')).toBe('sess-pm1-002');
  });

  it('存在子层历史时默认打开子层而不是主会话', () => {
    seedLayerNodes([
      {
        sessionId: 'sess-root-history',
        roleLayer: 'reception',
        parentSessionId: null,
        state: 'completed',
        title: '根会话',
      },
      {
        sessionId: 'sess-pm1-history',
        roleLayer: 'pm1',
        parentSessionId: 'sess-root-history',
        state: 'completed',
        title: 'PM1 历史会话',
      },
    ]);

    render(
      <LayeredConversationView
        selectedTeam={{
          id: 'sess-root-history',
          status: 'completed',
          subtitle: '已完成',
          title: '根会话',
        }}
      />,
    );

    const view = screen.getByTestId('team-session-view-mock');
    expect(view.getAttribute('data-session-id')).toBe('sess-pm1-history');
    expect(view.getAttribute('data-compact')).toBe('false');
  });

  it('切换到跨层线程后会跟随当前选中的历史行，而不是固定父会话', () => {
    seedLayerNodes([
      {
        sessionId: 'sess-root-thread',
        roleLayer: 'reception',
        parentSessionId: null,
        state: 'completed',
        title: '根会话',
      },
      {
        sessionId: 'sess-pm1-thread',
        roleLayer: 'pm1',
        parentSessionId: 'sess-root-thread',
        state: 'completed',
        title: 'PM1 历史会话',
      },
    ]);

    render(
      <LayeredConversationView
        selectedTeam={{
          id: 'sess-root-thread',
          status: 'completed',
          subtitle: '已完成',
          title: '根会话',
        }}
      />,
    );

    fireEvent.click(screen.getByText('线程'));

    expect(screen.getByTestId('cross-layer-view-mock').getAttribute('data-selected-team-id')).toBe(
      'sess-pm1-thread',
    );
    expect(
      screen.getByTestId('cross-layer-view-mock').getAttribute('data-selected-team-title'),
    ).toBe('PM1 历史会话');
  });

  it('点击子层历史行时，右栏按普通对话直接打开该子层会话', () => {
    seedLayerNodes([
      {
        sessionId: 'sess-root-tree',
        roleLayer: 'reception',
        parentSessionId: null,
        state: 'completed',
        title: '根会话',
      },
      {
        sessionId: 'sess-pm1-tree',
        roleLayer: 'pm1',
        parentSessionId: 'sess-root-tree',
        state: 'completed',
        title: 'PM1 历史会话',
      },
    ]);

    render(
      <LayeredConversationView
        selectedTeam={{
          id: 'sess-root-tree',
          status: 'completed',
          subtitle: '已完成',
          title: '根会话',
        }}
      />,
    );

    const view = screen.getByTestId('team-session-view-mock');
    expect(view.getAttribute('data-session-id')).toBe('sess-pm1-tree');
    expect(view.getAttribute('data-focused-layer')).toBe('');
  });

  it('点击左侧不同层级行时，右侧切换到对应 session 而不是复用同一个会话内容', () => {
    seedLayerNodes([
      {
        sessionId: 'sess-root-switch',
        roleLayer: 'reception',
        parentSessionId: null,
        state: 'completed',
        title: '根会话',
      },
      {
        sessionId: 'sess-pm1-switch',
        roleLayer: 'pm1',
        parentSessionId: 'sess-root-switch',
        state: 'completed',
        title: 'PM1 历史会话',
      },
      {
        sessionId: 'sess-reviewer-switch',
        roleLayer: 'reviewer',
        parentSessionId: 'sess-root-switch',
        state: 'completed',
        title: '评审历史会话',
      },
    ]);

    render(
      <LayeredConversationView
        selectedTeam={{
          id: 'sess-root-switch',
          status: 'completed',
          subtitle: '已完成',
          title: '根会话',
        }}
      />,
    );

    expect(screen.getByTestId('team-session-view-mock').getAttribute('data-session-id')).toBe(
      'sess-pm1-switch',
    );

    fireEvent.click(screen.getByTitle('查看会话 sess-reviewer-switch'));

    expect(screen.getByTestId('team-session-view-mock').getAttribute('data-session-id')).toBe(
      'sess-reviewer-switch',
    );

    fireEvent.click(screen.getByTitle('查看会话 sess-pm1-switch'));

    expect(screen.getByTestId('team-session-view-mock').getAttribute('data-session-id')).toBe(
      'sess-pm1-switch',
    );
  });

  it('历史 handoff 只有上游 sessionId 时，点击目标层仍打开子层会话', () => {
    seedLayerNodes([
      {
        sessionId: 'sess-root-upstream',
        roleLayer: 'reception',
        parentSessionId: null,
        state: 'completed',
        title: '根会话',
      },
      {
        sessionId: 'sess-pm1-upstream',
        roleLayer: 'pm1',
        parentSessionId: 'sess-root-upstream',
        state: 'completed',
        title: 'PM1 历史会话',
      },
    ]);
    seedHandoff({
      id: 'handoff-upstream-session',
      state: 'completed',
      fromRoleLayer: 'reception',
      toRoleLayer: 'pm1',
      fromSessionId: 'sess-root-upstream',
      sessionId: 'sess-root-upstream',
      summary: '旧格式接待到 PM1',
      updatedAt: Date.now(),
    });

    render(
      <LayeredConversationView
        selectedTeam={{
          id: 'sess-root-upstream',
          status: 'completed',
          subtitle: '已完成',
          title: '根会话',
        }}
      />,
    );

    expect(screen.getByTitle('查看会话 sess-pm1-upstream')).toBeTruthy();
    expect(screen.getByTestId('team-session-view-mock').getAttribute('data-session-id')).toBe(
      'sess-pm1-upstream',
    );
  });

  it('tester 层历史节点可以筛选并按普通对话打开', () => {
    seedLayerNodes([
      {
        sessionId: 'sess-root-with-tester',
        roleLayer: 'reception',
        parentSessionId: null,
        state: 'completed',
        title: '根会话',
      },
      {
        sessionId: 'sess-tester-history',
        roleLayer: 'tester',
        parentSessionId: 'sess-root-with-tester',
        state: 'completed',
        title: '测试历史会话',
      },
    ]);

    render(
      <LayeredConversationView
        selectedTeam={{
          id: 'sess-root-with-tester',
          status: 'completed',
          subtitle: '已完成',
          title: '根会话',
        }}
      />,
    );

    fireEvent.click(screen.getByText('测试 · 1'));
    expect(screen.queryByText('🧬 角色提示词')).toBeNull();

    const view = screen.getByTestId('team-session-view-mock');
    expect(view.getAttribute('data-session-id')).toBe('sess-tester-history');
  });

  it('切换层级筛选时保留右侧已打开的历史对话', () => {
    seedLayerNodes([
      {
        sessionId: 'sess-root-filter',
        roleLayer: 'reception',
        parentSessionId: null,
        state: 'completed',
        title: '根会话',
      },
      {
        sessionId: 'sess-pm1-filter',
        roleLayer: 'pm1',
        parentSessionId: 'sess-root-filter',
        state: 'completed',
        title: 'PM1 历史会话',
      },
      {
        sessionId: 'sess-reviewer-filter',
        roleLayer: 'reviewer',
        parentSessionId: 'sess-root-filter',
        state: 'completed',
        title: '评审历史会话',
      },
    ]);

    render(
      <LayeredConversationView
        selectedTeam={{
          id: 'sess-root-filter',
          status: 'completed',
          subtitle: '已完成',
          title: '根会话',
        }}
      />,
    );

    expect(screen.getByTestId('team-session-view-mock').getAttribute('data-session-id')).toBe(
      'sess-pm1-filter',
    );

    fireEvent.click(screen.getByText('评审 · 1'));

    expect(screen.getByTestId('team-session-view-mock').getAttribute('data-session-id')).toBe(
      'sess-pm1-filter',
    );
  });

  it('已完成任务的历史 handoff 仍可打开对应层级会话', () => {
    seedLayerNodes([
      {
        sessionId: 'sess-reviewer-history',
        roleLayer: 'reviewer',
        parentSessionId: 'sess-root-history',
        state: 'completed',
      },
    ]);
    seedHandoff({
      id: 'handoff-history-completed',
      state: 'completed',
      fromRoleLayer: 'pm2',
      toRoleLayer: 'reviewer',
      fromSessionId: 'sess-pm2-history',
      toSessionId: 'sess-reviewer-history',
      sessionId: 'sess-reviewer-history',
      updatedAt: Date.now(),
    });

    render(<LayeredConversationView />);

    expect(screen.getByTestId('team-session-view-mock').getAttribute('data-session-id')).toBe(
      'sess-reviewer-history',
    );
  });

  it('再次点击同条层级行取消选中，回到欢迎面板', () => {
    seedLayerNodes([
      {
        sessionId: 'sess-pm1-003',
        roleLayer: 'pm1',
        parentSessionId: null,
        state: 'running',
      },
    ]);
    seedHandoff({
      id: 'handoff-003',
      state: 'running',
      fromRoleLayer: 'reception',
      toRoleLayer: 'pm1',
      sessionId: 'sess-pm1-003',
      updatedAt: Date.now(),
    });

    render(<LayeredConversationView />);

    const row = screen.getByTitle('查看会话 sess-pm1-003');
    fireEvent.click(row);
    expect(screen.queryByTestId('team-session-view-mock')).toBeTruthy();

    fireEvent.click(row);
    expect(screen.queryByTestId('team-session-view-mock')).toBeNull();
    expect(screen.getByText('选择左侧层级查看历史对话')).toBeTruthy();
  });

  it('切换 selectedTeam 时会重置旧的层级筛选，避免新会话沿用上一次的局部视图', () => {
    seedLayerNodes([
      {
        sessionId: 'sess-root-a',
        roleLayer: 'reception',
        parentSessionId: null,
        state: 'completed',
        title: '根会话 A',
      },
      {
        sessionId: 'sess-pm1-a',
        roleLayer: 'pm1',
        parentSessionId: 'sess-root-a',
        state: 'completed',
        title: 'PM1 A',
      },
      {
        sessionId: 'sess-root-b',
        roleLayer: 'reception',
        parentSessionId: null,
        state: 'completed',
        title: '根会话 B',
      },
      {
        sessionId: 'sess-pm1-b',
        roleLayer: 'pm1',
        parentSessionId: 'sess-root-b',
        state: 'completed',
        title: 'PM1 B',
      },
    ]);

    const { rerender } = render(
      <LayeredConversationView
        selectedTeam={{
          id: 'sess-root-a',
          status: 'completed',
          subtitle: '已完成',
          title: '根会话 A',
        }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'PM1 · 规划 · 1' }));
    expect(screen.getByTestId('team-session-view-mock').getAttribute('data-session-id')).toBe(
      'sess-pm1-a',
    );

    rerender(
      <LayeredConversationView
        selectedTeam={{
          id: 'sess-root-b',
          status: 'completed',
          subtitle: '已完成',
          title: '根会话 B',
        }}
      />,
    );

    expect(screen.getByTitle('查看会话 sess-root-b')).toBeTruthy();
    expect(screen.getByTestId('team-session-view-mock').getAttribute('data-session-id')).toBe(
      'sess-pm1-b',
    );
  });

  it('切到「线程」模式后渲染跨层线程视图', () => {
    seedLayerNodes([
      {
        sessionId: 'sess-pm1-004',
        roleLayer: 'pm1',
        parentSessionId: null,
        state: 'running',
      },
    ]);
    seedHandoff({
      id: 'handoff-004',
      state: 'running',
      fromRoleLayer: 'reception',
      toRoleLayer: 'pm1',
      sessionId: 'sess-pm1-004',
      updatedAt: Date.now(),
    });

    render(<LayeredConversationView />);

    // 默认双栏：右栏欢迎面板
    expect(screen.getByText('选择左侧层级查看历史对话')).toBeTruthy();

    fireEvent.click(screen.getByText('线程'));

    // 线程模式下双栏欢迎面板消失，改由跨层线程视图接管
    expect(screen.queryByText('选择左侧层级查看历史对话')).toBeNull();

    // 切回双栏
    fireEvent.click(screen.getByText('双栏'));
    expect(screen.getByText('选择左侧层级查看历史对话')).toBeTruthy();
  });
});
