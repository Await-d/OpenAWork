// @vitest-environment jsdom

import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useProviderModelInfo } from './use-provider-model-info.js';
import type { ChatSettingsProvider } from '../../../../utils/chat/chat-session-defaults.js';

const PROVIDERS: ChatSettingsProvider[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    type: 'openai',
    enabled: true,
    defaultModels: [
      {
        id: 'gpt-5.4',
        label: 'GPT-5.4',
        enabled: true,
        supportsThinking: true,
      },
      {
        id: 'gpt-5.4-mini',
        label: 'GPT-5.4 Mini',
        enabled: true,
        supportsThinking: true,
      },
    ],
  },
];

describe('useProviderModelInfo', () => {
  it('在会话已有 provider/model 但 catalog 暂时缺失该模型时，不静默回退显示模型', async () => {
    const setActiveProviderId = vi.fn();
    const setActiveModelId = vi.fn();

    const chatDefaultsRef = { current: { providerId: 'openai', modelId: 'gpt-5.4' } };

    const { result } = renderHook(() =>
      useProviderModelInfo({
        providers: PROVIDERS,
        activeProviderId: 'openai',
        activeModelId: 'snapshot-model',
        chatDefaultsRef,
        setActiveProviderId,
        setActiveModelId,
      }),
    );

    await waitFor(() => {
      expect(result.current.activeProvider?.id).toBe('openai');
    });

    expect(result.current.effectiveProviderId).toBe('openai');
    expect(result.current.effectiveModelId).toBe('gpt-5.4');
    expect(result.current.activeModelOption?.id).toBe('gpt-5.4');
    expect(result.current.activeModelTooltip).toBe(
      '当前使用模型：OpenAI / GPT-5.4（会话绑定模型不可用，已回退）',
    );
    expect(result.current.rawModelSelectionInvalid).toBe(true);
    expect(setActiveProviderId).not.toHaveBeenCalled();
    expect(setActiveModelId).not.toHaveBeenCalled();
  });

  it('仅在当前没有任何 provider/model 选择时补默认值', async () => {
    const setActiveProviderId = vi.fn();
    const setActiveModelId = vi.fn();

    const chatDefaultsRef = { current: { providerId: 'openai', modelId: 'gpt-5.4' } };

    renderHook(() =>
      useProviderModelInfo({
        providers: PROVIDERS,
        activeProviderId: '',
        activeModelId: '',
        chatDefaultsRef,
        setActiveProviderId,
        setActiveModelId,
      }),
    );

    await waitFor(() => {
      expect(setActiveProviderId).toHaveBeenCalledWith('openai');
    });

    expect(setActiveModelId).toHaveBeenCalledWith('gpt-5.4');
  });

  it('会话绑定加载中不补默认值（避免默认模型抢先覆盖会话绑定）', async () => {
    const setActiveProviderId = vi.fn();
    const setActiveModelId = vi.fn();

    const chatDefaultsRef = { current: { providerId: 'openai', modelId: 'gpt-5.4' } };

    const { rerender, result } = renderHook(
      ({ pending }: { pending: boolean }) =>
        useProviderModelInfo({
          providers: PROVIDERS,
          activeProviderId: '',
          activeModelId: '',
          chatDefaultsRef,
          sessionBindingPending: pending,
          setActiveProviderId,
          setActiveModelId,
        }),
      { initialProps: { pending: true } },
    );

    // 加载窗口内：选型为空但**不得**写入全局默认值。
    await waitFor(() => {
      expect(result.current.effectiveModelId).toBe('gpt-5.4');
    });
    expect(setActiveProviderId).not.toHaveBeenCalled();
    expect(setActiveModelId).not.toHaveBeenCalled();

    // 水合完成（会话确实没有绑定）后才接管默认值。
    rerender({ pending: false });

    await waitFor(() => {
      expect(setActiveProviderId).toHaveBeenCalledWith('openai');
    });
    expect(setActiveModelId).toHaveBeenCalledWith('gpt-5.4');
  });
});
