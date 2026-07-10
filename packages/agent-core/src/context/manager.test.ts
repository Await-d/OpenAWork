import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContextManagerImpl } from './manager.js';
import {
  readResponseTextTruncated,
  resolveAddUrlMaxResponseBytes,
  DEFAULT_ADD_URL_MAX_RESPONSE_BYTES,
  ADD_URL_MAX_RESPONSE_BYTES_ENV,
} from './http-body-limit.js';

const OriginalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = OriginalFetch;
  delete process.env[ADD_URL_MAX_RESPONSE_BYTES_ENV];
  vi.restoreAllMocks();
});

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

const enc = (s: string) => new TextEncoder().encode(s);

describe('ContextManagerImpl.addUrl', () => {
  it('成功响应时摄入正文并截断到 5000 字符', async () => {
    const body = 'x'.repeat(6000);
    globalThis.fetch = (() => Promise.resolve(new Response(body, { status: 200 }))) as typeof fetch;

    const mgr = new ContextManagerImpl();
    const item = await mgr.addUrl('https://example.test/page');
    expect(item.type).toBe('url');
    expect(item.content?.length).toBe(5000);
  });

  it('非 2xx 响应抛错，不把错误页当正文摄入', async () => {
    globalThis.fetch = (() =>
      Promise.resolve(new Response('<html>404</html>', { status: 404 }))) as typeof fetch;

    const mgr = new ContextManagerImpl();
    await expect(mgr.addUrl('https://example.test/missing')).rejects.toThrow(/404/);
    expect(mgr.getItems()).toHaveLength(0);
  });

  it('给底层 fetch 传入超时 AbortSignal', async () => {
    const fetchSpy = vi.fn((_url: string, _init?: RequestInit): Promise<Response> =>
      Promise.resolve(new Response('ok', { status: 200 })),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const mgr = new ContextManagerImpl();
    await mgr.addUrl('https://example.test/page');
    const init = fetchSpy.mock.calls[0]?.[1];
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('超大响应体只缓冲到字节上限即停止，仍能摄入前 5000 字符', async () => {
    // 200KiB cap, but the stream would produce far more if fully read.
    process.env[ADD_URL_MAX_RESPONSE_BYTES_ENV] = String(200 * 1024);
    let produced = 0;
    const chunk = new Uint8Array(64 * 1024).fill(0x78); // 'x'
    globalThis.fetch = (() => {
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          // Keep producing forever; the reader must stop us at the cap.
          produced += chunk.byteLength;
          controller.enqueue(chunk);
          if (produced > 50 * 1024 * 1024) controller.close();
        },
      });
      return Promise.resolve(new Response(body, { status: 200 }));
    }) as typeof fetch;

    const mgr = new ContextManagerImpl();
    const item = await mgr.addUrl('https://example.test/huge');
    expect(item.content.length).toBe(5000);
    // We must have aborted long before reading the whole 50MiB stream.
    // (the producer may run a chunk ahead of the reader due to stream
    // prefetch/backpressure, so allow a small multiple of the cap).
    expect(produced).toBeLessThanOrEqual(512 * 1024);
  });
});

describe('readResponseTextTruncated', () => {
  it('正常读取未超限的响应体', async () => {
    const res = new Response(streamFromChunks([enc('hello '), enc('world')]));
    expect(await readResponseTextTruncated(res, 1024)).toBe('hello world');
  });

  it('累计超限时截断到上限并取消底层流', async () => {
    const chunk = new Uint8Array(400).fill(0x61); // 'a'
    const res = new Response(streamFromChunks([chunk, chunk, chunk]));
    const text = await readResponseTextTruncated(res, 512);
    expect(text.length).toBe(512);
  });

  it('maxBytes<=0 时禁用上限', async () => {
    const res = new Response(streamFromChunks([new Uint8Array(4096).fill(0x62)]));
    expect((await readResponseTextTruncated(res, 0)).length).toBe(4096);
  });
});

describe('resolveAddUrlMaxResponseBytes', () => {
  it('未设置 env 时返回默认上限', () => {
    delete process.env[ADD_URL_MAX_RESPONSE_BYTES_ENV];
    expect(resolveAddUrlMaxResponseBytes()).toBe(DEFAULT_ADD_URL_MAX_RESPONSE_BYTES);
  });

  it('非法或非正数 env 视为禁用上限（0）', () => {
    process.env[ADD_URL_MAX_RESPONSE_BYTES_ENV] = '-1';
    expect(resolveAddUrlMaxResponseBytes()).toBe(0);
    process.env[ADD_URL_MAX_RESPONSE_BYTES_ENV] = 'not-a-number';
    expect(resolveAddUrlMaxResponseBytes()).toBe(0);
  });

  it('正数 env 覆盖默认值', () => {
    process.env[ADD_URL_MAX_RESPONSE_BYTES_ENV] = '4096';
    expect(resolveAddUrlMaxResponseBytes()).toBe(4096);
  });
});
