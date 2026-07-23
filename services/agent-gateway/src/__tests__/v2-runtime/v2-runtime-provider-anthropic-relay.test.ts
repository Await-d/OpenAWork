import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createAnthropic: vi.fn(),
  createOpenAICompatible: vi.fn(),
  createOpenAI: vi.fn(),
}));

vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: mocks.createAnthropic,
}));

vi.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: mocks.createOpenAICompatible,
}));

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: mocks.createOpenAI,
}));

import { buildAISdkProvider } from '../../v2-runtime/upstream/provider.js';

describe('buildAISdkProvider anthropic relay headers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createAnthropic.mockImplementation((settings: unknown) => ({
      settings,
      languageModel: (modelId: string) => ({ modelId, settings }),
    }));
    mocks.createOpenAICompatible.mockImplementation(() => ({
      languageModel: (modelId: string) => ({ modelId }),
    }));
    mocks.createOpenAI.mockImplementation(() => ({
      responses: (modelId: string) => ({ modelId }),
    }));
  });

  it('仅对官方 Anthropic provider 注入 anthropic-beta 头', () => {
    buildAISdkProvider({
      providerType: 'anthropic',
      apiKey: 'anthropic-key',
      baseURL: 'https://api.anthropic.com/v1',
      model: 'claude-opus-4-0',
      supportsThinking: true,
    }).languageModel('claude-opus-4-0');

    expect(mocks.createAnthropic).toHaveBeenCalledTimes(1);
    const settings = mocks.createAnthropic.mock.calls[0]?.[0] as
      { headers?: Record<string, string> } | undefined;
    expect(settings?.headers?.['anthropic-beta']).toContain('prompt-caching-scope');
  });

  it('对 MiMo 这类 anthropic_messages relay 保留现有头，但不注入 Anthropic beta 头', () => {
    buildAISdkProvider({
      providerType: 'mimo',
      upstreamProtocol: 'anthropic_messages',
      apiKey: 'mimo-key',
      baseURL: 'https://api.xiaomimimo.com/anthropic/v1',
      headers: {
        'x-mimo-trace': '1',
      },
      model: 'mimo-v2.5-pro',
      supportsThinking: true,
    }).languageModel('mimo-v2.5-pro');

    expect(mocks.createAnthropic).toHaveBeenCalledTimes(1);
    const settings = mocks.createAnthropic.mock.calls[0]?.[0] as
      { headers?: Record<string, string> } | undefined;
    expect(settings?.headers).toEqual({
      'x-mimo-trace': '1',
    });
    expect(settings?.headers?.['anthropic-beta']).toBeUndefined();
  });
});
