import { describe, expect, it } from 'vitest';
import {
  canonicalClarificationNodeId,
  countActionablePendingClarifications,
  resolveClarificationNodeId,
  resolveSupersededClarificationIds,
} from './clarification-identity.js';

type RoundItem = Parameters<typeof resolveSupersededClarificationIds>[0][number];

function pending(
  id: string,
  extra: { nodeId?: string; round?: number; createdAt?: number } = {},
): RoundItem {
  return {
    id,
    status: 'pending',
    ...extra,
  };
}

describe('canonicalClarificationNodeId', () => {
  it('剥离确认节点的轮次后缀', () => {
    expect(canonicalClarificationNodeId('__grill_confirm__@r3')).toBe('__grill_confirm__');
    expect(canonicalClarificationNodeId('__grill_confirm__@r0')).toBe('__grill_confirm__');
  });

  it('普通节点 id 原样返回', () => {
    expect(canonicalClarificationNodeId('goal')).toBe('goal');
    expect(canonicalClarificationNodeId('constraints')).toBe('constraints');
  });

  it('剥离后为空时保留原 id，避免产生空身份', () => {
    expect(canonicalClarificationNodeId('@r1')).toBe('@r1');
  });
});

describe('resolveClarificationNodeId', () => {
  it('优先使用显式 nodeId', () => {
    expect(resolveClarificationNodeId({ id: 'q@r9', nodeId: 'explicit' })).toBe('explicit');
  });

  it('缺少 nodeId 时从传输 id 推导', () => {
    expect(resolveClarificationNodeId({ id: '__grill_confirm__@r2' })).toBe('__grill_confirm__');
  });
});

describe('resolveSupersededClarificationIds', () => {
  it('同一 nodeId 下只保留最新轮次，旧轮次被标为取代', () => {
    const superseded = resolveSupersededClarificationIds([
      pending('__grill_confirm__@r0', { round: 0 }),
      pending('__grill_confirm__@r1', { round: 1 }),
    ]);

    expect([...superseded]).toEqual(['__grill_confirm__@r0']);
  });

  it('缺少 round 时用 createdAt 判定新旧', () => {
    const superseded = resolveSupersededClarificationIds([
      pending('__grill_confirm__@r0', { createdAt: 10 }),
      pending('__grill_confirm__@r1', { createdAt: 20 }),
    ]);

    expect([...superseded]).toEqual(['__grill_confirm__@r0']);
  });

  it('round 与 createdAt 都相同时按数组顺序：后者更新', () => {
    const superseded = resolveSupersededClarificationIds([
      pending('a@r1', { round: 1, createdAt: 5 }),
      pending('a@r2', { round: 1, createdAt: 5 }),
    ]);

    expect([...superseded]).toEqual(['a@r1']);
  });

  it('不同 nodeId 之间互不取代', () => {
    const superseded = resolveSupersededClarificationIds([
      pending('goal', { round: 0 }),
      pending('constraints', { round: 0 }),
    ]);

    expect(superseded.size).toBe(0);
  });

  it('只有 pending 之间互相取代：已答/已忽略的旧轮次不参与', () => {
    const superseded = resolveSupersededClarificationIds([
      { id: '__grill_confirm__@r0', status: 'answered' },
      pending('__grill_confirm__@r1', { round: 1 }),
    ]);

    expect(superseded.size).toBe(0);
  });
});

describe('countActionablePendingClarifications', () => {
  it('只计可回答的 pending，排除已答/已忽略与被取代轮次', () => {
    const count = countActionablePendingClarifications([
      { id: '__grill_confirm__@r0', status: 'pending', round: 0 },
      pending('__grill_confirm__@r1', { round: 1 }),
      pending('goal', { round: 0 }),
      { id: 'done', status: 'answered' },
      { id: 'ignored', status: 'dismissed' },
    ]);

    expect(count).toBe(2);
  });
});
