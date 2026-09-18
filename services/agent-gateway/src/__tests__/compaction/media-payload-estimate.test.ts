/**
 * 媒体载荷计费回归：内联 base64 data URL 曾按字符长度计费（1.5 MiB PNG 的
 * data URL ≈ 2.19M 字符 ≈ 548K tokens），导致真实会话首轮仅一条用户消息就触发
 * proactive auto-compaction（cause: proactive_near_overflow）。
 *
 * 现在媒体（data URL / Uint8Array）按 provider 归一化的固定 per-part 费率计费，
 * 非媒体字符的估算口径保持逐字节不变。
 */

import { describe, expect, it } from 'vitest';
import { Message as NativeMessage } from '@openAwork/opencode-llm';
import type { Message } from '@openAwork/shared';
import { isCompactionThresholdReached } from '../../compaction/compaction-parity-contract.js';
import { estimateMessageTokens } from '../../compaction/compaction-tail-budget.js';
import {
  MEDIA_PAYLOAD_CHARS,
  isInlineMediaPayload,
  stripMediaPayloadsForEstimate,
} from '../../compaction/media-payload-estimate.js';
import {
  estimateModelMessagesTokens,
  estimateProviderRequestTokens,
} from '../../routes/stream-model-round.js';

/** 真实生产回归载荷：1.5 MiB PNG → 2,190,674 字符 data URL。 */
const DATA_URL = `data:image/png;base64,${'A'.repeat(2_190_652)}`;
const MEDIA_PLACEHOLDER = 'x'.repeat(MEDIA_PAYLOAD_CHARS);

function buildRequest(imagePayload: string) {
  return {
    system: [{ type: 'text', text: 's'.repeat(80_000) }],
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: '图片中都是哪些人员' },
          { type: 'media', mediaType: 'image/png', data: imagePayload },
        ],
      },
    ],
    tools: [],
  };
}

const request = buildRequest(DATA_URL);

describe('生产回归：1.5 MiB PNG 不再按 base64 长度计费', () => {
  it('整请求估算远低于旧口径的 ~548K，且媒体部分独立 < 5K', () => {
    const estimated = estimateProviderRequestTokens(request);
    // 仅 80,000 字符的 system 文本本身就有 ~20,000 tokens（4 chars/token），
    // 因此整请求的下界就在它附近；旧口径下这张图片会再叠加 ~548K。
    expect(estimated).toBeGreaterThan(0);
    expect(estimated).toBeLessThan(25_000);

    // 媒体所在消息（提示文本 + 单个按固定费率计费的媒体 part）必须 < 5K tokens。
    expect(estimateModelMessagesTokens(request.messages)).toBeLessThan(5_000);

    // 与「无媒体孪生请求」对比：媒体只贡献固定的 per-part 费率（agent 视角 < 5K）。
    const mediaFree = {
      ...request,
      messages: [{ role: 'user', content: [{ type: 'text', text: '图片中都是哪些人员' }] }],
    };
    const mediaDelta = estimated - estimateProviderRequestTokens(mediaFree);
    expect(mediaDelta).toBeGreaterThan(0);
    expect(mediaDelta).toBeLessThan(5_000);
  });

  it('真实阈值配置下不再触发主动压缩（contextWindowOverride = 272000 → 阈值 252000）', () => {
    const reached = isCompactionThresholdReached(
      { inputTokens: estimateProviderRequestTokens(request) },
      {
        modelContextWindow: 1_050_000,
        discoveredContextWindow: 272_000,
        modelMaxOutputTokens: 128_000,
      },
    );
    expect(reached).toBe(false);
  });

  it('估算对载荷大小 O(1)：2,190,652 与 200,000 字符的 data URL 相差 ≤ 1 token', () => {
    const smaller = buildRequest(`data:image/png;base64,${'A'.repeat(200_000)}`);
    const diff = Math.abs(
      estimateProviderRequestTokens(request) - estimateProviderRequestTokens(smaller),
    );
    expect(diff).toBeLessThanOrEqual(1);
  });
});

