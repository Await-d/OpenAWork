import { describe, expect, it, vi } from 'vitest';
import { startStandardChatStream } from './start-standard-chat-stream.js';

describe('startStandardChatStream', () => {
  it('会重置流式 refs、批量设置状态并追加用户消息', () => {
    const setMessages = vi.fn((updater) => updater([]));
    const result = startStandardChatStream({
      currentAssistantStreamMessageIdRef: { current: null },
      isNearBottomRef: { current: false },
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
  });

  it('空文本但有图片时会生成上传提示文案', () => {
    const result = startStandardChatStream({
      currentAssistantStreamMessageIdRef: { current: null },
      isNearBottomRef: { current: false },
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
