import { describe, expect, it } from 'vitest';
import { microcompactMessages } from '../../compaction/microcompact.js';
import type { UnifiedMessage } from '../../message/message-to-model-messages.js';

function result(id: string, toolName: string, length: number): UnifiedMessage {
  return { role: 'tool', toolCallId: id, toolName, content: '证据'.repeat(length / 2) };
}

describe('工具上下文累计预算', () => {
  it('少数大结果也触发，保留最新结果和可检索的旧结果预览', () => {
    const messages = [result('old', 'bash', 30_000), result('latest', 'bash', 30_000)];
    const compacted = microcompactMessages(messages);
    expect(compacted).toMatchObject({ applied: true, trigger: 'budget', clearedCount: 1 });
    expect(compacted.messages[0]?.content).toContain('read_tool_output');
    expect(compacted.messages[0]?.content).toContain('"old"');
    expect(compacted.messages[0]?.content).toContain('证据');
    expect(compacted.messages[1]).toEqual(messages[1]);
    expect(messages[0]?.content?.length).toBe(30_000);
    expect(compacted.tokensSaved).toBeGreaterThan(7_000);
  });

  it('默认包含 MCP、未知内置工具和 skill，避免任意工具绕过累计预算', () => {
    const messages = [
      result('skill', 'skill', 60_000),
      result('mcp', 'mcp_server_search', 30_000),
      result('desktop', 'future_desktop_tool', 30_000),
    ];
    const compacted = microcompactMessages(messages);
    expect(compacted.clearedCount).toBe(2);
    expect(compacted.messages[0]?.content).toContain('read_tool_output');
    expect(compacted.messages[1]?.content).toContain('read_tool_output');
    expect(compacted.messages[2]).toEqual(messages[2]);
  });

  it('仅在调用方显式指定时保护工具结果', () => {
    const messages = [result('skill', 'skill', 60_000), result('latest', 'bash', 30_000)];
    const compacted = microcompactMessages(messages, { protectedTools: new Set(['skill']) });
    expect(compacted.messages[0]).toEqual(messages[0]);
    expect(compacted.messages[1]).toEqual(messages[1]);
  });

  it('显式工具白名单仍排除其他工具', () => {
    const messages = [result('first', 'mcp_call', 60_000), result('last', 'mcp_call', 60_000)];
    expect(microcompactMessages(messages, { compactableTools: new Set(['bash']) }).applied).toBe(
      false,
    );
  });

  it('清除旧工具附图但保留最新工具附图和真正用户图片', () => {
    const oldImage: UnifiedMessage = {
      role: 'user',
      content: '[Tool returned the following attachments]',
      images: [{ imageUrl: 'data:image/png;base64,old' }],
    };
    const userImage: UnifiedMessage = {
      role: 'user',
      content: '请查看这张图片',
      images: [{ imageUrl: 'data:image/png;base64,user' }],
    };
    const newImage: UnifiedMessage = {
      role: 'user',
      content: '[Tool returned the following attachments]',
      images: [{ imageUrl: 'data:image/png;base64,new' }],
    };
    const messages = [
      result('old', 'desktop_control', 30_000),
      oldImage,
      userImage,
      result('latest', 'desktop_control', 30_000),
      newImage,
    ];
    const compacted = microcompactMessages(messages);
    expect(compacted.messages).not.toContainEqual(oldImage);
    expect(compacted.messages).toContainEqual(userImage);
    expect(compacted.messages).toContainEqual(newImage);
    expect(messages).toContainEqual(oldImage);
  });

  it('小文本配大工具图片也触发预算并只保留最新工具图片', () => {
    const attachment = (id: string): UnifiedMessage => ({
      role: 'user',
      content: '[Tool returned the following attachments]',
      images: Array.from({ length: 4 }, (_, index) => ({
        imageUrl: `data:image/png;base64,${id}-${index}`,
      })),
    });
    const oldImage = attachment('a');
    const latestImage = attachment('b');
    const messages = [
      result('old-image', 'desktop_control', 100),
      oldImage,
      result('latest-image', 'future_mcp_tool', 100),
      latestImage,
    ];
    const compacted = microcompactMessages(messages);
    expect(compacted.trigger).toBe('budget');
    expect(compacted.messages).not.toContainEqual(oldImage);
    expect(compacted.messages).toContainEqual(latestImage);
    expect(compacted.messages[0]?.content).toContain('read_tool_output');
  });

  it('唯一最新工具的大图也受预算约束但保留其文本结果', () => {
    const image: UnifiedMessage = {
      role: 'user',
      content: '[Tool returned the following attachments]',
      images: Array.from({ length: 12 }, (_, index) => ({ imageUrl: `image-${index}` })),
    };
    const tool = {
      role: 'tool' as const,
      toolCallId: 'only',
      toolName: 'desktop_control',
      content: 'ok',
    };
    const compacted = microcompactMessages([tool, image]);
    expect(compacted).toMatchObject({ applied: true, trigger: 'budget' });
    expect(compacted.messages).toEqual([tool]);
  });

  it('按工具图片实际 URL 长度计入预算', () => {
    const tool = result('only-large-url', 'desktop_control', 2);
    const image: UnifiedMessage = {
      role: 'user',
      content: '[Tool returned the following attachments]',
      images: [{ imageUrl: `data:image/png;base64,${'A'.repeat(50_000)}` }],
    };
    const compacted = microcompactMessages([tool, image]);
    expect(compacted).toMatchObject({ applied: true, trigger: 'budget' });
    expect(compacted.messages).toEqual([tool]);
  });

  it('单个超预算结果仍保留，由单结果投影器负责限额', () => {
    const messages = [result('latest', 'web_fetch', 90_000)];
    expect(microcompactMessages(messages).messages).toEqual(messages);
  });

  it('单工具投影引用仍计入累计预算，避免引用预览继续堆积', () => {
    const messages: UnifiedMessage[] = Array.from({ length: 8 }, (_, index) => ({
      role: 'tool',
      toolCallId: `projected-${index}`,
      toolName: 'web_fetch',
      content: '[tool_output_reference] ' + '网页摘录'.repeat(3_000),
    }));
    const compacted = microcompactMessages(messages);
    expect(compacted.applied).toBe(true);
    expect(compacted.messages[0]?.content).toContain('"microcompacted":true');
    expect(compacted.messages[7]).toEqual(messages[7]);
  });

  it('预算可压缩最近保留条数内的结果且重复投影保持一致', () => {
    const messages = Array.from({ length: 8 }, (_, index) =>
      result(`${index}`, 'web_search', 16_000),
    );
    const compacted = microcompactMessages(messages);
    expect(compacted.clearedCount).toBeGreaterThan(0);
    expect(
      compacted.messages.reduce((sum, message) => sum + (message.content?.length ?? 0), 0),
    ).toBeLessThanOrEqual(48_000);
    expect(microcompactMessages(messages)).toEqual(compacted);
    expect(microcompactMessages(compacted.messages).applied).toBe(false);
  });

  it('count 触发不会用更长引用替换小结果', () => {
    const messages = Array.from({ length: 500 }, (_, index) => result(`${index}`, 'bash', 100));
    const compacted = microcompactMessages(messages);
    const before = messages.reduce((sum, message) => sum + (message.content?.length ?? 0), 0);
    const after = compacted.messages.reduce(
      (sum, message) => sum + (message.content?.length ?? 0),
      0,
    );
    expect(after).toBeLessThanOrEqual(before);
  });

  it('超长调用 ID 使用短引用且累计结果保持在预算内', () => {
    const messages = Array.from({ length: 8 }, (_, index) =>
      result(`${index}-${'x'.repeat(10_000)}`, 'bash', 8_000),
    );
    const compacted = microcompactMessages(messages);
    expect(
      compacted.messages.reduce((sum, message) => sum + (message.content?.length ?? 0), 0),
    ).toBeLessThanOrEqual(48_000);
    expect(compacted.messages[0]?.content).toContain('toolCallRef');
    expect(compacted.messages[0]?.content).not.toContain('x'.repeat(256));
  });
});
