import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useThrottledStreamingContent } from './streaming-markdown-content.js';

/**
 * 流式 Markdown 的降频语义。
 *
 * 背景：单次完整 Markdown 解析在 40KB 文本上约 58ms，逐帧重解析会把主线程占满
 * （会话运行时滚动 / 输入 / 审批按钮点击都明显迟滞）。降频后必须保证：
 * - 短文本不做任何延迟（逐字显示手感不变，也不引入额外定时器）；
 * - 长文本进入节流区间后，`content` 的每次增长**不再**立刻触发重解析；
 * - 最新内容在节流窗口结束时补齐（不丢字）；
 * - 卸载后残留定时器不得再更新已卸载组件。
 */

const SHORT_CONTENT = '第一段正文。';
const LONG_CONTENT = '这是一段较长的助手输出。\n\n'.repeat(200);

function append(content: string, suffix: string): string {
  return `${content}${suffix}`;
}

describe('useThrottledStreamingContent', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('短文本直接跟随内容，不经过节流窗口', () => {
    const { result, rerender } = renderHook(
      ({ content }: { content: string }) => useThrottledStreamingContent(content),
      { initialProps: { content: SHORT_CONTENT } },
    );

    expect(result.current).toBe(SHORT_CONTENT);

    const next = append(SHORT_CONTENT, '第二段。');
    rerender({ content: next });

    expect(result.current).toBe(next);
  });

  it('长文本跨档后先补齐一次，随后增量按节流窗口提交', () => {
    const { result, rerender } = renderHook(
      ({ content }: { content: string }) => useThrottledStreamingContent(content),
      { initialProps: { content: SHORT_CONTENT } },
    );

    // 跨过直接渲染阈值：落后太多时先用最新内容渲染，避免闪回旧内容。
    rerender({ content: LONG_CONTENT });
    expect(result.current).toBe(LONG_CONTENT);

    // 定时器追平一次，建立节流基线（真实环境为首个宏任务）。
    act(() => {
      vi.advanceTimersByTime(0);
    });

    const throttledTarget = append(LONG_CONTENT, '【新增增量】');
    rerender({ content: throttledTarget });

    // 节流窗口未到时不得立刻重解析整篇文本。
    expect(result.current).toBe(LONG_CONTENT);

    act(() => {
      vi.advanceTimersByTime(80);
    });

    expect(result.current).toBe(throttledTarget);
  });

  it('内容被替换为另一段文本时立即跟随，不残留上一段', () => {
    const { result, rerender } = renderHook(
      ({ content }: { content: string }) => useThrottledStreamingContent(content),
      { initialProps: { content: LONG_CONTENT } },
    );

    // 建立节流基线：displayed 追平上一段输出。
    act(() => {
      vi.advanceTimersByTime(0);
    });

    // 会话切换 / 重试：内容不再是上一段的前缀延续，且更短（不足以触发「落后一半」
    // 兜底）。此处若不立即跟随，就会把上一段文本继续显示到新内容里。
    const replaced = '另一段完全不同的内容。\n\n'.repeat(160);
    expect(replaced.length).toBeGreaterThan(2_000);
    // 确保「落后一半」兜底不成立：只有前缀检查能拦住这次替换。
    expect(LONG_CONTENT.length * 2).toBeGreaterThan(replaced.length);

    rerender({ content: replaced });

    expect(result.current).toBe(replaced);

    // 替换后基线立即让位（下一拍就追平），随后的追加重新回到节流窗口。
    act(() => {
      vi.advanceTimersByTime(0);
    });
    const appended = `${replaced}【追加】`;
    rerender({ content: appended });
    expect(result.current).toBe(replaced);

    act(() => {
      vi.advanceTimersByTime(80);
    });
    expect(result.current).toBe(appended);
  });

  it('卸载后残留定时器不再更新结果', () => {
    const { rerender, unmount } = renderHook(
      ({ content }: { content: string }) => useThrottledStreamingContent(content),
      { initialProps: { content: LONG_CONTENT } },
    );

    rerender({ content: append(LONG_CONTENT, '增量') });
    unmount();

    expect(() => {
      vi.advanceTimersByTime(200);
    }).not.toThrow();
  });
});