describe('非媒体输入计费保持不变', () => {
  it('嵌套对象输入与 JSON.stringify 口径完全一致', () => {
    const nested = {
      system: [{ role: 'system', content: 'system prompt' }],
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'hello' }] },
        { role: 'assistant', content: [{ type: 'reasoning', text: 'thought' }] },
      ],
      tools: [
        {
          name: 'read_file',
          schema: { type: 'object', properties: { path: { type: 'string' }, tags: ['a', 'b'] } },
        },
      ],
    };
    expect(estimateProviderRequestTokens(nested)).toBe(
      Math.ceil(JSON.stringify(nested).length / 4),
    );
  });

  it('数组输入与 JSON.stringify 口径完全一致', () => {
    const arrayHeavy = {
      system: [],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'a'.repeat(40) }] }],
      tools: ['plain', 1, [true, null, { nested: { deep: 'x'.repeat(40) } }]],
    };
    expect(estimateProviderRequestTokens(arrayHeavy)).toBe(
      Math.ceil(JSON.stringify(arrayHeavy).length / 4),
    );
  });

  it('带自身 JSON 投影的值（Date）不会被重建丢失', () => {
    const input = {
      system: [],
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'hi', metadata: { at: new Date(1789610137844) } }],
        },
      ],
      tools: [],
    };
    expect(estimateProviderRequestTokens(input)).toBe(Math.ceil(JSON.stringify(input).length / 4));
  });

  it('原生 Message 实例（Effect Schema class）非媒体内容逐字节不变', () => {
    const request = {
      system: [],
      messages: [
        NativeMessage.make({ role: 'user', content: [{ type: 'text', text: 'a'.repeat(200) }] }),
      ],
      tools: [],
    };
    expect(estimateProviderRequestTokens(request)).toBe(
      Math.ceil(JSON.stringify(request).length / 4),
    );
  });

  it('原生 Message 实例中的 media part 同样按固定费率计费', () => {
    const request = {
      system: [],
      messages: [
        NativeMessage.make({
          role: 'user',
          content: [{ type: 'media', mediaType: 'image/png', data: DATA_URL }],
        }),
      ],
      tools: [],
    };
    expect(estimateProviderRequestTokens(request)).toBeLessThan(2_000);
  });
});

describe('estimateMessageTokens 媒体与附件计费', () => {
  it('input_image 按固定费率计费而非 imageUrl 长度', () => {
    const message: Message = {
      id: 'm-image',
      role: 'user',
      createdAt: 0,
      content: [{ type: 'input_image', imageUrl: DATA_URL, mimeType: 'image/png' }],
    };
    expect(estimateMessageTokens(message)).toBeLessThan(2_000);
  });

  it('tool_result 的 attachments 会计入（此前被完全忽略）', () => {
    const withoutAttachments: Message = {
      id: 'm-tool-result',
      role: 'user',
      createdAt: 0,
      content: [{ type: 'tool_result', toolCallId: 'c1', isError: false, output: 'ok' }],
    };
    const withAttachments: Message = {
      ...withoutAttachments,
      content: [
        {
          type: 'tool_result',
          toolCallId: 'c1',
          isError: false,
          output: 'ok',
          attachments: [{ type: 'input_image', imageUrl: DATA_URL, mimeType: 'image/png' }],
        },
      ],
    };
    expect(estimateMessageTokens(withAttachments)).toBeLessThan(2_000);
    expect(estimateMessageTokens(withAttachments)).toBeGreaterThan(
      estimateMessageTokens(withoutAttachments),
    );
  });
});

describe('stripMediaPayloadsForEstimate', () => {
  it('替换 data URL 与 Uint8Array，普通值原样保留', () => {
    expect(stripMediaPayloadsForEstimate(DATA_URL)).toBe(MEDIA_PLACEHOLDER);
    expect(stripMediaPayloadsForEstimate('DATA:image/png;base64,AAAA')).toBe(MEDIA_PLACEHOLDER);
    expect(stripMediaPayloadsForEstimate(new Uint8Array([1, 2, 3]))).toBe(MEDIA_PLACEHOLDER);
    expect(stripMediaPayloadsForEstimate('plain text')).toBe('plain text');
    expect(stripMediaPayloadsForEstimate(42)).toBe(42);
    expect(stripMediaPayloadsForEstimate(null)).toBeNull();
    expect(stripMediaPayloadsForEstimate(undefined)).toBeUndefined();
  });

  it('保持 key 顺序且非媒体对象深相等', () => {
    const input = { zulu: 1, alpha: { nested: 'value' }, list: [1, 2, 3] };
    const stripped = stripMediaPayloadsForEstimate(input);
    expect(Object.keys(stripped as Record<string, unknown>)).toEqual(Object.keys(input));
    expect(stripped).toEqual(input);
    expect(JSON.stringify(stripped)).toBe(JSON.stringify(input));
  });

  it('isInlineMediaPayload 只识别 data: scheme（大小写不敏感）', () => {
    expect(isInlineMediaPayload(DATA_URL)).toBe(true);
    expect(isInlineMediaPayload('data:text/plain;base64,QQ==')).toBe(true);
    expect(isInlineMediaPayload('https://example.com/a.png')).toBe(false);
    expect(isInlineMediaPayload(new Uint8Array([1]))).toBe(false);
    expect(isInlineMediaPayload(undefined)).toBe(false);
  });
});
