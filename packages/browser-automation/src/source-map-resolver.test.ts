import { Buffer } from 'node:buffer';
import { createServer, type Server } from 'node:http';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  resolveStackFrames,
  resetSourceMapCaches,
  type RawStackFrame,
} from './source-map-resolver.js';

interface ServedFile {
  body: string;
  contentType: string;
}

const HANG_PATH = '/hang.js';

const files = new Map<string, ServedFile>();
const requestCounts = new Map<string, number>();

let server: Server;
let baseUrl = '';

function totalRequests(): number {
  let total = 0;
  for (const count of requestCounts.values()) {
    total += count;
  }
  return total;
}

function readUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

beforeAll(async () => {
  server = createServer((request, response) => {
    const path = request.url ?? '/';
    requestCounts.set(path, (requestCounts.get(path) ?? 0) + 1);

    if (path === HANG_PATH) {
      // 故意不响应，用于验证超时回退。
      return;
    }

    const file = files.get(path);
    if (!file) {
      response.statusCode = 404;
      response.end('not found');
      return;
    }
    response.setHeader('content-type', file.contentType);
    response.end(file.body);
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('test server did not expose a TCP port');
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  // 超时用例会留下悬挂连接，先强制断开以避免 close() 挂起。
  server.closeAllConnections();
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
});

beforeEach(() => {
  files.clear();
  requestCounts.clear();
  resetSourceMapCaches();
});

describe('resolveStackFrames', () => {
  it('resolves an external source map and exposes sourcesContent-backed source', async () => {
    const sourcesContent = ['export const a = 1;\nconsole.error("two");\n'];
    const map = {
      version: 3,
      file: 'assets/bundle.js',
      sources: ['orig.ts'],
      names: [],
      // gen 行 0 列 0 → orig 行 0 列 0；gen 行 1 列 0 → orig 行 1 列 0。
      mappings: 'AAAA;AACA',
      sourcesContent,
    };
    files.set('/assets/bundle.js', {
      body: 'console.error("two");\n//# sourceMappingURL=bundle.js.map',
      contentType: 'text/javascript',
    });
    files.set('/assets/bundle.js.map', {
      body: JSON.stringify(map),
      contentType: 'application/json',
    });

    const resolved = await resolveStackFrames([
      { url: `${baseUrl}/assets/bundle.js`, line: 1, column: 0, functionName: 'boom' },
    ]);

    expect(resolved).toHaveLength(1);
    const frame = resolved[0];
    expect(frame?.mapped).toBe(true);
    expect(frame?.functionName).toBe('boom');
    expect(frame?.sourceName).toBe('orig.ts');
    expect(frame?.sourceLine).toBe(1);
    expect(frame?.sourceColumn).toBe(0);
    expect(frame?.source).toBe(sourcesContent[0]);
    // 外部 map 路径相对脚本 URL（`/assets/bundle.js`）解析。
    expect(requestCounts.get('/assets/bundle.js.map')).toBe(1);
  });

  it('resolves an inline base64 source map', async () => {
    const sourcesContent = ['const inline = 1;\n'];
    const map = {
      version: 3,
      sources: ['inline.ts'],
      names: [],
      mappings: 'AAAA',
      sourcesContent,
    };
    const encoded = Buffer.from(JSON.stringify(map), 'utf8').toString('base64');
    files.set('/inline.js', {
      body: `throw new Error('x');\n//# sourceMappingURL=data:application/json;base64,${encoded}`,
      contentType: 'text/javascript',
    });

    const resolved = await resolveStackFrames([
      { url: `${baseUrl}/inline.js`, line: 0, column: 0 },
    ]);

    const frame = resolved[0];
    expect(frame?.mapped).toBe(true);
    expect(frame?.sourceName).toBe('inline.ts');
    expect(frame?.sourceLine).toBe(0);
    expect(frame?.sourceColumn).toBe(0);
    expect(frame?.source).toBe(sourcesContent[0]);
  });

  it('falls back to mapped:false when the script has no source map', async () => {
    files.set('/nomap.js', {
      body: 'console.error("nope");',
      contentType: 'text/javascript',
    });

    const resolved = await resolveStackFrames([{ url: `${baseUrl}/nomap.js`, line: 0, column: 0 }]);

    const frame = resolved[0];
    expect(frame?.mapped).toBe(false);
    expect(frame?.source).toBeNull();
    expect(frame?.sourceLine).toBeNull();
    expect(frame?.sourceColumn).toBeNull();
    expect(frame?.sourceName).toBeNull();
  });

  it('skips non-http frames without issuing any fetch', async () => {
    const resolved = await resolveStackFrames([
      { url: 'data:text/javascript,throw%20new%20Error()', line: 0, column: 0 },
      { url: 'blob:https://example.test/abc', line: 1, column: 2 },
      { url: 'about:blank', line: 3, column: 4 },
      { url: 'chrome-extension://abc/panel.js', line: 5, column: 6 },
    ]);

    expect(resolved).toHaveLength(4);
    for (const frame of resolved) {
      expect(frame.mapped).toBe(false);
      expect(frame.source).toBeNull();
    }
    expect(totalRequests()).toBe(0);
  });

  it('truncates to maxFrames before resolving', async () => {
    files.set('/many.js', {
      body: 'console.log(1);',
      contentType: 'text/javascript',
    });

    const frames: RawStackFrame[] = [
      { url: `${baseUrl}/many.js`, line: 0, column: 0 },
      { url: `${baseUrl}/many.js`, line: 1, column: 0 },
      { url: `${baseUrl}/many.js`, line: 2, column: 0 },
    ];

    const resolved = await resolveStackFrames(frames, { maxFrames: 2 });
    expect(resolved).toHaveLength(2);
    expect(resolved.map((frame) => frame.line)).toEqual([0, 1]);
  });

  it('degrades gracefully when the fetch rejects', async () => {
    const failingFetch: typeof fetch = () => Promise.reject(new Error('network down'));

    const resolved = await resolveStackFrames(
      [{ url: 'http://127.0.0.1:1/offline.js', line: 0, column: 0 }],
      { fetchImpl: failingFetch },
    );

    expect(resolved[0]?.mapped).toBe(false);
    expect(resolved[0]?.source).toBeNull();
  });

  it('degrades gracefully on timeout', async () => {
    const resolved = await resolveStackFrames(
      [{ url: `${baseUrl}${HANG_PATH}`, line: 0, column: 0 }],
      { timeoutMs: 50 },
    );

    expect(resolved[0]?.mapped).toBe(false);
    expect(resolved[0]?.source).toBeNull();
    expect(requestCounts.get(HANG_PATH)).toBe(1);
  });

  it('caches scripts and source maps per URL until reset', async () => {
    const map = {
      version: 3,
      sources: ['cached.ts'],
      names: [],
      mappings: 'AAAA',
      sourcesContent: ['const cached = true;\n'],
    };
    files.set('/cached.js', {
      body: 'console.log(1);\n//# sourceMappingURL=cached.js.map',
      contentType: 'text/javascript',
    });
    files.set('/cached.js.map', {
      body: JSON.stringify(map),
      contentType: 'application/json',
    });

    const calls: string[] = [];
    const countingFetch: typeof fetch = (input, init) => {
      calls.push(readUrl(input));
      return fetch(input, init);
    };

    const frame = { url: `${baseUrl}/cached.js`, line: 0, column: 0 };
    await resolveStackFrames([frame], { fetchImpl: countingFetch });
    expect(calls).toEqual([`${baseUrl}/cached.js`, `${baseUrl}/cached.js.map`]);

    // 第二次调用命中缓存，不发生新的网络请求。
    const cached = await resolveStackFrames([frame], { fetchImpl: countingFetch });
    expect(calls).toHaveLength(2);
    expect(cached[0]?.mapped).toBe(true);

    resetSourceMapCaches();

    await resolveStackFrames([frame], { fetchImpl: countingFetch });
    expect(calls).toHaveLength(4);
  });
});
