/**
 * Claude 模型能力判定契约测试（对齐上游 packages/ai@v2.0.28）
 *
 * 覆盖 T-23：模型 ID 形态（网关命名空间 / Vertex 后缀 / 快照日期）不应改变能力判定，
 * 且 `compatibility.*` 必须能覆盖模型名启发式。
 */

import { describe, it, expect } from 'vitest';
import * as ClaudeModel from '../utils/claude-model.js';
import { Model } from '../../schema/index.js';
import * as AnthropicMessages from '../anthropic-messages.js';

const model = (id: string, compatibility?: { readonly supportsThinkingBlockBinding?: boolean }) =>
  Model.make({
    id,
    provider: 'anthropic',
    route: AnthropicMessages.route,
    compatibility,
  });

describe('claudeVersion', () => {
  it('解析 family/major/minor', () => {
    expect(ClaudeModel.claudeVersion('claude-opus-5-1')).toEqual({
      family: 'opus',
      major: 5,
      minor: 1,
    });
  });

  it('接受网关命名空间前缀', () => {
    expect(ClaudeModel.claudeVersion('anthropic/claude-sonnet-4-5')).toEqual({
      family: 'sonnet',
      major: 4,
      minor: 5,
    });
  });

  it('不把快照日期当作 minor 版本', () => {
    expect(ClaudeModel.claudeVersion('claude-haiku-4-5-20250929')).toEqual({
      family: 'haiku',
      major: 4,
      minor: 5,
    });
  });

  it('接受 Vertex 的 @ 后缀', () => {
    expect(ClaudeModel.claudeVersion('claude-sonnet-4-5@20250929')?.minor).toBe(5);
  });

  it('非 Claude 模型返回 undefined', () => {
    expect(ClaudeModel.claudeVersion('gpt-5.1')).toBeUndefined();
  });
});

describe('supportsThinkingBlockBinding', () => {
  it('5.1 及以上支持', () => {
    expect(ClaudeModel.supportsThinkingBlockBinding(model('claude-opus-5-1'))).toBe(true);
  });

  it('4.5 不支持', () => {
    expect(ClaudeModel.supportsThinkingBlockBinding(model('claude-opus-4-5'))).toBe(false);
  });

  it('compatibility 覆盖优先于模型名启发式', () => {
    expect(
      ClaudeModel.supportsThinkingBlockBinding(
        model('claude-opus-4-5', { supportsThinkingBlockBinding: true }),
      ),
    ).toBe(true);
    expect(
      ClaudeModel.supportsThinkingBlockBinding(
        model('claude-opus-5-1', { supportsThinkingBlockBinding: false }),
      ),
    ).toBe(false);
  });
});
