import { describe, expect, it } from 'vitest';
import { microcompactMessages } from '../../compaction/microcompact.js';
import type { UnifiedMessage } from '../../message/message-to-model-messages.js';

function user(content: string): UnifiedMessage {
  return { role: 'user', content };
}

function result(id: string, toolName: string, chars: number): UnifiedMessage {
  return { role: 'tool', toolCallId: id, toolName, content: '证据'.repeat(chars / 2) };
}

describe('OpenCode 工具结果延迟剪枝预算', () => {
  it('正常上下文不受固定 48K 字符预算限制', () => {
    const messages = [
      user('较早轮次'),
      result('old', 'bash', 80_000),
      user('近期轮次'),
      result('recent', 'bash', 80_000),
      user('当前轮次'),
      result('current', 'bash', 80_000),
    ];

    const compacted = microcompactMessages(messages);

    expect(compacted).toMatchObject({ applied: false, clearedCount: 0, trigger: 'none' });
    expect(compacted.metrics.afterChars).toBe(240_000);
    expect(compacted.messages).toEqual(messages);
  });

  it('超过 40K 保护区且可回收超过 20K token 时剪旧结果并提供读取引用', () => {
    const messages = [
      user('最旧轮次'),
      result('reclaimable', 'bash', 84_000),
      user('较新轮次'),
      result('protected', 'bash', 160_000),
      user('上一轮'),
      result('recent', 'bash', 8_000),
      user('当前轮次'),
      result('current', 'bash', 8_000),
    ];

    const compacted = microcompactMessages(messages);

    expect(compacted).toMatchObject({ applied: true, clearedCount: 1, trigger: 'prune' });
    expect(compacted.messages[1]?.content).toContain('read_tool_output');
    expect(compacted.prunedToolCallIds).toEqual(['reclaimable']);
    expect(compacted.messages[3]).toEqual(messages[3]);
    expect(compacted.messages[7]).toEqual(messages[7]);
  });

  it('skill 默认受保护且显式工具白名单仍生效', () => {
    const messages = [
      user('最旧轮次'),
      result('skill', 'skill', 200_000),
      result('other', 'mcp_call', 84_000),
      user('较新轮次'),
      result('protected', 'mcp_call', 160_000),
      user('上一轮'),
      result('recent', 'mcp_call', 8_000),
      user('当前轮次'),
      result('current', 'mcp_call', 8_000),
    ];

    const compacted = microcompactMessages(messages);
    expect(compacted.messages[1]).toEqual(messages[1]);
    expect(compacted.prunedToolCallIds).toEqual(['other']);
    expect(microcompactMessages(messages, { compactableTools: new Set(['bash']) }).applied).toBe(
      false,
    );
  });

  it('剪枝会移除关联工具图片但保留真实用户图片和完整持久化输入', () => {
    const oldAttachment: UnifiedMessage = {
      role: 'user',
      content: '[Tool returned the following attachments]',
      syntheticKind: 'tool-attachments',
      sourceToolCallId: 'old-image',
      images: [{ imageUrl: 'data:image/png;base64,old' }],
    };
    const realUserImage: UnifiedMessage = {
      role: 'user',
      content: '真实用户图片',
      images: [{ imageUrl: 'data:image/png;base64,user' }],
    };
    const messages = [
      user('最旧轮次'),
      result('old-image', 'desktop_control', 84_000),
      oldAttachment,
      realUserImage,
      user('较新轮次'),
      result('protected', 'desktop_control', 160_000),
      user('上一轮'),
      result('recent', 'desktop_control', 8_000),
      user('当前轮次'),
      result('current', 'desktop_control', 8_000),
    ];

    const compacted = microcompactMessages(messages);
    expect(compacted.messages).not.toContainEqual(oldAttachment);
    expect(compacted.messages).toContainEqual(realUserImage);
    expect(messages).toContainEqual(oldAttachment);
  });
});
