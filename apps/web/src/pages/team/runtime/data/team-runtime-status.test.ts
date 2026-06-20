import { describe, expect, it } from 'vitest';
import {
  formatTeamRuntimeSemanticStatus,
  mapSemanticStatusToSidebarStatus,
  resolveScopedTeamRuntimeStatus,
  resolveSessionTreeTeamRuntimeStatus,
} from './team-runtime-status.js';

describe('resolveScopedTeamRuntimeStatus', () => {
  it('有活跃 handoff 时，压过滞后的 idle 状态', () => {
    expect(
      resolveScopedTeamRuntimeStatus({
        stateStatus: 'idle',
        handoffs: [
          {
            fromSessionId: 'root',
            paused: false,
            sessionId: 'root',
            state: 'running',
            toSessionId: 'root',
          },
        ],
      }),
    ).toBe('running');
  });

  it('有运行中 runtime task 时，压过滞后的 paused 状态', () => {
    expect(
      resolveScopedTeamRuntimeStatus({
        stateStatus: 'paused',
        runtimeTasks: [{ sessionId: 'root', status: 'running' }],
      }),
    ).toBe('running');
  });

  it('没有活跃工作时，显式 paused 仍返回 paused', () => {
    expect(
      resolveScopedTeamRuntimeStatus({
        stateStatus: 'paused',
        handoffs: [
          {
            fromSessionId: 'root',
            paused: true,
            sessionId: 'root',
            state: 'cancelled',
            toSessionId: 'root',
          },
        ],
      }),
    ).toBe('paused');
  });

  it('没有任何执行证据时保留 idle', () => {
    expect(
      resolveScopedTeamRuntimeStatus({
        stateStatus: 'idle',
      }),
    ).toBe('idle');
  });
});

describe('resolveSessionTreeTeamRuntimeStatus', () => {
  it('会把子会话里的活跃 handoff 计入根会话运行态', () => {
    expect(
      resolveSessionTreeTeamRuntimeStatus({
        rootSessionId: 'root',
        sessions: [
          { id: 'root', parentSessionId: null },
          { id: 'child', parentSessionId: 'root' },
        ],
        stateStatus: 'idle',
        handoffs: [
          {
            fromSessionId: 'child',
            paused: false,
            sessionId: 'child',
            state: 'claimed',
            toSessionId: 'child',
          },
        ],
      }),
    ).toBe('running');
  });
});

describe('status mappers', () => {
  it('idle 在 sidebar 中不再显示为 paused', () => {
    expect(mapSemanticStatusToSidebarStatus('idle')).toBe('completed');
  });

  it('idle 的文案显示为已空闲', () => {
    expect(formatTeamRuntimeSemanticStatus('idle')).toBe('已空闲');
  });
});
