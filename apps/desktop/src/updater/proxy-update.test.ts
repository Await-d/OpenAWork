import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  let listener:
    | ((event: {
        payload:
          | {
              event: 'Started';
              data: {
                contentLength?: number;
              };
            }
          | {
              event: 'Progress';
              data: {
                chunkLength: number;
                downloaded: number;
                contentLength?: number;
              };
            };
      }) => void)
    | null = null;

  return {
    invoke: vi.fn(),
    listen: vi.fn(async (_eventName: string, callback: typeof listener) => {
      listener = callback;
      return vi.fn(async () => undefined);
    }),
    emit(payload: {
      event: 'Started' | 'Progress';
      data: {
        chunkLength?: number;
        downloaded?: number;
        contentLength?: number;
      };
    }) {
      listener?.({
        payload:
          payload.event === 'Started'
            ? {
                event: 'Started',
                data: {
                  contentLength: payload.data.contentLength,
                },
              }
            : {
                event: 'Progress',
                data: {
                  chunkLength: payload.data.chunkLength ?? 0,
                  downloaded: payload.data.downloaded ?? 0,
                  contentLength: payload.data.contentLength,
                },
              },
      });
    },
  };
});

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mocks.invoke,
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: mocks.listen,
}));

vi.mock('./auto-update.js', async () => {
  const actual = await vi.importActual('./auto-update.js');
  return actual;
});

vi.mock('@openAwork/shared', () => ({
  updaterJsonEndpointsForChannel: vi.fn(() => ({ endpoints: [] })),
}));

import { downloadAndInstallProxyUpdate } from './proxy-update.js';

describe('downloadAndInstallProxyUpdate', () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
    mocks.listen.mockClear();
  });

  it('在代理模式下调用 Tauri 安装命令并把事件映射成进度', async () => {
    mocks.invoke.mockImplementation(async () => {
      mocks.emit({
        event: 'Started',
        data: { contentLength: 100 },
      });
      mocks.emit({
        event: 'Progress',
        data: { chunkLength: 25, downloaded: 25, contentLength: 100 },
      });
      mocks.emit({
        event: 'Progress',
        data: { chunkLength: 75, downloaded: 100, contentLength: 100 },
      });
    });

    const progress: Array<{ downloaded: number; total: number | null; percent: number }> = [];

    await downloadAndInstallProxyUpdate(
      { name: 'GHProxy Fast', prefix: 'https://gh.llkk.cc/' },
      'preview',
      (snapshot) => {
        progress.push(snapshot);
      },
    );

    expect(mocks.listen).toHaveBeenCalledWith(
      'desktop:proxy-update-download',
      expect.any(Function),
    );
    expect(mocks.invoke).toHaveBeenCalledWith('download_and_install_proxy_update', {
      proxyPrefix: 'https://gh.llkk.cc/',
      channel: 'preview',
    });
    expect(progress).toEqual([
      { downloaded: 0, total: 100, percent: 0 },
      { downloaded: 25, total: 100, percent: 25 },
      { downloaded: 100, total: 100, percent: 100 },
      { downloaded: 100, total: 100, percent: 100 },
    ]);
  });
});
