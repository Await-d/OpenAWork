import { describe, expect, it } from 'vitest';
import type { AttachStreamEligibilityInput } from './attach-stream-eligibility.js';
import {
  isAttachStreamTerminal,
  resolveAttachEffectDisposition,
  shouldCancelAttachRetry,
} from './attach-stream-eligibility.js';

function createEligibility(
  overrides: Partial<AttachStreamEligibilityInput> = {},
): AttachStreamEligibilityInput {
  return {
    activeGatewayStreamSessionId: null,
    currentSessionId: 'session-1',
    isPageActive: true,
    isSessionSnapshotReady: true,
    recoveryActiveStreamPresent: false,
    sessionModesHydrated: true,
    sessionStateStatus: 'running',
    streaming: false,
    ...overrides,
  };
}

describe('shouldCancelAttachRetry', () => {
  const cases: Array<{
    name: string;
    input: {
      retryScheduledSessionId: string | null;
      currentSessionId: string | null;
      isPageActive: boolean;
    };
    expected: boolean;
  }> = [
    {
      name: '同一会话时保留重试',
      input: {
        retryScheduledSessionId: 'session-1',
        currentSessionId: 'session-1',
        isPageActive: true,
      },
      expected: false,
    },
    {
      name: '会话已切换时取消重试',
      input: {
        retryScheduledSessionId: 'session-1',
        currentSessionId: 'session-2',
        isPageActive: true,
      },
      expected: true,
    },
    {
      name: '页面失活（同一会话）时取消重试',
      input: {
        retryScheduledSessionId: 'session-1',
        currentSessionId: 'session-1',
        isPageActive: false,
      },
      expected: true,
    },
    {
      name: '没有待重试会话时永不取消（会话不同）',
      input: {
        retryScheduledSessionId: null,
        currentSessionId: 'session-2',
        isPageActive: true,
      },
      expected: false,
    },
    {
      name: '没有待重试会话时永不取消（页面失活）',
      input: {
        retryScheduledSessionId: null,
        currentSessionId: 'session-1',
        isPageActive: false,
      },
      expected: false,
    },
  ];

  for (const testCase of cases) {
    it(testCase.name, () => {
      expect(shouldCancelAttachRetry(testCase.input)).toBe(testCase.expected);
    });
  }
});

describe('isAttachStreamTerminal', () => {
  const cases: Array<{
    name: string;
    overrides: Partial<AttachStreamEligibilityInput>;
    expected: boolean;
  }> = [
    {
      name: '显式 idle + 无恢复流 + 网关无活跃流视为终态',
      overrides: {
        activeGatewayStreamSessionId: null,
        recoveryActiveStreamPresent: false,
        sessionStateStatus: 'idle',
      },
      expected: true,
    },
    {
      name: 'running 不是终态',
      overrides: { sessionStateStatus: 'running' },
      expected: false,
    },
    {
      name: 'sessionStateStatus 为 null（未收敛）不是终态',
      overrides: { sessionStateStatus: null },
      expected: false,
    },
    {
      name: '存在恢复流不是终态',
      overrides: { recoveryActiveStreamPresent: true, sessionStateStatus: 'idle' },
      expected: false,
    },
    {
      name: '网关活跃流仍指向当前会话不是终态',
      overrides: { activeGatewayStreamSessionId: 'session-1', sessionStateStatus: 'idle' },
      expected: false,
    },
    {
      name: '页面失活不是终态',
      overrides: { isPageActive: false, sessionStateStatus: 'idle' },
      expected: false,
    },
    {
      name: '无当前会话不是终态',
      overrides: { currentSessionId: null, sessionStateStatus: 'idle' },
      expected: false,
    },
  ];

  for (const testCase of cases) {
    it(testCase.name, () => {
      expect(isAttachStreamTerminal(createEligibility(testCase.overrides))).toBe(testCase.expected);
    });
  }
});

describe('resolveAttachEffectDisposition', () => {
  it('会话切换优先于一切（即使满足终态条件）', () => {
    expect(
      resolveAttachEffectDisposition({
        eligibility: createEligibility({
          currentSessionId: 'session-2',
          sessionStateStatus: 'idle',
        }),
        retryScheduledSessionId: 'session-1',
        retryExhausted: false,
      }),
    ).toBe('cancel_retry');
  });

  it('页面失活优先于一切', () => {
    expect(
      resolveAttachEffectDisposition({
        eligibility: createEligibility({ isPageActive: false }),
        retryScheduledSessionId: 'session-1',
        retryExhausted: false,
      }),
    ).toBe('cancel_retry');
  });

  it('存在待触发重连且 idle 时进入终态', () => {
    expect(
      resolveAttachEffectDisposition({
        eligibility: createEligibility({ sessionStateStatus: 'idle' }),
        retryScheduledSessionId: 'session-1',
        retryExhausted: false,
      }),
    ).toBe('terminal');
  });

  it('无待触发重连的稳态 idle 回落为 skip，不触发终态收敛副作用', () => {
    expect(
      resolveAttachEffectDisposition({
        eligibility: createEligibility({
          activeGatewayStreamSessionId: null,
          recoveryActiveStreamPresent: false,
          sessionStateStatus: 'idle',
        }),
        retryScheduledSessionId: null,
        retryExhausted: false,
      }),
    ).toBe('skip');
  });

  it('重试耗尽即使仍满足 attach 条件也进入终态', () => {
    expect(
      resolveAttachEffectDisposition({
        eligibility: createEligibility({ sessionStateStatus: 'running' }),
        retryScheduledSessionId: null,
        retryExhausted: true,
      }),
    ).toBe('terminal');
  });

  it('条件未收敛且非终态时为 skip（保留待触发重试）', () => {
    expect(
      resolveAttachEffectDisposition({
        eligibility: createEligibility({
          activeGatewayStreamSessionId: null,
          recoveryActiveStreamPresent: false,
          sessionStateStatus: 'running',
          streaming: true,
        }),
        retryScheduledSessionId: 'session-1',
        retryExhausted: false,
      }),
    ).toBe('skip');
  });

  it('页面失活且无待重试时为 skip（先判终态失败再判 attach 条件）', () => {
    expect(
      resolveAttachEffectDisposition({
        eligibility: createEligibility({ isPageActive: false, sessionStateStatus: null }),
        retryScheduledSessionId: null,
        retryExhausted: false,
      }),
    ).toBe('skip');
  });

  it('满足 attach 条件且有待触发重试时为 proceed', () => {
    expect(
      resolveAttachEffectDisposition({
        eligibility: createEligibility({
          activeGatewayStreamSessionId: 'session-1',
          sessionStateStatus: 'running',
        }),
        retryScheduledSessionId: 'session-1',
        retryExhausted: false,
      }),
    ).toBe('proceed');
  });
});
