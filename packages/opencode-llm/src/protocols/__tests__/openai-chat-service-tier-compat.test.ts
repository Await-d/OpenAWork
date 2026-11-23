/**
 * OpenAI Chat 流事件的**响应侧**宽容度。
 *
 * 回归背景：`service_tier` 曾经在响应解码里复用请求侧白名单（`Schema.Literals`）。
 * 请求侧用白名单是为了不把拼错的档位发给上游，但响应侧的上游回显只是元数据 ——
 * 兼容网关回一个白名单外的值（`standard` / `turbo` / 空串）就会让整个 chunk 判成
 * 非法帧，正在输出的流被当场掐断。线上表现是日志里的
 * `Invalid custom/openai-compatible-chat stream event: {"id":...,"object":"chat.comp...`
 * 且整轮 agent 运行失败。
 */

import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';
import * as Chat from '../openai-chat.js';

const decode = Schema.decodeUnknownSync(Chat.protocol.stream.event);

const chunk = (extra: Record<string, unknown> = {}): string =>
  JSON.stringify({
    id: 'chatcmpl-test',
    object: 'chat.completion.chunk',
    created: 1_700_000_000,
    model: 'deepseek-v4.1-flash',
    choices: [{ index: 0, delta: { content: 'hi' }, finish_reason: null }],
    ...extra,
  });

describe('OpenAI Chat 流事件 service_tier 兼容', () => {
  it.each(['standard', 'turbo', 'DEFAULT', ''])(
    '白名单外的 service_tier（%s）不让整帧非法',
    (tier) => {
      expect(() => decode(chunk({ service_tier: tier }))).not.toThrow();
    },
  );

  it('白名单内的 service_tier 仍正常解码', () => {
    expect(() => decode(chunk({ service_tier: 'priority' }))).not.toThrow();
  });
});
