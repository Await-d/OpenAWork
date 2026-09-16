import { describe, expect, it, vi } from 'vitest';
import { startStandardChatStream } from './start-standard-chat-stream.js';

describe('startStandardChatStream', () => {
  it('会重置流式 refs、批量设置状态并追加用户消息', () => {
    const setMessages = vi.fn((updater) => updater([]));
    const requestReturnToLatest = vi.fn();
    const result = startStandardChatStream({
      currentAssistantStreamMessageIdRef: { current: null },
      requestReturnToLatest,
      onQueuedMessageConsumed: vi.fn(),
      requestInputParts: [{ type: 'input_image', artifactId: 'a1' }],
      setActiveStreamFirstTokenLatencyMs: vi.fn(),
      setActiveStreamStartedAt: vi.fn(),
      setHasPendingFollowContent: vi.fn(),
      setMessages,
      setReportedStreamUsage: vi.fn(),
      setSessionStateStatus: vi.fn(),
      setShowScrollToBottom: vi.fn(),
      setStoppingStream: vi.fn(),
      setStreamBuffer: vi.fn(),
      setStreamThinkingBlocks: vi.fn(),
      setStreamThinkingBuffer: vi.fn(),
      setStreaming: vi.fn(),
      stoppingStreamRef: { current: true },
      streamRevealNextAllowedAtRef: { current: 9 },
      streamRevealTargetCodePointsRef: { current: ['a'] },
      streamRevealTargetRef: { current: 'x' },
      streamRevealVisibleCodePointCountRef: { current: 3 },
      streamRevealVisibleRef: { current: 'y' },
      streamingRef: { current: false },
      text: 'hello',
    });

    expect(result.requestText).toBe('hello');
    expect(result.displayMessageForStream).toBe('hello');
    expect(setMessages).toHaveBeenCalled();
    // 发送即「用户明确回到最新」：每次启动恰好调用一次，且不再写原始滚动 ref。
    expect(requestReturnToLatest).toHaveBeenCalledTimes(1);
  });

  it('用户消息的有序 ID 早于实时助手占位 ID，保证气泡排在提问之后', () => {
    const currentAssistantStreamMessageIdRef = { current: null as string | null };
    let appended: Array<{ id: string; role: string }> = [];
    startStandardChatStream({
      currentAssistantStreamMessageIdRef,
      requestReturnToLatest: vi.fn(),
      onQueuedMessageConsumed: vi.fn(),
      setActiveStreamFirstTokenLatencyMs: vi.fn(),
      setActiveStreamStartedAt: vi.fn(),
      setHasPendingFollowContent: vi.fn(),
      setMessages: vi.fn((updater) => {
        appended = updater([]).map((message: { id: string; role: string }) => ({
          id: message.id,
          role: message.role,
        }));
        return appended;
      }),
      setReportedStreamUsage: vi.fn(),
      setSessionStateStatus: vi.fn(),
      setShowScrollToBottom: vi.fn(),
      setStoppingStream: vi.fn(),
      setStreamBuffer: vi.fn(),
      setStreamThinkingBlocks: vi.fn(),
      setStreamThinkingBuffer: vi.fn(),
      setStreaming: vi.fn(),
      stoppingStreamRef: { current: false },
      streamRevealNextAllowedAtRef: { current: 0 },
      streamRevealTargetCodePointsRef: { current: [] },
      streamRevealTargetRef: { current: '' },
      streamRevealVisibleCodePointCountRef: { current: 0 },
      streamRevealVisibleRef: { current: '' },
      streamingRef: { current: false },
      text: '没有很多人吐槽这个问题吗',
    });

    const userMessageId = appended.find((message) => message.role === 'user')?.id;
    expect(userMessageId).toBeDefined();
    // 有序 ID 的词序即创建序：用户消息必须先于实时助手占位被铸造。
    expect(userMessageId! < currentAssistantStreamMessageIdRef.current!).toBe(true);
  });

  it('空文本但有图片时会生成上传提示文案', () => {
    const result = startStandardChatStream({
      currentAssistantStreamMessageIdRef: { current: null },
      requestReturnToLatest: vi.fn(),
      onQueuedMessageConsumed: vi.fn(),
      requestInputParts: [{ type: 'input_image', artifactId: 'a1' }],
      setActiveStreamFirstTokenLatencyMs: vi.fn(),
      setActiveStreamStartedAt: vi.fn(),
      setHasPendingFollowContent: vi.fn(),
      setMessages: vi.fn((updater) => updater([])),
      setReportedStreamUsage: vi.fn(),
      setSessionStateStatus: vi.fn(),
      setShowScrollToBottom: vi.fn(),
      setStoppingStream: vi.fn(),
      setStreamBuffer: vi.fn(),
      setStreamThinkingBlocks: vi.fn(),
      setStreamThinkingBuffer: vi.fn(),
      setStreaming: vi.fn(),
      stoppingStreamRef: { current: false },
      streamRevealNextAllowedAtRef: { current: 0 },
      streamRevealTargetCodePointsRef: { current: [] },
      streamRevealTargetRef: { current: '' },
      streamRevealVisibleCodePointCountRef: { current: 0 },
      streamRevealVisibleRef: { current: '' },
      streamingRef: { current: false },
      text: '',
    });

    expect(result.displayMessageForStream).toBe('上传了 1 张图片');
  });
});
