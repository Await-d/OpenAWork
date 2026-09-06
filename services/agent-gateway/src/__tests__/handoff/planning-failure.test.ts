import { describe, expect, it } from 'vitest';
import { nextPlanningRound, PlanningFailure } from '../../handoff/capability/planning-failure.js';

describe('规划失败终止协议', () => {
  it('新 handoff 的 retry_count 为零时保留跨轮进度', () => {
    let round = 0;
    for (let index = 0; index < 4; index += 1) {
      round = nextPlanningRound({ globalEscalationRound: round }, 0);
      expect(round).toBe(index + 1);
    }
  });
  it('忽略损坏的轮次并保留最大的有效计数', () => {
    expect(nextPlanningRound({ globalEscalationRound: NaN, escalationRound: 2 }, 0)).toBe(3);
    expect(nextPlanningRound(null, 3)).toBe(4);
  });
  it('失败原因要求人工介入，不能进入自动降级派发', () => {
    expect(new PlanningFailure('缺少有效任务').message).toMatch(
      /^planning-generation-failed:.*需要用户介入/,
    );
  });
});
