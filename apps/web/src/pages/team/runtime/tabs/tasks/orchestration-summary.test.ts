import { describe, expect, it } from 'vitest';
import {
  formatDispatchStats,
  formatOrchestrationDepth,
  readDispatchStats,
  readOrchestrationDepth,
} from './orchestration-summary.js';

describe('readOrchestrationDepth', () => {
  it.each(['L0', 'L1', 'L2', 'L3'] as const)('读取合法深度 %s', (depth) => {
    expect(readOrchestrationDepth({ orchestrationDepth: depth })).toBe(depth);
  });

  it.each([
    ['缺字段', {}],
    ['未知值', { orchestrationDepth: 'L9' }],
    ['类型不符', { orchestrationDepth: 2 }],
    ['payload 为 null', null],
    ['payload 为数组', []],
    ['payload 为字符串', 'orchestrationDepth'],
  ])('%s 时返回 null，不编造深度', (_label, payload) => {
    expect(readOrchestrationDepth(payload)).toBeNull();
  });

  it('深度标签可读', () => {
    expect(formatOrchestrationDepth('L1')).toContain('小改动');
    expect(formatOrchestrationDepth('L2')).toContain('同模块');
  });
});

describe('readDispatchStats', () => {
  it('读取成功路径统计', () => {
    expect(readDispatchStats({ parsedCount: 3, dispatchedCount: 3, cap: 8, truncated: 0 })).toEqual(
      {
        parsedCount: 3,
        dispatchedCount: 3,
        cap: 8,
        truncated: 0,
        undispatched: [],
      },
    );
  });

  it('兼容旧字段名 parsedTaskCount / packageCount', () => {
    expect(readDispatchStats({ parsedTaskCount: 5, packageCount: 0 })?.dispatchedCount).toBe(0);
    expect(readDispatchStats({ parsedTaskCount: 5, packageCount: 0 })?.parsedCount).toBe(5);
  });

  it('读取被截断清单为可读行', () => {
    const stats = readDispatchStats({
      parsedCount: 12,
      dispatchedCount: 0,
      cap: 8,
      truncated: 12,
      undispatched: [
        { taskId: 'T001', title: '实现订单接口' },
        { taskId: 'T002' },
        { title: '缺少 taskId' },
        'not-an-object',
      ],
    });
    expect(stats?.truncated).toBe(12);
    expect(stats?.undispatched).toEqual(['T001: 实现订单接口', 'T002: （无标题）']);
  });

  it.each([
    ['没有统计字段', { qualityReviewPending: true }],
    ['resultJson 为 null', null],
    ['resultJson 为数组', []],
  ])('%s 时返回 null，面板跳过渲染而不是显示一排 0', (_label, resultJson) => {
    expect(readDispatchStats(resultJson)).toBeNull();
  });

  it('摘要含解析、派发、上限，截断时补计数', () => {
    expect(
      formatDispatchStats({
        parsedCount: 3,
        dispatchedCount: 3,
        cap: 8,
        truncated: 0,
        undispatched: [],
      }),
    ).toBe('解析 3 / 派发 3 / 上限 8');
    expect(
      formatDispatchStats({
        parsedCount: 3,
        dispatchedCount: 3,
        cap: 0,
        truncated: 1,
        undispatched: [],
      }),
    ).toBe('解析 3 / 派发 3 / 未设上限 / 被截断 1');
  });
});
