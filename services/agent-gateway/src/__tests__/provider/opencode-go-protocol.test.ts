import { describe, expect, it } from 'vitest';
import { resolveOpencodeGoProtocol } from '../../provider/opencode-go.js';

describe('resolveOpencodeGoProtocol', () => {
  it.each(['grok-4.6', 'gpt-5.6-luna', 'muse-spark-1.3-contributor', 'muse-spark-1.2-contributor'])(
    '%s 走 responses',
    (modelId) => {
      expect(resolveOpencodeGoProtocol(modelId)).toBe('responses');
    },
  );

  it.each([
    'minimax-m3',
    'minimax-m2.7',
    'minimax-m2.5',
    'qwen3.8-max',
    'qwen3.8-flash',
    'qwen3.7-max',
    'qwen3.7-plus',
    'qwen3.6-plus',
  ])('%s 走 anthropic_messages', (modelId) => {
    expect(resolveOpencodeGoProtocol(modelId)).toBe('anthropic_messages');
  });

  it.each(['deepseek-v4.1-flash', 'glm-5.3', 'kimi-k3', 'longcat-2.0', 'hy3'])(
    '%s 走 chat_completions',
    (modelId) => {
      expect(resolveOpencodeGoProtocol(modelId)).toBe('chat_completions');
    },
  );

  it('归一化大小写与空白', () => {
    expect(resolveOpencodeGoProtocol('  QWEN3.8-MAX  ')).toBe('anthropic_messages');
  });

  it('对未知模型回落到 chat_completions', () => {
    expect(resolveOpencodeGoProtocol('totally-unknown-model')).toBe('chat_completions');
  });

  it('前缀兜底覆盖未来版本', () => {
    expect(resolveOpencodeGoProtocol('grok-5.1')).toBe('responses');
    expect(resolveOpencodeGoProtocol('muse-spark-2.0-contributor')).toBe('responses');
    expect(resolveOpencodeGoProtocol('minimax-m4')).toBe('anthropic_messages');
    expect(resolveOpencodeGoProtocol('qwen3.9-max')).toBe('anthropic_messages');
  });
});
