// @vitest-environment jsdom
/**
 * LayerFlowView smoke：
 *   - 无数据 → 空态
 *   - 有 handoff → 流水线 5 层节点 + 时间线行渲染；点击有 session 的层级节点 → 右侧
 *     渲染对应 TeamConversationView；点击时间线行 → 同样打开会话 + 详情头。
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
  TeamConversationView: ({ sessionId }: { sessionId: string }) => (
    <div data-testid="team-session-view-mock" data-session-id={sessionId} />
  ),
}));

vi.mock('./CrossLayerConversationView.js', () => ({
  CrossLayerConversationView: ({
    focusHandoffId,
    focusSessionId,
    selectedTeam,
  }: {
    focusHandoffId?: string | null;
    focusSessionId?: string | null;
    selectedTeam?: { id: string } | null;
  }) => (
    <div
      data-focus-handoff-id={focusHandoffId ?? ''}
      data-focus-session-id={focusSessionId ?? ''}
      data-selected-team-id={selectedTeam?.id ?? ''}
      data-testid="cross-layer-view-mock"
    />
  ),
}));

const referenceState = vi.hoisted(() => ({
  sessions: [] as TeamRuntimeSessionRecord[],
}));

vi.mock('../../data/team-runtime-reference-data.js', () => ({
  useTeamRuntimeReferenceViewData: () => ({
    sessions: referenceState.sessions,
  }),
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
  referenceState.sessions = [];
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});

afterEach(() => {
  cleanup();
  useHandoffStore.getState().clear();
  useLayerStore.getState().clear();
  vi.restoreAllMocks();
});

function runtimeSession(
  id: string,
  parentSessionId: string | null,
  roleLayer: TeamRuntimeSessionRecord['roleLayer'],
  title: string,
): TeamRuntimeSessionRecord {
  return {
    id,
    metadataJson: '{}',
    parentSessionId,
    roleLayer,
    stateStatus: 'completed',
    title,
    updatedAt: '2026-06-06T10:00:00.000Z',
    workspacePath: '/work',
  };
}

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

  it('窄宽度下层级流动详情改为上下堆叠布局', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 860 });
    window.dispatchEvent(new Event('resize'));

    seedNodes([
      { sessionId: 'sess-pm1', roleLayer: 'pm1', parentSessionId: null, state: 'running' },
    ]);
    seedHandoff({
      id: 'h-narrow',
      state: 'running',
      fromRoleLayer: 'reception',
      toRoleLayer: 'pm1',
      sessionId: 'sess-pm1',
      updatedAt: Date.now(),
    });

    render(<LayerFlowView />);

    fireEvent.click(screen.getByTitle('查看PM1 规划层对话'));

    const details = screen.getByText('层级交接记录').closest('div');
    expect(details?.parentElement?.getAttribute('style') ?? '').toContain('flex-direction: column');
  });

  it('点击有 session 的层级节点默认打开跨层线程，可切到单层对话', () => {
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
    expect(screen.getByTestId('cross-layer-view-mock').getAttribute('data-selected-team-id')).toBe(
      'sess-pm1',
    );
    expect(screen.getByTestId('cross-layer-view-mock').getAttribute('data-focus-session-id')).toBe(
      'sess-pm1',
    );

    fireEvent.click(screen.getByText('单层'));
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

    // 折叠态：会话行内显示摘要
    const summaryText = '把规划结果交给管控层做架构审查';
    expect(screen.getByText(summaryText)).toBeTruthy();
    // 先点击折叠行展开
    fireEvent.click(screen.getByText(summaryText));
    // 展开后子项列表中也出现同一摘要，点击子项 → 打开会话
    const summaryMatches = screen.getAllByText(summaryText);
    fireEvent.click(summaryMatches[summaryMatches.length - 1]!);
    expect(screen.getByTestId('cross-layer-view-mock').getAttribute('data-focus-handoff-id')).toBe(
      'h-3',
    );
    expect(screen.getByTestId('cross-layer-view-mock').getAttribute('data-selected-team-id')).toBe(
      'sess-pm2',
    );
  });

  it('单层详情头会显示来源会话与当前会话', () => {
    seedNodes([
      { sessionId: 'sess-root', roleLayer: 'reception', parentSessionId: null, state: 'completed', title: '主接待会话' },
      { sessionId: 'sess-pm1', roleLayer: 'pm1', parentSessionId: 'sess-root', state: 'completed', title: 'PM1 规划会话' },
    ]);
    useHandoffStore.setState({
      handoffs: new Map([
        [
          'h-header-1',
          {
            id: 'h-header-1',
            state: 'completed',
            fromRoleLayer: 'reception',
            toRoleLayer: 'pm1',
            fromSessionId: 'sess-root',
            toSessionId: 'sess-pm1',
            sessionId: 'sess-pm1',
            summary: '第一次派发规划任务',
            updatedAt: Date.now() - 1000,
          },
        ],
        [
          'h-header',
          {
            id: 'h-header',
            state: 'completed',
            fromRoleLayer: 'reception',
            toRoleLayer: 'pm1',
            fromSessionId: 'sess-root',
            toSessionId: 'sess-pm1',
            sessionId: 'sess-pm1',
            summary: '接待派发规划任务',
            updatedAt: Date.now(),
          },
        ],
      ]),
    });

    render(<LayerFlowView />);

    // 折叠态显示最新摘要，点击展开
    fireEvent.click(screen.getByText('接待派发规划任务'));
    // 展开后子项出现，点击子项中的「接待派发规划任务」
    const matches = screen.getAllByText('接待派发规划任务');
    fireEvent.click(matches[matches.length - 1]!);
    fireEvent.click(screen.getByText('单层'));

    expect(screen.getByText('来源上下文')).toBeTruthy();
    expect(screen.getAllByText('主接待会话').length).toBeGreaterThan(0);
    expect(screen.getByText('当前会话')).toBeTruthy();
    expect(screen.getAllByText('PM1 规划会话').length).toBeGreaterThan(0);
    expect(screen.getByText('当前轮次 · 第 2 轮（复用会话）')).toBeTruthy();
  });

  it('handoff 详情头会展示 from/to/retry/paused 元信息', () => {
    referenceState.sessions = [
      runtimeSession('sess-pm1', null, 'pm1', 'PM1 会话'),
      runtimeSession('sess-executor', 'sess-pm1', 'executor', '执行会话'),
    ];
    seedHandoff({
      id: 'h-meta',
      state: 'running',
      fromRoleLayer: 'pm1',
      toRoleLayer: 'executor',
      fromSessionId: 'sess-pm1',
      toSessionId: 'sess-executor',
      sessionId: 'sess-executor',
      summary: '规划下发执行任务',
      updatedAt: Date.now(),
      retryCount: 2,
      paused: true,
    });

    render(<LayerFlowView />);

    // 折叠态显示摘要，点击展开
    fireEvent.click(screen.getByText('规划下发执行任务'));
    // 展开后点击子项
    const matches = screen.getAllByText('规划下发执行任务');
    fireEvent.click(matches[matches.length - 1]!);

    expect(screen.getByText('from · sess-pm1')).toBeTruthy();
    expect(screen.getByText('to · sess-exe')).toBeTruthy();
    expect(screen.getByText('来源会话')).toBeTruthy();
    expect(screen.getAllByText('PM1 会话').length).toBeGreaterThan(0);
    expect(screen.getByText('目标会话')).toBeTruthy();
    expect(screen.getAllByText('执行会话').length).toBeGreaterThan(0);
    expect(screen.getByText('retry · 2')).toBeTruthy();
    expect(screen.getByText('paused')).toBeTruthy();
  });

  it('点击时间线 handoff 时优先打开目标层会话，而不是上游主会话', () => {
    seedNodes([
      { sessionId: 'sess-root', roleLayer: 'reception', parentSessionId: null, state: 'running' },
      { sessionId: 'sess-pm1', roleLayer: 'pm1', parentSessionId: 'sess-root', state: 'running' },
    ]);
    seedHandoff({
      id: 'h-thread-target',
      state: 'running',
      fromRoleLayer: 'reception',
      toRoleLayer: 'pm1',
      fromSessionId: 'sess-root',
      toSessionId: 'sess-pm1',
      sessionId: 'sess-pm1',
      summary: '接待到 PM1',
      updatedAt: Date.now(),
    });

    render(<LayerFlowView />);

    // 折叠态显示摘要，点击展开
    fireEvent.click(screen.getByText('接待到 PM1'));
    // 展开后点击子项
    const matches = screen.getAllByText('接待到 PM1');
    fireEvent.click(matches[matches.length - 1]!);

    expect(screen.getByTestId('cross-layer-view-mock').getAttribute('data-selected-team-id')).toBe(
      'sess-pm1',
    );
  });

  it('handoff 记录同时带 sessionId 与 toSessionId 时优先展示 toSessionId', () => {
    seedNodes([
      { sessionId: 'sess-root', roleLayer: 'reception', parentSessionId: null, state: 'running' },
      { sessionId: 'sess-pm1', roleLayer: 'pm1', parentSessionId: 'sess-root', state: 'running' },
    ]);
    seedHandoff({
      id: 'h-to-session',
      state: 'running',
      fromRoleLayer: 'reception',
      toRoleLayer: 'pm1',
      fromSessionId: 'sess-root',
      sessionId: 'sess-root',
      toSessionId: 'sess-pm1',
      summary: '目标层线程',
      updatedAt: Date.now(),
    });

    render(<LayerFlowView />);

    fireEvent.click(screen.getByTitle('查看PM1 规划层对话'));

    expect(screen.getByTestId('cross-layer-view-mock').getAttribute('data-selected-team-id')).toBe(
      'sess-pm1',
    );
  });

  it('handoff 缺少 toSessionId 且 sessionId 是上游时，层级节点打开目标子会话', () => {
    seedNodes([
      { sessionId: 'sess-root-old', roleLayer: 'reception', parentSessionId: null, state: 'running' },
      {
        sessionId: 'sess-pm1-old',
        roleLayer: 'pm1',
        parentSessionId: 'sess-root-old',
        state: 'running',
      },
    ]);
    seedHandoff({
      id: 'h-old-upstream',
      state: 'running',
      fromRoleLayer: 'reception',
      toRoleLayer: 'pm1',
      fromSessionId: 'sess-root-old',
      sessionId: 'sess-root-old',
      summary: '旧格式目标层',
      updatedAt: Date.now(),
    });

    render(<LayerFlowView />);

    fireEvent.click(screen.getByTitle('查看PM1 规划层对话'));

    expect(screen.getByTestId('cross-layer-view-mock').getAttribute('data-selected-team-id')).toBe(
      'sess-pm1-old',
    );

    fireEvent.click(screen.getByRole('tab', { name: '单层' }));
    expect(screen.getByTestId('team-session-view-mock').getAttribute('data-session-id')).toBe(
      'sess-pm1-old',
    );
  });

  it('只有 runtime snapshot sessions 时仍渲染层级节点并打开目标层会话', () => {
    referenceState.sessions = [
      runtimeSession('sess-root', null, 'reception', '主会话'),
      runtimeSession('sess-pm1', 'sess-root', 'pm1', 'PM1 层会话'),
      runtimeSession('sess-executor', 'sess-pm1', 'executor', '执行层会话'),
    ];

    render(
      <LayerFlowView
        selectedTeam={{
          id: 'sess-root',
          status: 'completed',
          subtitle: '已完成',
          title: '主会话',
        }}
      />,
    );

    expect(screen.queryByText('还没有跨层流动')).toBeNull();

    fireEvent.click(screen.getByTitle('查看PM1 规划层对话'));
    expect(screen.getByTestId('cross-layer-view-mock').getAttribute('data-selected-team-id')).toBe(
      'sess-pm1',
    );
    expect(screen.getByTestId('cross-layer-view-mock').getAttribute('data-focus-session-id')).toBe(
      'sess-pm1',
    );

    fireEvent.click(screen.getByRole('tab', { name: '单层' }));
    expect(screen.getByTestId('team-session-view-mock').getAttribute('data-session-id')).toBe(
      'sess-pm1',
    );
  });

  it('点击层级节点后默认展示跨层线程，可切换到单层会话', () => {
    seedNodes([
      { sessionId: 'sess-pm1', roleLayer: 'pm1', parentSessionId: 'sess-root', state: 'running' },
    ]);
    seedHandoff({
      id: 'h-4',
      state: 'running',
      fromRoleLayer: 'reception',
      toRoleLayer: 'pm1',
      fromSessionId: 'sess-root',
      toSessionId: 'sess-pm1',
      sessionId: 'sess-pm1',
      updatedAt: Date.now(),
    });

    render(<LayerFlowView />);

    fireEvent.click(screen.getByTitle('查看PM1 规划层对话'));
    expect(screen.getByTestId('cross-layer-view-mock').getAttribute('data-selected-team-id')).toBe(
      'sess-pm1',
    );

    fireEvent.click(screen.getByRole('tab', { name: '单层' }));
    expect(screen.getByTestId('team-session-view-mock').getAttribute('data-session-id')).toBe(
      'sess-pm1',
    );
  });

  it('传入 selectedTeam 时只展示该会话树内的 handoff', () => {
    seedNodes([
      { sessionId: 'root-a', roleLayer: 'reception', parentSessionId: null, state: 'running' },
      { sessionId: 'child-a', roleLayer: 'pm1', parentSessionId: 'root-a', state: 'running' },
      { sessionId: 'root-b', roleLayer: 'reception', parentSessionId: null, state: 'running' },
      { sessionId: 'child-b', roleLayer: 'pm1', parentSessionId: 'root-b', state: 'running' },
    ]);
    useHandoffStore.setState({
      handoffs: new Map([
        [
          'handoff-a',
          {
            id: 'handoff-a',
            state: 'running',
            fromRoleLayer: 'reception',
            toRoleLayer: 'pm1',
            fromSessionId: 'root-a',
            toSessionId: 'child-a',
            sessionId: 'child-a',
            summary: 'A 链路',
            updatedAt: Date.now(),
          },
        ],
        [
          'handoff-b',
          {
            id: 'handoff-b',
            state: 'running',
            fromRoleLayer: 'reception',
            toRoleLayer: 'pm1',
            fromSessionId: 'root-b',
            toSessionId: 'child-b',
            sessionId: 'child-b',
            summary: 'B 链路',
            updatedAt: Date.now() - 1000,
          },
        ],
      ]),
    });

    render(
      <LayerFlowView
        selectedTeam={{
          id: 'root-a',
          status: 'running',
          subtitle: '运行中',
          title: 'Root A',
        }}
      />,
    );

    expect(screen.getByText('A 链路')).toBeTruthy();
    expect(screen.queryByText('B 链路')).toBeNull();
  });

  it('点击子层节点后不把左侧流水线错误收缩到该子会话', () => {
    seedNodes([
      { sessionId: 'root-a', roleLayer: 'reception', parentSessionId: null, state: 'running' },
      { sessionId: 'child-pm1', roleLayer: 'pm1', parentSessionId: 'root-a', state: 'running' },
      {
        sessionId: 'child-executor',
        roleLayer: 'executor',
        parentSessionId: 'child-pm1',
        state: 'running',
      },
    ]);
    useHandoffStore.setState({
      handoffs: new Map([
        [
          'handoff-pm1',
          {
            id: 'handoff-pm1',
            state: 'running',
            fromRoleLayer: 'reception',
            toRoleLayer: 'pm1',
            fromSessionId: 'root-a',
            toSessionId: 'child-pm1',
            sessionId: 'child-pm1',
            summary: '接待到规划',
            updatedAt: Date.now(),
          },
        ],
        [
          'handoff-executor',
          {
            id: 'handoff-executor',
            state: 'running',
            fromRoleLayer: 'pm1',
            toRoleLayer: 'executor',
            fromSessionId: 'child-pm1',
            toSessionId: 'child-executor',
            sessionId: 'child-executor',
            summary: '规划到执行',
            updatedAt: Date.now() - 1000,
          },
        ],
      ]),
    });

    render(
      <LayerFlowView
        selectedTeam={{
          id: 'root-a',
          status: 'running',
          subtitle: '运行中',
          title: 'Root A',
        }}
      />,
    );

    expect(screen.getByText('接待到规划')).toBeTruthy();
    expect(screen.getByText('规划到执行')).toBeTruthy();

    fireEvent.click(screen.getByTitle('查看PM1 规划层对话'));

    expect(screen.getByText('接待到规划')).toBeTruthy();
    expect(screen.getByText('规划到执行')).toBeTruthy();
  });

  it('传入子层 selectedTeam 时展示其根会话树，而不是只显示子层局部或其它树', () => {
    seedNodes([
      { sessionId: 'root-a', roleLayer: 'reception', parentSessionId: null, state: 'running' },
      { sessionId: 'child-pm1-a', roleLayer: 'pm1', parentSessionId: 'root-a', state: 'running' },
      {
        sessionId: 'child-executor-a',
        roleLayer: 'executor',
        parentSessionId: 'child-pm1-a',
        state: 'running',
      },
      { sessionId: 'root-b', roleLayer: 'reception', parentSessionId: null, state: 'running' },
      { sessionId: 'child-pm1-b', roleLayer: 'pm1', parentSessionId: 'root-b', state: 'running' },
    ]);
    useHandoffStore.setState({
      handoffs: new Map([
        [
          'handoff-a-1',
          {
            id: 'handoff-a-1',
            state: 'running',
            fromRoleLayer: 'reception',
            toRoleLayer: 'pm1',
            fromSessionId: 'root-a',
            toSessionId: 'child-pm1-a',
            sessionId: 'child-pm1-a',
            summary: 'A 接待到规划',
            updatedAt: Date.now(),
          },
        ],
        [
          'handoff-a-2',
          {
            id: 'handoff-a-2',
            state: 'running',
            fromRoleLayer: 'pm1',
            toRoleLayer: 'executor',
            fromSessionId: 'child-pm1-a',
            toSessionId: 'child-executor-a',
            sessionId: 'child-executor-a',
            summary: 'A 规划到执行',
            updatedAt: Date.now() - 1000,
          },
        ],
        [
          'handoff-b-1',
          {
            id: 'handoff-b-1',
            state: 'running',
            fromRoleLayer: 'reception',
            toRoleLayer: 'pm1',
            fromSessionId: 'root-b',
            toSessionId: 'child-pm1-b',
            sessionId: 'child-pm1-b',
            summary: 'B 接待到规划',
            updatedAt: Date.now() - 2000,
          },
        ],
      ]),
    });

    render(
      <LayerFlowView
        selectedTeam={{
          id: 'child-pm1-a',
          status: 'running',
          subtitle: 'PM1',
          title: 'Child PM1 A',
        }}
      />,
    );

    expect(screen.getByText('A 接待到规划')).toBeTruthy();
    expect(screen.getByText('A 规划到执行')).toBeTruthy();
    expect(screen.queryByText('B 接待到规划')).toBeNull();
  });
});
