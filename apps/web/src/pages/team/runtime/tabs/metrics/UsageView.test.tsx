// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type {
  TeamUsageEvent,
  ToolCallAggregateBucket,
  UsageBucket,
} from '../../../../../stores/team/team-usage.js';

const mockNodes = new Map();

function hasExactNormalizedText(expected: string) {
  const normalizedExpected = expected.replace(/\s+/g, '').trim();
  return (_content: string, element: Element | null) =>
    (element?.textContent ?? '').replace(/\s+/g, '').trim() === normalizedExpected;
}

function bucket(partial: Partial<UsageBucket>): UsageBucket {
  return {
    inputTokens: partial.inputTokens ?? 0,
    outputTokens: partial.outputTokens ?? 0,
    reasoningTokens: partial.reasoningTokens ?? 0,
    cacheReadTokens: partial.cacheReadTokens ?? 0,
    cacheWriteTokens: partial.cacheWriteTokens ?? 0,
    costUsd: partial.costUsd ?? 0,
    count: partial.count ?? 0,
  };
}

function usageEvent(partial: Partial<TeamUsageEvent>): TeamUsageEvent {
  return {
    inputTokens: partial.inputTokens ?? 0,
    outputTokens: partial.outputTokens ?? 0,
    timestamp: partial.timestamp ?? 0,
    ...(partial.sessionId ? { sessionId: partial.sessionId } : {}),
    ...(partial.provider ? { provider: partial.provider } : {}),
    ...(partial.agentId ? { agentId: partial.agentId } : {}),
    ...(partial.layer ? { layer: partial.layer } : {}),
    ...(partial.model ? { model: partial.model } : {}),
    ...(partial.reasoningTokens ? { reasoningTokens: partial.reasoningTokens } : {}),
    ...(partial.cacheReadTokens ? { cacheReadTokens: partial.cacheReadTokens } : {}),
    ...(partial.cacheWriteTokens ? { cacheWriteTokens: partial.cacheWriteTokens } : {}),
    ...(partial.costUsd ? { costUsd: partial.costUsd } : {}),
  };
}

const mockUsageState = {
  total: bucket({ count: 6, inputTokens: 600, outputTokens: 300, costUsd: 1.2 }),
  byProvider: new Map<string, UsageBucket>(),
  byAgent: new Map<string, UsageBucket>(),
  bySession: new Map<string, UsageBucket>(),
  byLayer: new Map<string, UsageBucket>(),
  bySessionProvider: new Map<string, Map<string, UsageBucket>>(),
  bySessionAgent: new Map<string, Map<string, UsageBucket>>(),
  bySessionLayer: new Map<string, Map<string, UsageBucket>>(),
  recent: [] as TeamUsageEvent[],
};
const mockToolCallState = {
  bySession: new Map<string, ToolCallAggregateBucket>(),
  totalFailures: 0,
  totalInvocations: 0,
};
const runtimeReferenceState = {
  activeSharedSession: null as null | {
    session: { messages: Array<unknown> };
    share: { sessionId: string; title: string | null };
  },
  selectedSharedSession: null as null | {
    session: { messages: Array<unknown> };
    share: { sessionId: string; title: string | null };
  },
  sharedSessionLoading: false,
  sharedSessions: [] as Array<{
    sessionId: string;
    title: string | null;
  }>,
};

vi.mock('../../../../../stores/team/team-events.js', () => ({
  useLayerStore: (selector: (state: { nodes: typeof mockNodes }) => unknown) =>
    selector({ nodes: mockNodes }),
}));

vi.mock('../../../../../stores/team/team-usage.js', () => ({
  useTeamUsageStore: (selector: (state: typeof mockUsageState) => unknown) =>
    selector(mockUsageState),
  useTeamToolCallStore: (selector: (state: typeof mockToolCallState) => unknown) =>
    selector(mockToolCallState),
}));

vi.mock('../../data/team-runtime-reference-data.js', () => ({
  useTeamRuntimeReferenceViewData: () => runtimeReferenceState,
}));

