import { describe, expect, it } from 'vitest';
import { toModelMessages } from '../../message/message-to-model-messages.js';
import type { MessageWithParts } from '../../message/message-v2-schema.js';
import { makeMessageId, makePartId } from '../../message/message-v2-schema.js';

function fixture(
  tool: string,
  output: string,
  status = 'completed',
  callID = 'call-1',
): MessageWithParts {
  const messageID = makeMessageId();
  return {
    info: {
      id: messageID,
      sessionID: 'session-1',
      role: 'assistant',
      time: { created: 1 },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    },
    parts: [
      {
        id: makePartId(),
        messageID,
        sessionID: 'session-1',
        type: 'tool',
        callID,
        tool,
        state:
          status === 'completed'
            ? {
                status: 'completed',
                input: {},
                output,
                title: tool,
                metadata: {},
                time: { start: 1, end: 2 },
              }
            : { status: 'error', input: {}, error: output, time: { start: 1, end: 2 } },
      },
    ],
  };
}

describe('工具结果正常模型投影', () => {
  /**
   * 各工具在模型投影阶段的字节上限：工具专属上限优先，其余落到通用上限。
   * 模型视图统一为 2000 行 / 50 KiB（超出部分落盘保留，可经 read_tool_output 取回）。
   */
  const TOOL_OUTPUT_CAPS: Record<string, number> = {
    batch: 50 * 1024,
    custom_tool: 50 * 1024,
    read_tool_output: 50 * 1024,
    webfetch: 40_000,
    mcp_call: 50 * 1024,
    desktop_control: 8_000,
  };

  it.each(Object.entries(TOOL_OUTPUT_CAPS))(
    '%s 输出在上限内逐字保留、超上限按上限截断，且均不修改存储',
    (tool, cap) => {
      // ASCII 正文保证「字节数 == 字符数」，从而与字节口径的上限直接对齐。
      const withinCap = 'key\n' + 'z'.repeat(cap - 4);
      const withinMessage = fixture(tool, withinCap);
      expect(toModelMessages([withinMessage]).find((entry) => entry.role === 'tool')?.content).toBe(
        withinCap,
      );
      expect(JSON.stringify(withinMessage)).toContain(withinCap.replaceAll('\n', '\\n'));

      const overCap = 'key\n' + 'z'.repeat(cap - 4 + 1_000);
      const overMessage = fixture(tool, overCap);
      const content =
        toModelMessages([overMessage]).find((entry) => entry.role === 'tool')?.content ?? '';
      expect(content.startsWith(overCap.slice(0, cap))).toBe(true);
      expect(content).toContain('[输出已截断');
      expect(JSON.stringify(overMessage)).toContain(overCap.replaceAll('\n', '\\n'));
    },
  );

  it('参数化 Data URI 会被移除，上限内的普通文本不因调用 ID 被截断', () => {
    const secret = 'SECRET_TOKEN_AT_END';
    const output =
      'data:image/png;charset=utf-8;base64,AA-_ \tAA== | '.repeat(100) +
      'body'.repeat(4_000) +
      secret;
    const projected = toModelMessages([
      fixture('custom_tool', output, 'completed', 'x'.repeat(10_000)),
    ]);
    const content = projected.find((entry) => entry.role === 'tool')?.content ?? '';
    // 保持在模型视图字节上限内，验证 Data URI 清理不会顺手截断普通文本。
    expect(Buffer.byteLength(output, 'utf8')).toBeLessThan(50 * 1024);
    expect(content).toContain(secret);
    expect(content).not.toContain('AA-_');
    expect(content).not.toContain('x'.repeat(256));
  });

  it('单次工具返回的图片附件限制为四张并保留原始附件', () => {
    const message = fixture('desktop_control', '{"ok":true}');
    const tool = message.parts[0];
    if (tool?.type !== 'tool' || tool.state.status !== 'completed')
      throw new Error('fixture invalid');
    tool.state.attachments = Array.from({ length: 12 }, (_, index) => ({
      id: makePartId(),
      messageID: message.info.id,
      sessionID: 'session-1',
      type: 'file' as const,
      inputType: 'input_image' as const,
      mime: 'image/png',
      url: `data:image/png;base64,image-${index}`,
    }));
    const projected = toModelMessages([message]);
    const images = projected.flatMap((entry) =>
      entry.role === 'user' ? (entry.images ?? []) : [],
    );
    expect(images).toHaveLength(4);
    expect(tool.state.attachments).toHaveLength(12);
  });

  it('超大内联工具图片不会原样进入模型消息且原始附件保持不变', () => {
    const message = fixture('desktop_control', '{"ok":true}');
    const tool = message.parts[0];
    if (tool?.type !== 'tool' || tool.state.status !== 'completed')
      throw new Error('fixture invalid');
    const oversizedUrl = `\u0000 d\tA\nT\rA\t:image/png;base64,${'A'.repeat(500_001)}`;
    tool.state.attachments = [
      {
        id: makePartId(),
        messageID: message.info.id,
        sessionID: 'session-1',
        type: 'file',
        inputType: 'input_image',
        mime: 'image/png',
        url: oversizedUrl,
      },
    ];

    const projected = toModelMessages([message]);

    expect(
      projected.flatMap((entry) => (entry.role === 'user' ? (entry.images ?? []) : [])),
    ).toEqual([]);
    expect(tool.state.attachments[0]?.url).toBe(oversizedUrl);
  });

  it('错误结果同样完整投影并保留错误状态', () => {
    const output = '失败信息'.repeat(50_000);
    const projected = toModelMessages([fixture('batch', output, 'error')]);
    const result = projected.find((entry) => entry.role === 'tool');
    expect(result?.content).toBe(output);
    expect(result?.isError).toBe(true);
  });
  it('小结果保持逐字不变', () => {
    const projected = toModelMessages([fixture('custom_tool', '{"ok":true}')]);
    expect(projected.find((entry) => entry.role === 'tool')?.content).toBe('{"ok":true}');
  });
});
