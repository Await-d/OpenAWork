import { describe, expect, it, vi } from 'vitest';
import { submitImageGeneration } from './submit-image-generation.js';

describe('submitImageGeneration', () => {
  it('成功时会追加用户消息、更新结果并刷新会话列表', async () => {
    const setMessages = vi.fn((updater) => updater([]));
    const appendImageGenerationSummaryMessage = vi.fn();
    const setLatestGeneratedImageResult = vi.fn();
    const setSessionReloadNonce = vi.fn();
    const requestSessionListRefresh = vi.fn();
    const toast = vi.fn();
    const onQueuedMessageConsumed = vi.fn();
    const activeSessionRef = { current: 's1' } as React.MutableRefObject<string | null>;

    const ok = await submitImageGeneration({
      activeSessionRef,
      appendImageGenerationSummaryMessage,
      generateImageForSession: vi.fn(async () => ({
        artifact: { id: 'art-1', title: 'img-1', type: 'image' as const },
        revisedPrompt: null,
        parameters: {
          background: 'auto' as const,
          modelId: 'model-1',
          outputFormat: 'png' as const,
          providerId: 'provider-1',
          quality: 'medium' as const,
          size: '1024x1024' as const,
        },
        messageSummary: 'done',
      })),
      imageModelLabel: 'model label',
      onError: vi.fn(),
      onQueuedMessageConsumed,
      requestSessionListRefresh,
      sessionId: 's1',
      setLatestGeneratedImageResult,
      setMessages,
      setSessionReloadNonce,
      sourcePrompt: 'draw cat',
      toast,
    });

    expect(ok).toBe(true);
    expect(setMessages).toHaveBeenCalled();
    expect(onQueuedMessageConsumed).toHaveBeenCalled();
    expect(appendImageGenerationSummaryMessage).toHaveBeenCalled();
    expect(setLatestGeneratedImageResult).toHaveBeenCalled();
    expect(setSessionReloadNonce).toHaveBeenCalled();
    expect(requestSessionListRefresh).toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith('图片已生成，可在产物工作区查看。', 'success');
  });

  it('失败时会通过 onError 回填错误', async () => {
    const onError = vi.fn();
    const activeSessionRef = { current: 's1' } as React.MutableRefObject<string | null>;

    const ok = await submitImageGeneration({
      activeSessionRef,
      appendImageGenerationSummaryMessage: vi.fn(),
      generateImageForSession: vi.fn(async () => {
        throw new Error('boom');
      }),
      imageModelLabel: '',
      onError,
      onQueuedMessageConsumed: vi.fn(),
      requestSessionListRefresh: vi.fn(),
      sessionId: 's1',
      setLatestGeneratedImageResult: vi.fn(),
      setMessages: vi.fn((updater) => updater([])),
      setSessionReloadNonce: vi.fn(),
      sourcePrompt: 'draw cat',
      toast: vi.fn(),
    });

    expect(ok).toBe(false);
    expect(onError).toHaveBeenCalledWith('boom');
  });
});
