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

  it('错误对象同时保留结构化 raw，供上层程序化读取', () => {
    const frame = '{"choices":[]}';
    const error = eventError('route', describeInvalidStreamEvent('route', frame), frame);
    const reason = error.reason as { raw?: string; message?: string };
    expect(reason.raw).toBe(frame);
    expect(reason.message).toContain(frame);
  });
});
