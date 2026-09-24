/**
 * 请求级内联图片预算（对齐 opencode v2.0.15 `boundImages`）：
 * 总载荷超过触发阈值时从**最早**开始淘汰，直到降到目标值以下，
 * 并在消息正文追加移除提示；远程 / 仅 artifactId 的图片不计入。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UnifiedMessage } from '../../message/message-to-model-messages.js';
import {
  boundInlineImages,
  inlineImagePayloadBytes,
  resolveImageBudget,
  IMAGE_REMOVED_NOTICE,
} from '../../message/image-request-budget.js';

/** 生成 `payloadChars` 个 base64 字符的内联图片（≈ payloadChars*3/4 字节）。 */
function dataUrl(payloadChars: number, mime = 'image/png'): string {
  return `data:${mime};base64,${'A'.repeat(payloadChars)}`;
}

type UserUnifiedMessage = Extract<UnifiedMessage, { role: 'user' }>;

function userMessage(id: string, imageUrls: string[], content = `msg-${id}`): UserUnifiedMessage {
  return {
    role: 'user',
    content,
    images: imageUrls.map((imageUrl) => ({ imageUrl, mimeType: 'image/png' })),
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('inlineImagePayloadBytes', () => {
  it('只计算 data: 内联载荷，远程 URL 与空值计 0', () => {
    expect(inlineImagePayloadBytes(dataUrl(60))).toBe(45);
    expect(inlineImagePayloadBytes('https://example.com/a.png')).toBe(0);
    expect(inlineImagePayloadBytes(undefined)).toBe(0);
    expect(inlineImagePayloadBytes('artifact://abc')).toBe(0);
  });
});

describe('boundInlineImages', () => {
  it('未超过触发阈值时原样返回（同一引用）', () => {
    const messages = [userMessage('1', [dataUrl(40)]), userMessage('2', [dataUrl(40)])];
    const result = boundInlineImages(messages, { triggerBytes: 100, targetBytes: 50 });
    expect(result.messages).toBe(messages);
    expect(result.removedCount).toBe(0);
  });

  it('超过阈值时从最早开始淘汰直到降到目标以下，并追加移除提示', () => {
    const messages = [
      userMessage('1', [dataUrl(60)]),
      userMessage('2', [dataUrl(60)]),
      userMessage('3', [dataUrl(60)]),
    ];
    // 每张 45 字节，共 135 > 触发 100；淘汰最早两张后剩 45 ≤ 目标 50。
    const result = boundInlineImages(messages, { triggerBytes: 100, targetBytes: 50 });

    expect(result.removedCount).toBe(2);
    expect(result.removedBytes).toBe(90);
    expect(result.messages[0]?.role === 'user' ? result.messages[0].images : []).toEqual([]);
    expect(result.messages[1]?.role === 'user' ? result.messages[1].images : []).toEqual([]);
    expect(result.messages[2]?.role === 'user' ? result.messages[2].images : []).toHaveLength(1);
    expect(result.messages[0]?.content).toContain(IMAGE_REMOVED_NOTICE);
    // 未被移除的消息不追加提示。
    expect(result.messages[2]?.content).not.toContain(IMAGE_REMOVED_NOTICE);
  });

  it('远程 URL 与仅 artifactId 的图片不计入、不被淘汰', () => {
    const messages = [
      {
        role: 'user',
        content: 'remote',
        images: [{ imageUrl: 'https://example.com/a.png', mimeType: 'image/png' }],
      } satisfies UnifiedMessage,
      {
        role: 'user',
        content: 'artifact',
        images: [{ artifactId: 'art-1', mimeType: 'image/png' }],
      } satisfies UnifiedMessage,
      userMessage('inline', [dataUrl(200)]),
    ];
    const result = boundInlineImages(messages, { triggerBytes: 100, targetBytes: 50 });

    expect(result.removedCount).toBe(1);
    expect(result.messages[0]?.role === 'user' ? result.messages[0].images : []).toHaveLength(1);
    expect(result.messages[1]?.role === 'user' ? result.messages[1].images : []).toHaveLength(1);
    expect(result.messages[2]?.role === 'user' ? result.messages[2].images : []).toEqual([]);
  });

  it('多图消息按顺序淘汰，保留较新的图片', () => {
    const message = userMessage('many', [dataUrl(60), dataUrl(60), dataUrl(60)]);
    const result = boundInlineImages([message], { triggerBytes: 100, targetBytes: 50 });

    expect(result.removedCount).toBe(2);
    const images = result.messages[0]?.role === 'user' ? (result.messages[0].images ?? []) : [];
    expect(images).toHaveLength(1);
    expect(images[0]?.imageUrl).toBe(message.images?.[2]?.imageUrl);
  });

  it('trigger/target 非正数时禁用', () => {
    const messages = [userMessage('1', [dataUrl(60)])];
    const result = boundInlineImages(messages, { triggerBytes: 0, targetBytes: 0 });
    expect(result.messages).toBe(messages);
    expect(result.removedCount).toBe(0);
  });

  it('环境变量可覆盖阈值并可禁用', () => {
    vi.stubEnv('OPENAWORK_IMAGE_BUDGET_TRIGGER_BYTES', '1000');
    vi.stubEnv('OPENAWORK_IMAGE_BUDGET_TARGET_BYTES', '500');
    expect(resolveImageBudget()).toEqual({ triggerBytes: 1000, targetBytes: 500 });

    vi.stubEnv('OPENAWORK_IMAGE_BUDGET_TRIGGER_BYTES', '0');
    expect(resolveImageBudget()).toEqual({ triggerBytes: 0, targetBytes: 0 });
  });

  it('target 高于 trigger 时收敛到 trigger', () => {
    vi.stubEnv('OPENAWORK_IMAGE_BUDGET_TRIGGER_BYTES', '100');
    vi.stubEnv('OPENAWORK_IMAGE_BUDGET_TARGET_BYTES', '9999');
    expect(resolveImageBudget()).toEqual({ triggerBytes: 100, targetBytes: 100 });
  });
});
