/**
 * 解码失败消息契约：必须能看见出问题的那一帧。
 *
 * 动机（真实端点排查）：兼容网关的差异（空串占位、纯 usage 帧等）只能靠帧内容判断，
 * 只报 `Invalid xxx stream event` 时 `raw` 虽然挂在错误对象上，却不会出现在日志里。
 */

import { describe, expect, it } from 'vitest';
import { describeInvalidStreamEvent, eventError } from '../shared.js';

describe('describeInvalidStreamEvent', () => {
  it('消息里包含路由与原始帧', () => {
    const frame = '{"choices":[{"index":0,"delta":{"id":"","type":""}}]}';
    const message = describeInvalidStreamEvent('custom/openai-compatible-chat', frame);
    expect(message).toContain('custom/openai-compatible-chat');
    expect(message).toContain(frame);
  });

  it('长帧按上限截断并标注省略号，避免日志被撑爆', () => {
    const frame = 'x'.repeat(1000);
    const message = describeInvalidStreamEvent('route', frame, 100);
    expect(message).toContain('x'.repeat(100));
    expect(message).toContain('…');
    expect(message.length).toBeLessThan(frame.length);
  });

  it('短帧完整保留，不加省略号', () => {
    const message = describeInvalidStreamEvent('route', '{"a":1}', 100);
    expect(message).toBe('Invalid route stream event: {"a":1}');
    expect(message).not.toContain('…');
  });

  it('帧里的 \\uXXXX 转义还原成可读文本后再截断', () => {
    // 真实上游（Python `json.dumps` 默认 ensure_ascii）返回的 502 帧：原样贴出来
    // 就是一串 `\u4E0A\u6E38...`，用户与日志都读不出「上游在返回完整响应前关闭了
    // 流式连接，请重试」。
    const frame =
      '{"error":{"message":"\\u4E0A\\u6E38\\u5728\\u8FD4\\u56DE\\u5B8C\\u6574\\u54CD\\u5E94\\u524D\\u5173\\u95ED\\u4E86\\u6D41\\u5F0F\\u8FDE\\u63A5\\uFF0C\\u8BF7\\u91CD\\u8BD5","type":"upstream_error","code":502}}';
    const message = describeInvalidStreamEvent('custom/openai-compatible-chat', frame);

    expect(message).toContain('上游在返回完整响应前关闭了流式连接，请重试');
    expect(message).not.toContain('\\u4E0A');
  });

  it('错误对象同时保留结构化 raw，供上层程序化读取', () => {
    const frame = '{"choices":[]}';
    const error = eventError('route', describeInvalidStreamEvent('route', frame), frame);
    const reason = error.reason as { raw?: string; message?: string };
    expect(reason.raw).toBe(frame);
    expect(reason.message).toContain(frame);
  });
});
