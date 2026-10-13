import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { webfetchTool } from '../../tools/web-tools.js';

/**
 * 回归（2026-10-12 线上排障）：底层网络错误曾直接透传给模型与用户——
 * `getaddrinfo ENOTFOUND raw.githubusercontent.com`、`webfetch timeout exceeded`
 * 都没有可操作信息。这里钉住按错误类型归因的中文文案契约。
 */

const NO_SIGNAL = new AbortController().signal;

function rejectWith(error: Error): void {
  vi.mocked(globalThis.fetch).mockRejectedValue(error);
}

describe('webfetch 网络错误归因', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('DNS 解析失败（ENOTFOUND）给出镜像源建议', async () => {
    rejectWith(
      Object.assign(new Error('getaddrinfo ENOTFOUND raw.githubusercontent.com'), {
        code: 'ENOTFOUND',
      }),
    );

    await expect(
      webfetchTool.execute(
        {
          url: 'https://raw.githubusercontent.com/a/b/master/README.md',
          format: 'text',
          timeout: 20,
        },
        NO_SIGNAL,
      ),
    ).rejects.toThrow(/无法解析域名 raw\.githubusercontent\.com（DNS 解析失败）/);
  });

  it('工具超时给出阈值与应对方式，而非英文标记', async () => {
    rejectWith(new Error('webfetch timeout exceeded'));

    await expect(
      webfetchTool.execute(
        { url: 'https://hub.docker.com/v2/repositories/x/y/tags', format: 'text', timeout: 20 },
        NO_SIGNAL,
      ),
    ).rejects.toThrow(/webfetch 超时（20s）：hub\.docker\.com/);
  });

  it('连接被拒 / 被重置分别归因', async () => {
    rejectWith(
      Object.assign(new Error('connect ECONNREFUSED 1.2.3.4:443'), { code: 'ECONNREFUSED' }),
    );
    await expect(
      webfetchTool.execute(
        { url: 'https://example.com/x', format: 'text', timeout: 20 },
        NO_SIGNAL,
      ),
    ).rejects.toThrow(/example\.com 拒绝连接/);

    rejectWith(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }));
    await expect(
      webfetchTool.execute(
        { url: 'https://example.com/x', format: 'text', timeout: 20 },
        NO_SIGNAL,
      ),
    ).rejects.toThrow(/连接被重置/);
  });

  it('未知错误保留原始信息并附上主机名', async () => {
    rejectWith(new Error('something exotic happened'));

    await expect(
      webfetchTool.execute(
        { url: 'https://example.com/x', format: 'text', timeout: 20 },
        NO_SIGNAL,
      ),
    ).rejects.toThrow(/something exotic happened（example\.com）/);
  });

  it('用户取消（父级 signal 已中止）原样透传，不得改写成超时', async () => {
    rejectWith(new Error('webfetch timeout exceeded'));
    const controller = new AbortController();
    controller.abort();

    await expect(
      webfetchTool.execute(
        { url: 'https://example.com/x', format: 'text', timeout: 20 },
        controller.signal,
      ),
    ).rejects.toThrow(/^webfetch timeout exceeded$/);
  });
});