vi.mock('./SessionStatsPanel.js', () => ({
  SessionStatsPanel: () => <div data-testid="session-stats-panel" />,
}));

import { UsageView } from './UsageView.js';

beforeEach(() => {
  cleanup();
  mockNodes.clear();
  mockUsageState.total = bucket({ count: 6, inputTokens: 600, outputTokens: 300, costUsd: 1.2 });
  mockUsageState.byProvider = new Map([
    ['openai', bucket({ count: 6, inputTokens: 600, outputTokens: 300, costUsd: 1.2 })],
  ]);
  mockUsageState.byAgent = new Map([
    ['agent-global', bucket({ count: 6, inputTokens: 600, outputTokens: 300, costUsd: 1.2 })],
  ]);
  mockUsageState.bySession = new Map([
    ['session-root', bucket({ count: 2, inputTokens: 120, outputTokens: 60, costUsd: 0.3 })],
    ['session-child', bucket({ count: 1, inputTokens: 30, outputTokens: 10, costUsd: 0.05 })],
    ['session-other', bucket({ count: 3, inputTokens: 450, outputTokens: 230, costUsd: 0.85 })],
  ]);
  mockUsageState.byLayer = new Map([
    ['pm1', bucket({ count: 2, inputTokens: 120, outputTokens: 60, costUsd: 0.3 })],
    ['pm2', bucket({ count: 1, inputTokens: 30, outputTokens: 10, costUsd: 0.05 })],
    ['reviewer', bucket({ count: 3, inputTokens: 450, outputTokens: 230, costUsd: 0.85 })],
  ]);
  mockUsageState.bySessionProvider = new Map([
    [
      'session-root',
      new Map([['openai', bucket({ count: 2, inputTokens: 120, outputTokens: 60, costUsd: 0.3 })]]),
    ],
    [
      'session-child',
      new Map([
        ['anthropic', bucket({ count: 1, inputTokens: 30, outputTokens: 10, costUsd: 0.05 })],
      ]),
    ],
    [
      'session-other',
      new Map([
        ['deepseek', bucket({ count: 3, inputTokens: 450, outputTokens: 230, costUsd: 0.85 })],
      ]),
    ],
  ]);
  mockUsageState.bySessionAgent = new Map([
    [
      'session-root',
      new Map([
        ['agent-root', bucket({ count: 2, inputTokens: 120, outputTokens: 60, costUsd: 0.3 })],
      ]),
    ],
    [
      'session-child',
      new Map([
        ['agent-child', bucket({ count: 1, inputTokens: 30, outputTokens: 10, costUsd: 0.05 })],
      ]),
    ],
    [
      'session-other',
      new Map([
        ['agent-other', bucket({ count: 3, inputTokens: 450, outputTokens: 230, costUsd: 0.85 })],
      ]),
    ],
  ]);
  mockUsageState.bySessionLayer = new Map([
    [
      'session-root',
      new Map([['pm1', bucket({ count: 2, inputTokens: 120, outputTokens: 60, costUsd: 0.3 })]]),
    ],
    [
      'session-child',
      new Map([['pm2', bucket({ count: 1, inputTokens: 30, outputTokens: 10, costUsd: 0.05 })]]),
    ],
    [
      'session-other',
      new Map([
        ['reviewer', bucket({ count: 3, inputTokens: 450, outputTokens: 230, costUsd: 0.85 })],
      ]),
    ],
  ]);
  mockUsageState.recent = [
    usageEvent({
      sessionId: 'session-root',
      provider: 'openai',
      layer: 'pm1',
      inputTokens: 120,
      outputTokens: 60,
      costUsd: 0.3,
      timestamp: Date.parse('2026-06-04T16:00:00.000Z'),
    }),
    usageEvent({
      sessionId: 'session-child',
      provider: 'anthropic',
      layer: 'pm2',
      inputTokens: 30,
      outputTokens: 10,
      costUsd: 0.05,
      timestamp: Date.parse('2026-06-04T16:01:00.000Z'),
    }),
    usageEvent({
      sessionId: 'session-other',
      provider: 'deepseek',
      layer: 'reviewer',
      inputTokens: 450,
      outputTokens: 230,
      costUsd: 0.85,
      timestamp: Date.parse('2026-06-04T16:02:00.000Z'),
    }),
  ];
  mockToolCallState.bySession = new Map([
    ['session-root', { invocations: 4, failures: 1 }],
    ['session-child', { invocations: 2, failures: 0 }],
    ['session-other', { invocations: 6, failures: 2 }],
  ]);
  mockToolCallState.totalFailures = 3;
  mockToolCallState.totalInvocations = 12;
  runtimeReferenceState.activeSharedSession = null;
  runtimeReferenceState.selectedSharedSession = null;
  runtimeReferenceState.sharedSessionLoading = false;
  runtimeReferenceState.sharedSessions = [];
});

