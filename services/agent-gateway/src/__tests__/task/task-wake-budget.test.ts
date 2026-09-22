import { beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_CONSECUTIVE_AUTO_WAKES,
  noteManualSessionInteraction,
  readConsecutiveWakeCount,
  resetWakeBudgetForTests,
  tryConsumeWakeBudget,
} from '../../task/task-wake-budget.js';

const SESSION = { sessionId: 'sess-wake-budget', userId: 'u-wake-budget' };

beforeEach(() => {
  resetWakeBudgetForTests();
});

describe('task-wake-budget', () => {
  it('默认允许唤醒并累加计数', () => {
    expect(tryConsumeWakeBudget(SESSION)).toBe(true);
    expect(readConsecutiveWakeCount(SESSION)).toBe(1);
    expect(tryConsumeWakeBudget(SESSION)).toBe(true);
    expect(readConsecutiveWakeCount(SESSION)).toBe(2);
  });

  it('达到上限后拒绝继续唤醒（上限值保持旧机制的 10）', () => {
    expect(MAX_CONSECUTIVE_AUTO_WAKES).toBe(10);

    for (let index = 0; index < MAX_CONSECUTIVE_AUTO_WAKES; index += 1) {
      expect(tryConsumeWakeBudget(SESSION)).toBe(true);
    }
    expect(tryConsumeWakeBudget(SESSION)).toBe(false);
    expect(tryConsumeWakeBudget(SESSION)).toBe(false);
    // 拒绝时不再累加
    expect(readConsecutiveWakeCount(SESSION)).toBe(MAX_CONSECUTIVE_AUTO_WAKES);
  });

  it('用户真实交互重置计数', () => {
    for (let index = 0; index < MAX_CONSECUTIVE_AUTO_WAKES; index += 1) {
      tryConsumeWakeBudget(SESSION);
    }
    expect(tryConsumeWakeBudget(SESSION)).toBe(false);

    noteManualSessionInteraction(SESSION);

    expect(readConsecutiveWakeCount(SESSION)).toBe(0);
    expect(tryConsumeWakeBudget(SESSION)).toBe(true);
  });

  it('计数按 (userId, sessionId) 隔离', () => {
    tryConsumeWakeBudget(SESSION);
    tryConsumeWakeBudget(SESSION);

    expect(readConsecutiveWakeCount({ ...SESSION, sessionId: 'other-session' })).toBe(0);
    expect(readConsecutiveWakeCount({ ...SESSION, userId: 'other-user' })).toBe(0);
    expect(readConsecutiveWakeCount(SESSION)).toBe(2);
  });
});
