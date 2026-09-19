/**
 * `downloadFile` 的本地 HTTP 覆盖。
 *
 * 模块同时支持 http/https，因此测试直接用 `http.createServer`（免 TLS），
 * 所有调用显式传 `agentFor: () => undefined` 走直连。服务器监听 0 端口，
 * `afterAll` 统一关闭并清理临时目录。
 */

import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DownloadHttpError, downloadFile, type DownloadProgress } from './browser-download.js';

const BODY = 'hello-browser-download';
const CHUNKED_PARTS = ['chunk-1|', 'chunk-2|', 'chunk-3'];
const CHUNKED_BODY = CHUNKED_PARTS.join('');
const BURST_CHUNK_COUNT = 64;
const BURST_CHUNK = Buffer.alloc(1024, 0x61);

let server: Server;
let baseUrl: string;
let tempDir: string;

function handleRequest(request: IncomingMessage, response: ServerResponse): void {
  const path = request.url ?? '';

  if (path === '/ok') {
    response.writeHead(200, { 'content-length': String(BODY.length) });
    response.end(BODY);
    return;
  }

  if (path === '/chunked') {
    // 不设置 content-length：Node 自动使用 Transfer-Encoding: chunked。
    response.writeHead(200);
    for (const part of CHUNKED_PARTS) {
      response.write(part);
    }
    response.end();
    return;
  }

  if (path === '/redirect') {
    response.writeHead(302, { location: '/ok' });
    response.end();
    return;
  }

  if (path === '/loop') {
    response.writeHead(302, { location: '/loop' });
    response.end();
    return;
  }

  if (path === '/truncated') {
    // 声明的 content-length 远大于实际写入的字节数，并主动断开连接让客户端立即感知。
    response.writeHead(200, { 'content-length': '1000', connection: 'close' });
    response.end('short');
    return;
  }

  if (path === '/slow') {
    // 只写首块并保持连接不结束：用于验证 AbortSignal 取消。
    response.writeHead(200);
    response.write('first-chunk');
    return;
  }

  if (path === '/burst') {
    response.writeHead(200, {
      'content-length': String(BURST_CHUNK_COUNT * BURST_CHUNK.length),
    });
    let written = 0;
    const writeNext = (): void => {
      if (written >= BURST_CHUNK_COUNT) {
        response.end();
        return;
      }
      written += 1;
      response.write(BURST_CHUNK);
      setImmediate(writeNext);
    };
    writeNext();
    return;
  }

  response.writeHead(404, { 'content-length': '9' });
  response.end('not found');
}

async function captureError(action: () => Promise<void>): Promise<unknown> {
  try {
    await action();
    return null;
  } catch (error) {
    return error;
  }
}

function makeDestination(name: string): string {
  return join(tempDir, name);
}

beforeAll(async () => {
  server = createServer(handleRequest);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('无法解析本地 HTTP 服务器端口');
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
  tempDir = await mkdtemp(join(tmpdir(), 'oaw-browser-download-'));
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  await rm(tempDir, { recursive: true, force: true });
});