afterEach(() => {
  cleanup();
});

describe('UsageView', () => {
  it('未选中会话时显示全局聚合', () => {
    render(<UsageView />);

    expect(screen.getByRole('region', { name: '度量工作台摘要' })).toBeTruthy();
    expect(screen.getByText('度量成本面板')).toBeTruthy();
    expect(screen.getByText('全部团队')).toBeTruthy();
    expect(screen.getByText('900')).toBeTruthy();
    expect(screen.getAllByText('12').length).toBeGreaterThan(0);
    expect(screen.getByText('调用次数')).toBeTruthy();
    expect(screen.getByText(hasExactNormalizedText('调用次数6'))).toBeTruthy();
    expect(screen.queryByText(/当前统计范围：/)).toBeNull();
    expect(screen.getByText('最近 3 条调用')).toBeTruthy();
  });

  it('选中会话后按当前会话及子树聚合总览和最近调用', () => {
    mockNodes.set('session-root', {
      sessionId: 'session-root',
      roleLayer: 'pm1',
      parentSessionId: null,
      state: 'running',
    });
    mockNodes.set('session-child', {
      sessionId: 'session-child',
      roleLayer: 'pm2',
      parentSessionId: 'session-root',
      state: 'running',
    });
    mockNodes.set('session-other', {
      sessionId: 'session-other',
      roleLayer: 'reviewer',
      parentSessionId: null,
      state: 'running',
    });

    render(<UsageView selectedSessionId="session-root" selectedSessionTitle="根会话" />);

    expect(screen.getAllByText('根会话').length).toBeGreaterThan(0);
    expect(screen.getAllByText('6').length).toBeGreaterThan(0);
    expect(screen.getByText(hasExactNormalizedText('当前统计范围：根会话 及其子树'))).toBeTruthy();
    expect(screen.getByText(hasExactNormalizedText('调用次数3'))).toBeTruthy();
    expect(screen.getByText('最近 2 条调用')).toBeTruthy();
    expect(screen.queryByText('deepseek')).toBeNull();
    expect(screen.getAllByText('openai').length).toBeGreaterThan(0);
    expect(screen.getAllByText('anthropic').length).toBeGreaterThan(0);
  });

  it('选中共享会话时展示共享快照里的用量与工具统计', () => {
    runtimeReferenceState.sharedSessions = [{ sessionId: 'shared-1', title: '共享会话 A' }];
    runtimeReferenceState.activeSharedSession = {
      share: {
        sessionId: 'shared-1',
        title: '共享会话 A',
      },
      session: {
        messages: [
          {
            id: 'assistant-1',
            role: 'assistant',
            createdAt: Date.parse('2026-06-04T16:00:00.000Z'),
            content: [
              {
                type: 'tool_call',
                toolCallId: 'tool-1',
                toolName: 'read_file',
                input: {},
              },
              {
                type: 'tool_result',
                toolCallId: 'tool-1',
                toolName: 'read_file',
                output: 'ok',
                isError: false,
              },
            ],
            providerUsage: {
              inputTokens: 120,
              outputTokens: 45,
              totalTokens: 165,
            },
          },
          {
            id: 'assistant-2',
            role: 'assistant',
            createdAt: Date.parse('2026-06-04T16:01:00.000Z'),
            content: [
              {
                type: 'tool_call',
                toolCallId: 'tool-2',
                toolName: 'write_file',
                input: {},
              },
              {
                type: 'tool_result',
                toolCallId: 'tool-2',
                toolName: 'write_file',
                output: 'boom',
                isError: true,
              },
            ],
            providerUsage: {
              inputTokens: 80,
              outputTokens: 20,
              totalTokens: 100,
            },
          },
        ],
      },
    };

    render(<UsageView selectedSessionId="shared-1" selectedSessionTitle="共享会话 A" />);

    expect(screen.getByTestId('shared-usage-view')).toBeTruthy();
    expect(screen.getByText(/当前统计范围：共享会话 A（共享会话快照）/)).toBeTruthy();
    expect(screen.getByText(hasExactNormalizedText('assistant响应2'))).toBeTruthy();
    expect(screen.getByText(hasExactNormalizedText('输入token200'))).toBeTruthy();
    expect(screen.getByText(hasExactNormalizedText('输出token65'))).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: /工具调用/i }));

    expect(screen.getByTestId('shared-tool-usage-view')).toBeTruthy();
    expect(screen.getByText('read_file')).toBeTruthy();
    expect(screen.getByText('write_file')).toBeTruthy();
    expect(screen.getByText(hasExactNormalizedText('失败数1'))).toBeTruthy();
  });

  it('active 共享详情不匹配当前会话时，会回退到匹配的 selectedSharedSession', () => {
    runtimeReferenceState.sharedSessions = [{ sessionId: 'shared-1', title: '共享会话 A' }];
    runtimeReferenceState.activeSharedSession = {
      share: {
        sessionId: 'shared-2',
        title: '共享会话 B',
      },
      session: {
        messages: [
          {
            id: 'assistant-other',
            role: 'assistant',
            createdAt: Date.parse('2026-06-04T16:02:00.000Z'),
            content: [],
            providerUsage: {
              inputTokens: 999,
              outputTokens: 111,
              totalTokens: 1110,
            },
          },
        ],
      },
    };
    runtimeReferenceState.selectedSharedSession = {
      share: {
        sessionId: 'shared-1',
        title: '共享会话 A',
      },
      session: {
        messages: [
          {
            id: 'assistant-selected',
            role: 'assistant',
            createdAt: Date.parse('2026-06-04T16:01:00.000Z'),
            content: [],
            providerUsage: {
              inputTokens: 80,
              outputTokens: 20,
              totalTokens: 100,
            },
          },
        ],
      },
    };

    render(<UsageView selectedSessionId="shared-1" selectedSessionTitle="共享会话 A" />);

    expect(screen.getByTestId('shared-usage-view')).toBeTruthy();
    expect(screen.getByText(hasExactNormalizedText('assistant响应1'))).toBeTruthy();
    expect(screen.getByText(hasExactNormalizedText('输入token80'))).toBeTruthy();
    expect(screen.getByText(hasExactNormalizedText('输出token20'))).toBeTruthy();
    expect(screen.queryByText(/999/)).toBeNull();
  });

  it('显式共享态但共享摘要列表尚未同步时，仍走共享用量视图分支', () => {
    runtimeReferenceState.activeSharedSession = null;
    runtimeReferenceState.selectedSharedSession = null;
    runtimeReferenceState.sharedSessions = [];
    runtimeReferenceState.sharedSessionLoading = true;

    const { container } = render(
      <UsageView
        selectedSessionId="shared-1"
        selectedSessionIsShared
        selectedSessionTitle="共享会话 A"
      />,
    );

    expect(screen.getByText('正在同步共享用量')).toBeTruthy();
    expect(container.querySelector('svg')).toBeTruthy();
    expect(screen.queryByText('调用次数')).toBeNull();
  });
});
