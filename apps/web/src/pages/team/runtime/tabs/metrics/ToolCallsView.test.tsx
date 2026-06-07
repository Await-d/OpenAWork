// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const mockNodes = new Map();

function hasExactNormalizedText(expected: string) {
  const normalizedExpected = expected.replace(/\s+/g, '').trim();
  return (_content: string, element: Element | null) =>
    (element?.textContent ?? '').replace(/\s+/g, '').trim() === normalizedExpected;
}

const mockToolState = {
  byTool: new Map(),
  byAgent: new Map(),
  bySession: new Map(),
  byLayer: new Map(),
  bySessionLayer: new Map(),
  bySessionTool: new Map(),
  bySessionAgent: new Map(),
  totalFailures: 3,
  totalInvocations: 6,
};

function toolStats(partial: {
  toolName: string;
  invocations: number;
  successes: number;
  failures: number;
  totalDurationMs: number;
  durations: number[];
  errorSamples?: Array<{ errorType: string; count: number }>;
}) {
  return {
    toolName: partial.toolName,
    invocations: partial.invocations,
    successes: partial.successes,
    failures: partial.failures,
    totalDurationMs: partial.totalDurationMs,
    durations: partial.durations,
    errorSamples: partial.errorSamples ?? [],
  };
}

vi.mock('../../../../../stores/team/team-events.js', () => ({
  useLayerStore: (selector: (state: { nodes: typeof mockNodes }) => unknown) =>
    selector({ nodes: mockNodes }),
}));

vi.mock('../../../../../stores/team/team-usage.js', () => ({
  quantile: (sorted: number[], q: number) => {
    if (sorted.length === 0) return 0;
    const pos = (sorted.length - 1) * q;
    const base = Math.floor(pos);
    const rest = pos - base;
    const next = sorted[base + 1];
    const baseVal = sorted[base] ?? 0;
    return next !== undefined ? baseVal + rest * (next - baseVal) : baseVal;
  },
  useTeamToolCallStore: (selector: (state: typeof mockToolState) => unknown) =>
    selector(mockToolState),
}));

import { ToolCallsView } from './ToolCallsView.js';

beforeEach(() => {
  cleanup();
  mockNodes.clear();
  mockToolState.byTool = new Map([
    [
      'read',
      toolStats({
        toolName: 'read',
        invocations: 6,
        successes: 3,
        failures: 3,
        totalDurationMs: 6000,
        durations: [800, 900, 1000, 1100, 1200, 1000],
        errorSamples: [{ errorType: 'timeout', count: 3 }],
      }),
    ],
  ]);
  mockToolState.byAgent = new Map([['agent-global', new Map([['read', 6]])]]);
  mockToolState.bySession = new Map([
    ['session-root', { invocations: 2, failures: 1 }],
    ['session-child', { invocations: 1, failures: 0 }],
    ['session-other', { invocations: 3, failures: 2 }],
  ]);
  mockToolState.byLayer = new Map([
    ['pm1', { invocations: 2, failures: 1 }],
    ['pm2', { invocations: 1, failures: 0 }],
    ['reviewer', { invocations: 3, failures: 2 }],
  ]);
  mockToolState.bySessionLayer = new Map([
    ['session-root', new Map([['pm1', { invocations: 2, failures: 1 }]])],
    ['session-child', new Map([['pm2', { invocations: 1, failures: 0 }]])],
    ['session-other', new Map([['reviewer', { invocations: 3, failures: 2 }]])],
  ]);
  mockToolState.bySessionTool = new Map([
    [
      'session-root',
      new Map([
        [
          'read',
          toolStats({
            toolName: 'read',
            invocations: 2,
            successes: 1,
            failures: 1,
            totalDurationMs: 2000,
            durations: [900, 1100],
            errorSamples: [{ errorType: 'timeout', count: 1 }],
          }),
        ],
      ]),
    ],
    [
      'session-child',
      new Map([
        [
          'write',
          toolStats({
            toolName: 'write',
            invocations: 1,
            successes: 1,
            failures: 0,
            totalDurationMs: 400,
            durations: [400],
          }),
        ],
      ]),
    ],
    [
      'session-other',
      new Map([
        [
          'review',
          toolStats({
            toolName: 'review',
            invocations: 3,
            successes: 1,
            failures: 2,
            totalDurationMs: 3600,
            durations: [1000, 1200, 1400],
            errorSamples: [{ errorType: 'timeout', count: 2 }],
          }),
        ],
      ]),
    ],
  ]);
  mockToolState.bySessionAgent = new Map([
    ['session-root', new Map([['agent-root', new Map([['read', 2]])]])],
    ['session-child', new Map([['agent-child', new Map([['write', 1]])]])],
    ['session-other', new Map([['agent-other', new Map([['review', 3]])]])],
  ]);
  mockToolState.totalFailures = 3;
  mockToolState.totalInvocations = 6;
});

afterEach(() => {
  cleanup();
});

describe('ToolCallsView', () => {
  it('未选中会话时显示全局工具聚合', () => {
    render(<ToolCallsView />);

    expect(screen.getByText('总调用数')).toBeTruthy();
    expect(screen.getByText(hasExactNormalizedText('总调用数6'))).toBeTruthy();
    expect(screen.getAllByText('read').length).toBeGreaterThan(0);
    expect(screen.queryByText(/当前统计范围：/)).toBeNull();
  });

  it('选中会话后只展示当前会话及子树工具统计', () => {
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

    render(<ToolCallsView selectedSessionId="session-root" selectedSessionTitle="根会话" />);

    expect(screen.getByText(hasExactNormalizedText('当前统计范围：根会话 及其子树'))).toBeTruthy();
    expect(screen.getByText(hasExactNormalizedText('总调用数3'))).toBeTruthy();
    expect(screen.getAllByText('write').length).toBeGreaterThan(0);
    expect(screen.getAllByText('read').length).toBeGreaterThan(0);
    expect(screen.queryByText('review')).toBeNull();
    expect(screen.queryByText('agent-other')).toBeNull();
    expect(screen.getByText('agent-root')).toBeTruthy();
    expect(screen.getByText('agent-child')).toBeTruthy();
  });
});
