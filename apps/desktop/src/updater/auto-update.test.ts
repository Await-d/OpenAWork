import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Update } from '@tauri-apps/plugin-updater';

// auto-update.ts imports `check` from the Tauri updater plugin at module load;
// stub it so the module resolves under vitest (we only exercise the
// proxy-download path here, which never touches the native plugin).
vi.mock('@tauri-apps/plugin-updater', () => ({
  check: vi.fn(),
}));
// github-proxy pulls in browser/Tauri globals transitively; the download path
// under test takes a fully-formed URL and never calls into it.
vi.mock('./github-proxy.js', () => ({
  detectFastestProxy: vi.fn(),
  proxyUrl: (url: string) => url,
}));

vi.mock('@openAwork/shared', () => ({
  updaterJsonEndpointsForChannel: vi.fn(() => ({ endpoints: [] })),
}));

import {
  downloadUpdate,
  downloadUpdateViaProxy,
  installUpdate,
  UpdateError,
} from './auto-update.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** Build a Response whose body streams the given chunks, one per `read()`. */
function streamingResponse(chunks: Uint8Array[]): Response {
  let i = 0;
  const body = {
    getReader() {
      return {
        read: async () =>
          i < chunks.length
            ? { done: false, value: chunks[i++] }
            : { done: true, value: undefined },
        cancel: async () => undefined,
      };
    },
  };
  return {
    ok: true,
    status: 200,
    headers: { get: (k: string) => (k === 'content-length' ? '6' : null) },
    body,
  } as unknown as Response;
}

describe('downloadUpdateViaProxy (§0.149 stall watchdog)', () => {
  it('正常分块下载时合并为完整 ArrayBuffer 并上报进度', async () => {
    globalThis.fetch = vi.fn(async () =>
      streamingResponse([new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6])]),
    ) as typeof fetch;

    const progress: number[] = [];
    const buf = await downloadUpdateViaProxy('https://proxy.test/app.tar.gz', (p) => {
      progress.push(p.downloaded);
    });

    expect(new Uint8Array(buf)).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6]));
    expect(progress).toEqual([3, 6]);
  });

  it('非 2xx 响应抛出网络型 UpdateError', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 503,
      headers: { get: () => null },
    })) as unknown as typeof fetch;

    await expect(
      downloadUpdateViaProxy('https://proxy.test/app.tar.gz', () => undefined),
    ).rejects.toBeInstanceOf(UpdateError);
  });

  it('初始 fetch 挂起超过 stall 阈值时 abort 并抛网络错误（不永久 pending）', async () => {
    // fetch never resolves on its own but honours the injected abort signal.
    globalThis.fetch = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }),
    ) as unknown as typeof fetch;

    await expect(
      downloadUpdateViaProxy('https://proxy.test/app.tar.gz', () => undefined, 20),
    ).rejects.toMatchObject({ kind: 'network' });
  });

  it('下载中途停滞超过 stall 阈值时 abort 并抛网络错误', async () => {
    // First read returns a chunk, then the stream goes silent (read() hangs)
    // until the abort signal fires.
    let readCount = 0;
    const body = {
      getReader() {
        return {
          read: (): Promise<ReadableStreamReadResult<Uint8Array>> => {
            readCount += 1;
            if (readCount === 1) {
              return Promise.resolve({ done: false, value: new Uint8Array([1, 2]) });
            }
            // Stall: never resolves; the watchdog must abort the controller,
            // which rejects this read via the response body's abort handling.
            return new Promise<ReadableStreamReadResult<Uint8Array>>(() => undefined);
          },
          cancel: async () => undefined,
        };
      },
    };
    // The controller.abort() in the watchdog won't auto-reject our hand-rolled
    // read(), so simulate the platform behaviour: reject the hung read when the
    // signal aborts. We wire that by reading the signal off the fetch init.
    let abortSignal: AbortSignal | undefined;
    globalThis.fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      abortSignal = init?.signal ?? undefined;
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        body: {
          getReader() {
            const inner = body.getReader();
            return {
              read: (): Promise<ReadableStreamReadResult<Uint8Array>> =>
                Promise.race([
                  inner.read(),
                  new Promise<ReadableStreamReadResult<Uint8Array>>((_r, reject) => {
                    abortSignal?.addEventListener('abort', () => {
                      const err = new Error('aborted');
                      err.name = 'AbortError';
                      reject(err);
                    });
                  }),
                ]),
              cancel: async () => undefined,
            };
          },
        },
      } as unknown as Response;
    }) as unknown as typeof fetch;

    await expect(
      downloadUpdateViaProxy('https://proxy.test/app.tar.gz', () => undefined, 20),
    ).rejects.toMatchObject({ kind: 'network' });
  });

  it('安装前先执行 beforeInstall 钩子，避免旧 sidecar 占用更新文件', async () => {
    const calls: string[] = [];
    const update = {
      install: vi.fn(async () => {
        calls.push('install');
      }),
    } as unknown as Update;

    await installUpdate(update, {
      beforeInstall: async () => {
        calls.push('before');
      },
    });

    expect(calls).toEqual(['before', 'install']);
  });
});

describe('downloadUpdateViaProxy user cancel', () => {
  it('用户取消 signal 时抛 cancelled', async () => {
    const controller = new AbortController();
    globalThis.fetch = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }),
    ) as typeof fetch;

    const pending = downloadUpdateViaProxy(
      'https://proxy.test/app.tar.gz',
      () => undefined,
      60_000,
      controller.signal,
    );
    controller.abort();
    await expect(pending).rejects.toMatchObject({ kind: 'cancelled', message: '更新已取消' });
  });
});

describe('downloadUpdate native cancel', () => {
  it('abort signal 时 close Update 并抛 cancelled', async () => {
    let resolveDownload: (() => void) | undefined;
    const close = vi.fn(async () => undefined);
    const update = {
      download: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveDownload = resolve;
          }),
      ),
      close,
    } as unknown as Update;

    const controller = new AbortController();
    const pending = downloadUpdate(update, () => undefined, { signal: controller.signal });
    await Promise.resolve();
    controller.abort();
    resolveDownload?.();

    await expect(pending).rejects.toMatchObject({ kind: 'cancelled', message: '更新已取消' });
    expect(close).toHaveBeenCalled();
  });

  it('signal 已 aborted 时不启动 download', async () => {
    const download = vi.fn(async () => undefined);
    const close = vi.fn(async () => undefined);
    const update = { download, close } as unknown as Update;
    const controller = new AbortController();
    controller.abort();

    await expect(
      downloadUpdate(update, () => undefined, { signal: controller.signal }),
    ).rejects.toMatchObject({ kind: 'cancelled' });
    expect(download).not.toHaveBeenCalled();
  });
});
