/**
 * Robustness (§0.85 / §0.86): several tools fetch arbitrary or registry-supplied
 * URLs and read the whole response into memory. A wall-clock timeout does NOT
 * bound memory — a fast server can stream gigabytes within the deadline — so a
 * large response would OOM the gateway. The shared `readResponseTextWithLimit`
 * rejects on an over-limit content-length and, when the header lies/is absent,
 * streams and aborts the moment the cap is crossed. `resolveHttpBodyLimitBytes`
 * parses the per-call env override (unset → fallback, non-positive → disabled).
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  readResponseJsonWithLimit,
  readResponseTextUpToLimit,
  readResponseTextWithLimit,
  resolveHttpBodyLimitBytes,
} from '../../infra/http-body-limit.js';

function streamFromChunks(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  let i = 0;
  let cancelled = false;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (cancelled) return;
      if (i < chunks.length) {
        controller.enqueue(chunks[i]!);
        i += 1;
      } else {
        controller.close();
      }
    },
    cancel() {
      cancelled = true;
    },
  });
}

function fakeResponse(input: { body: Uint8Array[]; contentLength?: number }): Response {
  const headers = new Headers();
  if (input.contentLength !== undefined) {
    headers.set('content-length', String(input.contentLength));
  }
  return new Response(streamFromChunks(input.body), { headers });
}

const enc = (s: string) => new TextEncoder().encode(s);

describe('readResponseTextWithLimit', () => {
  it('正常读取未超限的响应体', async () => {
    const res = fakeResponse({ body: [enc('hello '), enc('world')] });
    const text = await readResponseTextWithLimit(res, 1024);
    expect(text).toBe('hello world');
  });

  it('content-length 超过上限时在读取前即拒绝', async () => {
    const res = fakeResponse({ body: [enc('x')], contentLength: 10_000 });
    await expect(readResponseTextWithLimit(res, 1024)).rejects.toThrow(
      /response body too large: content-length/,
    );
  });

  it('content-length 缺失/谎报时，流式累计超限即中止', async () => {
    // No content-length header; stream 4 chunks of 400 bytes = 1600 > 1024 cap.
    const chunk = new Uint8Array(400);
    const res = fakeResponse({ body: [chunk, chunk, chunk, chunk] });
    await expect(readResponseTextWithLimit(res, 1024)).rejects.toThrow(
      /response body too large: exceeds limit/,
    );
  });

  it('maxBytes<=0 时禁用上限（完整读取）', async () => {
    const chunk = new Uint8Array(2048);
    const res = fakeResponse({ body: [chunk] });
    const text = await readResponseTextWithLimit(res, 0);
    expect(text.length).toBe(2048);
  });

  it('恰好等于上限的响应体被接受', async () => {
    const res = fakeResponse({ body: [new Uint8Array(1024)] });
    const text = await readResponseTextWithLimit(res, 1024);
    expect(text.length).toBe(1024);
  });
});

describe('readResponseTextUpToLimit', () => {
  it('未超限时行为与正常读取一致且 truncated=false', async () => {
    const res = fakeResponse({ body: [enc('hello '), enc('world')] });
    const result = await readResponseTextUpToLimit(res, 1024);
    expect(result).toEqual({ text: 'hello world', truncated: false });
  });

  it('超限时保留前缀（不抛错）并 truncated=true', async () => {
    // No content-length; stream 4 chunks of 400 bytes = 1600 > 1024 cap.
    const chunk = new Uint8Array(400);
    const res = fakeResponse({ body: [chunk, chunk, chunk, chunk] });
    const result = await readResponseTextUpToLimit(res, 1024);
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBe(1024);
  });

  it('content-length 超限时同样保留前缀且立即停止读取', async () => {
    const res = fakeResponse({ body: [new Uint8Array(10_000)], contentLength: 10_000 });
    const result = await readResponseTextUpToLimit(res, 1024);
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBe(1024);
  });

  it('多字节字符没有在截断点被劈开', async () => {
    // 600 个 `中` = 1800 字节；每 chunk 450 字节会切在字符中间（450 = 150 * 3，
    // 恰好对齐 —— 改用会不对齐的 chunk 尺寸：400 字节 / 3B 每字符）。
    const bytes = new TextEncoder().encode('中'.repeat(500)); // 1500 bytes
    const dodge = 512; // 截断点 512 % 3 = 1 → 必劈开一个字符
    const res = fakeResponse({ body: [bytes.subarray(0, 300), bytes.subarray(300)] });
    const result = await readResponseTextUpToLimit(res, dodge);
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBeLessThanOrEqual(500);
    expect(result.text.endsWith('\uFFFD')).toBe(false);
  });

  it('maxBytes<=0 时禁用上限', async () => {
    const chunk = new Uint8Array(2048);
    const res = fakeResponse({ body: [chunk] });
    const result = await readResponseTextUpToLimit(res, 0);
    expect(result.text.length).toBe(2048);
    expect(result.truncated).toBe(false);
  });
});

describe('resolveHttpBodyLimitBytes', () => {
  const ENV = 'OPENAWORK_TEST_HTTP_BODY_LIMIT';
  afterEach(() => {
    delete process.env[ENV];
  });

  it('未设置时返回 fallback', () => {
    delete process.env[ENV];
    expect(resolveHttpBodyLimitBytes(ENV, 1234)).toBe(1234);
  });

  it('设置正整数时返回该值（取整）', () => {
    process.env[ENV] = '4096.9';
    expect(resolveHttpBodyLimitBytes(ENV, 1234)).toBe(4096);
  });

  it('非正数 / NaN 时返回 0（禁用上限）', () => {
    process.env[ENV] = '0';
    expect(resolveHttpBodyLimitBytes(ENV, 1234)).toBe(0);
    process.env[ENV] = '-5';
    expect(resolveHttpBodyLimitBytes(ENV, 1234)).toBe(0);
    process.env[ENV] = 'notanumber';
    expect(resolveHttpBodyLimitBytes(ENV, 1234)).toBe(0);
  });
});

describe('readResponseJsonWithLimit', () => {
  it('正常解析未超限的 JSON 响应体', async () => {
    const res = fakeResponse({ body: [enc('{"items":['), enc('1,2,3]}')] });
    const parsed = await readResponseJsonWithLimit<{ items: number[] }>(res, 1024);
    expect(parsed.items).toEqual([1, 2, 3]);
  });

  it('JSON 响应体超过上限时拒绝（不缓冲整个 body）', async () => {
    // No content-length; stream past the 1024-byte cap.
    const chunk = new Uint8Array(600);
    const res = fakeResponse({ body: [chunk, chunk] });
    await expect(readResponseJsonWithLimit(res, 1024)).rejects.toThrow(/response body too large/);
  });

  it('已限界但内容非法 JSON 时抛出 SyntaxError', async () => {
    const res = fakeResponse({ body: [enc('{not valid json')] });
    await expect(readResponseJsonWithLimit(res, 1024)).rejects.toThrow(SyntaxError);
  });
});
