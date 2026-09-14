import type { AIProvider } from '@openAwork/agent-core';
import { describe, expect, it } from 'vitest';
import { runHookFirst } from '../../provider/provider-plugin.js';
import { OPENCODE_GO_BASE_URL } from '../../provider/opencode-go.js';
import '../../provider/plugins/index.js';

const buildProvider = (baseUrl: string): AIProvider => ({
  id: 'p1',
  type: 'custom',
  name: 'p1',
  enabled: true,
  baseUrl,
  defaultModels: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

const resolveProtocol = (providerType: string, model: string, baseUrl: string) =>
  runHookFirst('resolve.protocol', providerType, {
    model,
    provider: buildProvider(baseUrl),
    baseUrl,
  });

describe('opencode-go provider plugin registration', () => {
  it('注册后为 opencode-go 平台按模型解析协议', () => {
    expect(resolveProtocol('opencode-go', 'gpt-5.6-luna', OPENCODE_GO_BASE_URL)).toBe('responses');
    expect(resolveProtocol('opencode-go', 'qwen3.8-max', OPENCODE_GO_BASE_URL)).toBe(
      'anthropic_messages',
    );
    expect(resolveProtocol('opencode-go', 'glm-5.3', OPENCODE_GO_BASE_URL)).toBe(
      'chat_completions',
    );
  });
});

describe('custom provider plugin OpenCode 兜底', () => {
  it('custom + OpenCode 端点时按模型路由，而不是一律 chat_completions', () => {
    expect(resolveProtocol('custom', 'grok-4.6', OPENCODE_GO_BASE_URL)).toBe('responses');
    expect(resolveProtocol('custom', 'minimax-m3', OPENCODE_GO_BASE_URL)).toBe(
      'anthropic_messages',
    );
    expect(resolveProtocol('custom', 'deepseek-v4.1-flash', OPENCODE_GO_BASE_URL)).toBe(
      'chat_completions',
    );
  });

  it('custom + 非 OpenCode 端点仍默认 chat_completions', () => {
    expect(resolveProtocol('custom', 'grok-4.6', 'https://api.x.ai/v1')).toBe('chat_completions');
  });
});
