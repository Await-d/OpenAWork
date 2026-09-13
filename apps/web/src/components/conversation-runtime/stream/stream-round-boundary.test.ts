import { describe, expect, it } from 'vitest';
import {
  hasGatewayAdvancedRound,
  hasLandedToolResult,
  resolveNextRoundIndex,
  shouldStartNewRound,
} from './stream-round-boundary.js';

describe('hasGatewayAdvancedRound', () => {
  it('网关回报的轮次达到当前累积轮次时判定为已推进', () => {
    expect(hasGatewayAdvancedRound({ currentRoundIndex: 2, lastCompletedRound: 2 })).toBe(true);
    expect(hasGatewayAdvancedRound({ currentRoundIndex: 2, lastCompletedRound: 3 })).toBe(true);
  });

  it('usage 未知或落后于当前轮次时不算推进', () => {
    expect(hasGatewayAdvancedRound({ currentRoundIndex: 2, lastCompletedRound: null })).toBe(false);
    expect(hasGatewayAdvancedRound({ currentRoundIndex: 3, lastCompletedRound: 2 })).toBe(false);
  });
});

describe('hasLandedToolResult', () => {
  it('没有工具调用时说明还没到轮次边界', () => {
    expect(hasLandedToolResult([])).toBe(false);
  });

  it('工具仍在流式输出（无 tool_result）时不切轮', () => {
    expect(hasLandedToolResult([{ status: 'streaming' }, { status: 'streaming' }])).toBe(false);
  });

  it('任一工具已经拿到结果即视为本轮已结束', () => {
    expect(hasLandedToolResult([{ status: 'streaming' }, { status: 'completed' }])).toBe(true);
  });

  it('暂停等待审批与执行失败都算已落地的工具结果', () => {
    expect(hasLandedToolResult([{ status: 'paused' }])).toBe(true);
    expect(hasLandedToolResult([{ status: 'error' }])).toBe(true);
  });

  it('缺少 status 的工具条目不会误判为已落地', () => {
    expect(hasLandedToolResult([{}])).toBe(false);
  });
});

describe('shouldStartNewRound', () => {
  it('网关已回报当前轮完成时（即便没有任何工具）也要开新一轮', () => {
    expect(
      shouldStartNewRound({
        currentRoundIndex: 1,
        lastCompletedRound: 1,
        toolCalls: [],
      }),
    ).toBe(true);
  });

  it('网关回报的轮次落后于当前累积轮次时不切轮', () => {
    expect(
      shouldStartNewRound({
        currentRoundIndex: 3,
        lastCompletedRound: 2,
        toolCalls: [],
      }),
    ).toBe(false);
  });

  it('usage 不可用时回落到工具结果信号', () => {
    expect(
      shouldStartNewRound({
        currentRoundIndex: 1,
        lastCompletedRound: null,
        toolCalls: [{ status: 'streaming' }],
      }),
    ).toBe(false);
    expect(
      shouldStartNewRound({
        currentRoundIndex: 1,
        lastCompletedRound: null,
        toolCalls: [{ status: 'completed' }],
      }),
    ).toBe(true);
  });
});

describe('resolveNextRoundIndex', () => {
  it('按网关回报的轮次向前推进，跳过本地未观察到的轮次', () => {
    expect(resolveNextRoundIndex({ currentRoundIndex: 1, lastCompletedRound: 5 })).toBe(6);
  });

  it('没有 usage 信息时只推进一轮', () => {
    expect(resolveNextRoundIndex({ currentRoundIndex: 2, lastCompletedRound: null })).toBe(3);
    expect(resolveNextRoundIndex({ currentRoundIndex: 2, lastCompletedRound: 1 })).toBe(3);
  });
});
