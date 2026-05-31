/**
 * Robustness: skill-registry fetched manifests / listings / zipballs from
 * arbitrary remote URLs and read them with `response.text()` / `.json()` /
 * `.arrayBuffer()`, buffering the WHOLE body. A wall-clock timeout does not
 * bound memory — a fast server can stream gigabytes within the deadline — so a
 * large or hostile response (a zip bomb's compressed payload) would OOM the
 * host. These readers enforce a hard byte ceiling and abort once crossed.
 */

import { describe, expect, it } from 'vitest';
import {
  readResponseTextWithLimit,
  readResponseJsonWithLimit,
  readResponseArrayBufferWithLimit,
} from './http.js';

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
    const res = fakeResponse({ body: [enc('{"ok":'), enc('true}')] });
    expect(await readResponseTextWithLimit(res, 1024)).toBe('{"ok":true}');
  });

  it('content-length 超限时读取前即拒绝', async () => {
    const res = fakeResponse({ body: [enc('x')], contentLength: 99_999 });
    await expect(readResponseTextWithLimit(res, 1024)).rejects.toThrow(
      /registry response too large: content-length/,
    );
  });

  it('content-length 缺失/谎报时流式累计超限即中止', async () => {
    const chunk = new Uint8Array(400);
    const res = fakeResponse({ body: [chunk, chunk, chunk] });
    await expect(readResponseTextWithLimit(res, 512)).rejects.toThrow(
      /registry response too large: exceeds limit/,
    );
  });

  it('maxBytes<=0 时禁用上限', async () => {
    const res = fakeResponse({ body: [new Uint8Array(4096)] });
    expect((await readResponseTextWithLimit(res, 0)).length).toBe(4096);
  });
});

describe('readResponseJsonWithLimit', () => {
  it('在上限内解析 JSON', async () => {
    const res = fakeResponse({ body: [enc('{"items":[]}')] });
    const parsed = await readResponseJsonWithLimit<{ items: unknown[] }>(res, 1024);
    expect(parsed.items).toEqual([]);
  });
});

describe('readResponseArrayBufferWithLimit', () => {
  it('正常读取未超限的二进制响应', async () => {
    const res = fakeResponse({ body: [new Uint8Array([1, 2, 3])] });
    const bytes = await readResponseArrayBufferWithLimit(res, 1024);
    expect(Array.from(bytes)).toEqual([1, 2, 3]);
  });

  it('超大归档（zip bomb 压缩载荷）在累计超限时中止', async () => {
    const chunk = new Uint8Array(400);
    const res = fakeResponse({ body: [chunk, chunk, chunk] });
    await expect(readResponseArrayBufferWithLimit(res, 512)).rejects.toThrow(
      /registry archive too large: exceeds limit/,
    );
  });

  it('content-length 超限时读取前即拒绝', async () => {
    const res = fakeResponse({ body: [new Uint8Array(1)], contentLength: 99_999_999 });
    await expect(readResponseArrayBufferWithLimit(res, 1024)).rejects.toThrow(
      /registry archive too large: content-length/,
    );
  });
});
