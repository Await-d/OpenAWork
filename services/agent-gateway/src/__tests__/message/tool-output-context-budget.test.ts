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
  it.each(['batch', 'webfetch', 'mcp_call', 'desktop_control', 'custom_tool', 'read_tool_output'])(
    '%s 大输出在正常请求中保持完整且不修改存储',
    (tool) => {
      const output = '关键结果\n' + '正文'.repeat(100_000);
      const message = fixture(tool, output);
      const projected = toModelMessages([message]);
      const result = projected.find((entry) => entry.role === 'tool');
      expect(result?.content).toBe(output);
      expect(JSON.stringify(message)).toContain(output.replaceAll('\n', '\\n'));
    },
  );

  it('参数化 Data URI 会被移除，但普通文本不因调用 ID 或长度被截断', () => {
    const secret = 'SECRET_TOKEN_AT_END';
    const output =
      'data:image/png;charset=utf-8;base64,AA-_ \tAA== | '.repeat(400) +
      '正文'.repeat(20_000) +
      secret;
    const projected = toModelMessages([
      fixture('custom_tool', output, 'completed', 'x'.repeat(10_000)),
    ]);
    const content = projected.find((entry) => entry.role === 'tool')?.content ?? '';
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
