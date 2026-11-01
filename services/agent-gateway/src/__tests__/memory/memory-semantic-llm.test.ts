import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const { resolveConfig, generate } = vi.hoisted(() => ({
  resolveConfig: vi.fn(),
  generate: vi.fn(),
}));
vi.mock('../../provider/auxiliary-llm-config.js', () => ({
  resolveAuxiliaryLlmConfig: resolveConfig,
}));
vi.mock('../../v2-runtime/upstream/index.js', () => ({ runUpstreamGenerate: generate }));
import { generateMemorySemanticSuggestions } from '../../memory/maintenance/memory-semantic-llm.js';

beforeEach(() => {
  vi.clearAllMocks();
  resolveConfig.mockResolvedValue({
    apiKey: 'test-key',
    apiBaseUrl: 'https://provider.test',
    model: 'test-model',
    providerType: 'anthropic',
    upstreamProtocol: 'anthropic_messages',
  });
  generate.mockReturnValue(
    Effect.succeed({ text: '{"suggestions":[]}', inputTokens: 10, outputTokens: 5 }),
  );
});

describe('语义整理模型适配', () => {
  it('保留用户模型协议并禁止工具，无普通会话或工具循环', async () => {
    const signal = new AbortController().signal;
    expect(await generateMemorySemanticSuggestions('owner', '[]', signal)).toMatchObject({
      inputTokens: 10,
      outputTokens: 5,
    });
    expect(resolveConfig).toHaveBeenCalledWith('owner');
    const input = generate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(input).toMatchObject({
      model: 'test-model',
      upstreamProtocol: 'anthropic_messages',
      maxOutputTokens: 2000,
      temperature: 0,
      signal,
    });
    expect(input['tools']).toBeUndefined();
    expect(input['sessionId']).toBeUndefined();
  });
  it('无配置或已取消时不发起生成', async () => {
    resolveConfig.mockResolvedValueOnce(null);
    expect(
      await generateMemorySemanticSuggestions('owner', '[]', new AbortController().signal),
    ).toBeNull();
    const controller = new AbortController();
    controller.abort();
    expect(await generateMemorySemanticSuggestions('owner', '[]', controller.signal)).toBeNull();
    expect(generate).not.toHaveBeenCalled();
  });
});
