import { describe, expect, it } from 'vitest';
import { mergeReasoningDisplayBlocks, type ReasoningDisplayBlock } from './reasoning-ui.js';

describe('mergeReasoningDisplayBlocks', () => {
  it('空数组返回 null', () => {
    expect(mergeReasoningDisplayBlocks([])).toBeNull();
  });

  it('单个块保留文本、数量与结束态，并按时间跨度推导 durationMs', () => {
    const merged = mergeReasoningDisplayBlocks([
      { id: 'r1', text: '先看入口', startedAt: 100, endedAt: 160, ended: true },
    ]);

    expect(merged).toEqual({
      id: 'r1',
      text: '先看入口',
      count: 1,
      startedAt: 100,
      endedAt: 160,
      ended: true,
      durationMs: 60,
    });
  });

  it('多个块按出现顺序用空行拼接，空白文本被跳过', () => {
    const merged = mergeReasoningDisplayBlocks([
      { id: 'r1', text: '第一段' },
      { id: 'r2', text: '   ' },
      { id: 'r3', text: '第二段' },
    ]);

    expect(merged?.id).toBe('r1');
    expect(merged?.count).toBe(3);
    expect(merged?.text).toBe('第一段\n\n第二段');
  });

  it('任一块 ended 为 false 时合并结果为未结束', () => {
    const merged = mergeReasoningDisplayBlocks([
      { id: 'r1', text: 'a', ended: true },
      { id: 'r2', text: 'b', ended: false },
    ]);

    expect(merged?.ended).toBe(false);
  });

  it('缺省 ended 的块按已结束处理', () => {
    const merged = mergeReasoningDisplayBlocks([
      { id: 'r1', text: 'a' },
      { id: 'r2', text: 'b', ended: undefined },
    ]);

    expect(merged?.ended).toBe(true);
  });

  it('所有块都带 durationMs 时求和', () => {
    const merged = mergeReasoningDisplayBlocks([
      { id: 'r1', text: 'a', durationMs: 120, startedAt: 0, endedAt: 999 },
      { id: 'r2', text: 'b', durationMs: 80, startedAt: 0, endedAt: 999 },
    ]);

    expect(merged?.durationMs).toBe(200);
  });

  it('部分块缺少 durationMs 时回退到 endedAt - startedAt', () => {
    const merged = mergeReasoningDisplayBlocks([
      { id: 'r1', text: 'a', durationMs: 120, startedAt: 100, endedAt: 300 },
      { id: 'r2', text: 'b', startedAt: 200, endedAt: 400 },
    ]);

    expect(merged?.durationMs).toBe(300);
  });

  it('startedAt 取最早值、endedAt 取最晚值', () => {
    const merged = mergeReasoningDisplayBlocks([
      { id: 'r1', text: 'a', startedAt: 300, endedAt: 320 },
      { id: 'r2', text: 'b', startedAt: 100, endedAt: 500 },
      { id: 'r3', text: 'c', startedAt: 200, endedAt: 400 },
    ]);

    expect(merged?.startedAt).toBe(100);
    expect(merged?.endedAt).toBe(500);
  });

  it('无任何时间信息时不产生 durationMs', () => {
    const merged = mergeReasoningDisplayBlocks([
      { id: 'r1', text: 'a' },
      { id: 'r2', text: 'b' },
    ]);

    expect(merged?.durationMs).toBeUndefined();
  });

  it('不修改入参数组与块对象', () => {
    const blocks: ReasoningDisplayBlock[] = [
      { id: 'r1', text: 'a', startedAt: 10, endedAt: 20, durationMs: 10, ended: true },
      { id: 'r2', text: 'b', startedAt: 30, endedAt: 40, durationMs: 10, ended: false },
    ];
    const snapshot = structuredClone(blocks);

    mergeReasoningDisplayBlocks(blocks);

    expect(blocks).toEqual(snapshot);
    expect(blocks).toHaveLength(2);
  });
});
