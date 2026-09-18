// @vitest-environment jsdom
/**
 * 260916-层级可视化重构 · LayeredConversationView（追踪瀑布版）行为测试
 *
 * 覆盖：空态、泳道与时间条渲染、默认自动选中子层、点击切换/取消、
 * 聚焦层只降级不隐藏、角色提示词入口按层收敛。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { TeamRuntimeSessionRecord } from '@openAwork/web-client';
import {
  useHandoffStore,
  useLayerStore,
  type HandoffEntry,
  type LayerNode,
} from '../../../../../stores/team/team-events.js';

vi.mock('../../../conversation/TeamConversationView.js', () => ({
  TeamConversationView: ({ compact, sessionId }: { compact?: boolean; sessionId: string }) => (
    <div
      data-compact={compact === true ? 'true' : 'false'}
      data-session-id={sessionId}
      data-testid="team-session-view-mock"
    />
  ),
}));

vi.mock('../tasks/use-team-artifact-data.js', () => ({
  useTeamArtifactData: () => ({
    artifactError: null,
    artifactLoading: false,
    planArtifact: null,
    refreshArtifacts: () => undefined,
    reviewArtifact: null,
    specArtifact: null,
    tasksArtifact: null,
  }),
}));

vi.mock('../../hooks/use-session-handoffs.js', () => ({
  useSessionHandoffs: () => ({
    applyPreview: () => undefined,
    error: null,
    handoffs: [],
    loading: false,
    refresh: () => undefined,
  }),
}));

const referenceState = vi.hoisted(() => ({ sessions: [] as TeamRuntimeSessionRecord[] }));

vi.mock('../../data/team-runtime-reference-data.js', () => ({
  // sessions 必须是稳定引用：否则每次渲染都会重建 rows，兜底选中 effect 反复覆盖用户操作。
  useTeamRuntimeReferenceViewData: () => ({ sessions: referenceState.sessions }),
}));

import { LayeredConversationView } from './LayeredConversationView.js';

function seedLayerNodes(nodes: LayerNode[]) {
  useLayerStore.setState({ nodes: new Map(nodes.map((node) => [node.sessionId, node])) });
}

function seedHandoffs(entries: HandoffEntry[]) {
  useHandoffStore.setState({ handoffs: new Map(entries.map((entry) => [entry.id, entry])) });
}

function traceBar(sessionId: string): HTMLElement {
  const element = document.querySelector(`[data-trace-session="${sessionId}"]`);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`未找到时间条：${sessionId}`);
  }
  return element;
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

describe('LayeredConversationView — 追踪瀑布', () => {
  it('无 handoff / 节点时显示空态', () => {
    render(<LayeredConversationView />);
    expect(screen.getByText('暂无层级对话数据')).toBeTruthy();
  });

  it('按层渲染泳道，并为每个层级会话渲染时间条', () => {
    seedLayerNodes([
      {
        sessionId: 'sess-root',
        roleLayer: 'reception',
        parentSessionId: null,
        state: 'completed',
        title: '根会话',
      },
      {
        sessionId: 'sess-pm1',
        roleLayer: 'pm1',
        parentSessionId: 'sess-root',
        state: 'completed',
        title: 'PM1 历史会话',
      },
    ]);

    render(<LayeredConversationView />);

    expect(screen.getByText('接待')).toBeTruthy();
    expect(screen.getByText('规划')).toBeTruthy();
    expect(traceBar('sess-root')).toBeTruthy();
    expect(traceBar('sess-pm1')).toBeTruthy();
  });

  it('默认自动打开子层会话而不是根会话', () => {
    seedLayerNodes([
      {
        sessionId: 'sess-root',
        roleLayer: 'reception',
        parentSessionId: null,
        state: 'completed',
        title: '根会话',
      },
      {
        sessionId: 'sess-pm1',
        roleLayer: 'pm1',
        parentSessionId: 'sess-root',
        state: 'completed',
        title: 'PM1 历史会话',
      },
    ]);

    render(<LayeredConversationView />);

    expect(screen.getByTestId('team-session-view-mock').getAttribute('data-session-id')).toBe(
      'sess-pm1',
    );
    expect(screen.getByTestId('team-session-view-mock').getAttribute('data-compact')).toBe('true');
  });

  it('点击时间条切换选中会话，再次点击取消选中回到引导态', () => {
    seedLayerNodes([
      {
        sessionId: 'sess-root',
        roleLayer: 'reception',
        parentSessionId: null,
        state: 'completed',
        title: '根会话',
      },
      {
        sessionId: 'sess-pm1',
        roleLayer: 'pm1',
        parentSessionId: 'sess-root',
        state: 'completed',
        title: 'PM1 历史会话',
      },
      {
        sessionId: 'sess-reviewer',
        roleLayer: 'reviewer',
        parentSessionId: 'sess-root',
        state: 'completed',
        title: '评审历史会话',
      },
    ]);

    render(<LayeredConversationView />);

    fireEvent.click(traceBar('sess-reviewer'));
    expect(screen.getByTestId('team-session-view-mock').getAttribute('data-session-id')).toBe(
      'sess-reviewer',
    );

    fireEvent.click(traceBar('sess-pm1'));
    expect(screen.getByTestId('team-session-view-mock').getAttribute('data-session-id')).toBe(
      'sess-pm1',
    );

    fireEvent.click(traceBar('sess-pm1'));
    expect(screen.queryByTestId('team-session-view-mock')).toBeNull();
    expect(screen.getByText('点击上方时间条查看该层级对话')).toBeTruthy();
  });

  it('聚焦某层只把其它层降级（dim），不隐藏时间条，也不影响已打开对话', () => {
    seedLayerNodes([
      {
        sessionId: 'sess-root',
        roleLayer: 'reception',
        parentSessionId: null,
        state: 'completed',
        title: '根会话',
      },
      {
        sessionId: 'sess-pm1',
        roleLayer: 'pm1',
        parentSessionId: 'sess-root',
        state: 'completed',
        title: 'PM1 历史会话',
      },
      {
        sessionId: 'sess-reviewer',
        roleLayer: 'reviewer',
        parentSessionId: 'sess-root',
        state: 'completed',
        title: '评审历史会话',
      },
    ]);

    render(<LayeredConversationView />);
    expect(screen.getByTestId('team-session-view-mock').getAttribute('data-session-id')).toBe(
      'sess-pm1',
    );

    fireEvent.click(screen.getByText('评审 · 1'));

    expect(traceBar('sess-reviewer').getAttribute('data-dim')).toBe('false');
    expect(traceBar('sess-pm1').getAttribute('data-dim')).toBe('true');
    expect(screen.getByTestId('team-session-view-mock').getAttribute('data-session-id')).toBe(
      'sess-pm1',
    );
  });

  it('角色提示词入口按层收敛：规划层可用，测试层不可用', () => {
    seedLayerNodes([
      {
        sessionId: 'sess-root',
        roleLayer: 'reception',
        parentSessionId: null,
        state: 'completed',
        title: '根会话',
      },
      {
        sessionId: 'sess-pm1',
        roleLayer: 'pm1',
        parentSessionId: 'sess-root',
        state: 'completed',
        title: 'PM1 历史会话',
      },
      {
        sessionId: 'sess-tester',
        roleLayer: 'tester',
        parentSessionId: 'sess-root',
        state: 'completed',
        title: '测试历史会话',
      },
    ]);

    render(<LayeredConversationView />);

    // 默认选中规划层（子层优先），规划层支持角色提示词预览
    expect(screen.getByTestId('team-session-view-mock').getAttribute('data-session-id')).toBe(
      'sess-pm1',
    );
    expect(screen.getByText('🧬 角色提示词')).toBeTruthy();

    fireEvent.click(traceBar('sess-tester'));
    expect(screen.getByTestId('team-session-view-mock').getAttribute('data-session-id')).toBe(
      'sess-tester',
    );
    expect(screen.queryByText('🧬 角色提示词')).toBeNull();
  });

  it('交接与时间跨度进入统计胶囊', () => {
    seedLayerNodes([
      {
        sessionId: 'sess-root',
        roleLayer: 'reception',
        parentSessionId: null,
        state: 'completed',
        title: '根会话',
      },
      {
        sessionId: 'sess-pm1',
        roleLayer: 'pm1',
        parentSessionId: 'sess-root',
        state: 'completed',
        title: 'PM1 历史会话',
      },
    ]);
    seedHandoffs([
      {
        endedAt: 20_000,
        fromRoleLayer: 'user',
        id: 'handoff-root',
        startedAt: 5_000,
        state: 'completed',
        summary: '用户发起任务',
        toRoleLayer: 'reception',
        toSessionId: 'sess-root',
        updatedAt: 20_000,
      },
      {
        endedAt: 70_000,
        fromRoleLayer: 'reception',
        id: 'handoff-1',
        startedAt: 10_000,
        state: 'completed',
        summary: '接待到规划',
        toRoleLayer: 'pm1',
        toSessionId: 'sess-pm1',
        updatedAt: 70_000,
      },
    ]);

    render(<LayeredConversationView />);

    expect(screen.getByText('交接记录')).toBeTruthy();
    expect(screen.getByText('时间跨度')).toBeTruthy();
    expect(screen.getByText('1m 5s')).toBeTruthy();
  });
});
