import { describe, expect, it } from 'vitest';
import type { ChatSettingsProvider } from '../../../../utils/chat/chat-session-defaults.js';
import { resolveEffectiveChatModelSelection } from './resolve-effective-chat-model-selection.js';

const PROVIDERS: ChatSettingsProvider[] = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    type: 'anthropic',
    enabled: true,
    defaultModels: [{ id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', enabled: true }],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    type: 'openai',
    enabled: true,
    defaultModels: [
      { id: 'gpt-5.4', label: 'GPT-5.4', enabled: true },
      { id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini', enabled: true },
    ],
  },
];

describe('resolveEffectiveChatModelSelection', () => {
  it('优先返回当前有效绑定', () => {
    expect(
      resolveEffectiveChatModelSelection({
        providers: PROVIDERS,
        selectedProviderId: 'openai',
        selectedModelId: 'gpt-5.4-mini',
        defaultProviderId: 'openai',
        defaultModelId: 'gpt-5.4',
      }),
    ).toMatchObject({
      providerId: 'openai',
      modelId: 'gpt-5.4-mini',
      rawSelectionInvalid: false,
      source: 'selected',
    });
  });

  it('当前绑定失效时回退到 chat 默认模型', () => {
    expect(
      resolveEffectiveChatModelSelection({
        providers: PROVIDERS,
        selectedProviderId: 'openai',
        selectedModelId: 'retired-model',
        defaultProviderId: 'anthropic',
        defaultModelId: 'claude-sonnet-4-6',
      }),
    ).toMatchObject({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-6',
      rawSelectionInvalid: true,
      source: 'defaults',
    });
  });

  it('默认模型也不可用时回退到 catalog 第一个可用模型', () => {
    expect(
      resolveEffectiveChatModelSelection({
        providers: PROVIDERS,
        selectedProviderId: 'missing-provider',
        selectedModelId: 'missing-model',
        defaultProviderId: 'retired-provider',
        defaultModelId: 'retired-model',
      }),
    ).toMatchObject({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-6',
      rawSelectionInvalid: true,
      source: 'catalog_fallback',
    });
  });
});
