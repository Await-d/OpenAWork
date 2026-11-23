import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { UnifiedComposerSubmitPayload } from '../../../components/chat/composer/UnifiedComposer.js';
import type { ModelSelectionSource } from '../conversation/settings/model-selection-source.js';
import { useChatComposerActions } from './use-chat-composer-actions.js';

function setup() {
  const deps = {
    sendMessage: vi.fn().mockResolvedValue(false),
    stopActiveMessage: vi.fn(),
    setActiveProviderId: vi.fn(),
    setActiveModelId: vi.fn(),
    setThinkingEnabled: vi.fn(),
    setReasoningEffort: vi.fn(),
    sessionModelSelectionSourceRef: { current: null as ModelSelectionSource | null },
    markSessionMetadataDirty: vi.fn(),
    markThinkingOverride: vi.fn(),
  };
  return { deps, ...renderHook(() => useChatComposerActions(deps)) };
}

describe('useChatComposerActions', () => {
  it('完整传递附件及队列幂等标识，并保留发送失败结果', async () => {
    const { result, deps } = setup();
    const payload = {
      text: '发送附件',
      files: [new File(['内容'], '附件.txt')],
      attachmentItems: [],
      queuedMessageId: 'queue-a',
    } as unknown as UnifiedComposerSubmitPayload;
    await expect(result.current.onComposerSubmit(payload)).resolves.toBe(false);
    expect(deps.sendMessage).toHaveBeenCalledExactlyOnceWith('发送附件', {
      queuedFiles: payload.files,
      queuedAttachmentItems: payload.attachmentItems,
      queuedMessageId: 'queue-a',
    });
  });

  it('切模型不改写会话思考偏好，记录手动来源并标记 metadata 脏', async () => {
    const { result, deps } = setup();
    await act(() => result.current.onComposerModelSelect('provider-a', 'plain-model'));
    expect(deps.setActiveProviderId).toHaveBeenCalledWith('provider-a');
    expect(deps.setActiveModelId).toHaveBeenCalledWith('plain-model');
    expect(deps.setThinkingEnabled).not.toHaveBeenCalled();
    expect(deps.setReasoningEffort).not.toHaveBeenCalled();
    expect(deps.sessionModelSelectionSourceRef.current).toBe('manual');
    expect(deps.markSessionMetadataDirty).toHaveBeenCalledTimes(1);
    expect(deps.markThinkingOverride).not.toHaveBeenCalled();
  });

  it('思考配置修改持久化标记且停止走既有回调', () => {
    const { result, deps } = setup();
    result.current.onThinkingEnabledChange(false);
    result.current.onReasoningEffortChange('low');
    result.current.onStopComposer();
    expect(deps.setThinkingEnabled).toHaveBeenCalledWith(false);
    expect(deps.setReasoningEffort).toHaveBeenCalledWith('low');
    expect(deps.markSessionMetadataDirty).toHaveBeenCalledTimes(2);
    expect(deps.markThinkingOverride).toHaveBeenCalledTimes(2);
    expect(deps.stopActiveMessage).toHaveBeenCalledTimes(1);
  });
});