describe('downloadFile', () => {
  it('200 + content-length：内容落盘正确，最终进度为 100%', async () => {
    const destination = makeDestination('ok.bin');
    const progress: DownloadProgress[] = [];

    await downloadFile(`${baseUrl}/ok`, destination, {
      agentFor: () => undefined,
      onProgress: (item) => progress.push(item),
    });

    await expect(readFile(destination, 'utf8')).resolves.toBe(BODY);
    expect(progress[0]?.receivedBytes).toBeGreaterThan(0);
    const last = progress.at(-1);
    expect(last?.receivedBytes).toBe(BODY.length);
    expect(last?.totalBytes).toBe(BODY.length);
    expect(last?.percent).toBe(100);
  });

  it('chunked 200（无 content-length）：成功写盘，totalBytes 0 / percent null', async () => {
    const destination = makeDestination('chunked.bin');
    const progress: DownloadProgress[] = [];

    await downloadFile(`${baseUrl}/chunked`, destination, {
      agentFor: () => undefined,
      onProgress: (item) => progress.push(item),
    });

    await expect(readFile(destination, 'utf8')).resolves.toBe(CHUNKED_BODY);
    const last = progress.at(-1);
    expect(last?.receivedBytes).toBe(CHUNKED_BODY.length);
    expect(last?.totalBytes).toBe(0);
    expect(last?.percent).toBeNull();
  });

  it('302 → 200：跟随 Location 并重新解析代理后成功下载', async () => {
    const destination = makeDestination('redirect.bin');
    const seen: string[] = [];

    await downloadFile(`${baseUrl}/redirect`, destination, {
      agentFor: (current) => {
        seen.push(current);
        return undefined;
      },
    });

    await expect(readFile(destination, 'utf8')).resolves.toBe(BODY);
    expect(seen).toEqual([`${baseUrl}/redirect`, `${baseUrl}/ok`]);
  });

  it('重定向次数超过 maxRedirects：rejects 且不留下文件', async () => {
    const destination = makeDestination('loop.bin');

    const error = await captureError(() =>
      downloadFile(`${baseUrl}/loop`, destination, {
        agentFor: () => undefined,
        maxRedirects: 2,
      }),
    );

    expect(error instanceof Error ? error.message : '').toContain('重定向次数超过上限 2');
    expect(existsSync(destination)).toBe(false);
  });

  it('404：rejects 为 DownloadHttpError，status/url 正确且不留下文件', async () => {
    const destination = makeDestination('missing.bin');

    const error = await captureError(() =>
      downloadFile(`${baseUrl}/missing`, destination, { agentFor: () => undefined }),
    );

    expect(error).toBeInstanceOf(DownloadHttpError);
    if (!(error instanceof DownloadHttpError)) {
      throw new Error('预期抛出 DownloadHttpError');
    }
    expect(error.status).toBe(404);
    expect(error.url).toBe(`${baseUrl}/missing`);
    expect(error.message).toContain('404');
    expect(error.message).toContain(`${baseUrl}/missing`);
    expect(existsSync(destination)).toBe(false);
  });

  it('声明的 content-length 大于实际响应体：rejects 且删除残留文件', async () => {
    const destination = makeDestination('truncated.bin');

    const error = await captureError(() =>
      downloadFile(`${baseUrl}/truncated`, destination, { agentFor: () => undefined }),
    );

    expect(error instanceof Error ? error.message : '').toContain('下载不完整');
    expect(existsSync(destination)).toBe(false);
  });

  it('AbortController 中断下载：rejects 且删除残留文件', async () => {
    const destination = makeDestination('abort.bin');
    const controller = new AbortController();

    const error = await captureError(() =>
      downloadFile(`${baseUrl}/slow`, destination, {
        agentFor: () => undefined,
        signal: controller.signal,
        onProgress: () => controller.abort(),
      }),
    );

    expect(error instanceof Error ? error.name : '').toBe('AbortError');
    expect(existsSync(destination)).toBe(false);
  });

  it('进度节流：密集小块不会按块逐个上报', async () => {
    const destination = makeDestination('burst.bin');
    const progress: DownloadProgress[] = [];

    await downloadFile(`${baseUrl}/burst`, destination, {
      agentFor: () => undefined,
      onProgress: (item) => progress.push(item),
    });

    await expect(readFile(destination)).resolves.toHaveLength(
      BURST_CHUNK_COUNT * BURST_CHUNK.length,
    );
    // 无节流时至少 64 次数据事件 + 1 次完成事件；节流后远小于块数。
    expect(progress.length).toBeGreaterThan(0);
    expect(progress.length).toBeLessThan(BURST_CHUNK_COUNT);
    expect(progress.at(-1)?.percent).toBe(100);
  });
});
