import { beforeEach, describe, expect, it, vi } from 'vitest';
import { webfetchTool } from '../../tools/web-tools.js';

/**
 * 回归（2026-10-18 排障）：非 2xx 错误正文此前上限 512 字节，恰好覆盖线上的
 * 401/403 拦截页（Reuters/WSJ ~767–771B），超限后正文整包丢弃 → 模型零诊断信息，
 * 对同一被反爬站点换了十几个 URL 反复重试。修复后：
 *   1. 错误正文保留前缀（截断 + 显式标注），不再抛「读正文失败」；
 *   2. 上限放宽到 4KB；
 *   3. 401 独立给出「这是反爬、别重试」的排查建议。
 */

const NO_SIGNAL = new AbortController().signal;

describe('webfetch 非 2xx 错误正文诊断', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('401 的错误正文完整回灌（771B 在新 4K 上限内），并附 401 专属排查建议', async () => {
    // 真实排障中的 Reuters 401 页大小：content-length 771（超旧 512 上限的形态）。
    const body = `<html><body>Login required. ${'x'.repeat(500)}</body></html>`;
    expect(Buffer.byteLength(body, 'utf8')).toBeGreaterThan(512);
    expect(Buffer.byteLength(body, 'utf8')).toBeLessThanOrEqual(4096);
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(body, {
        status: 401,
        headers: { 'content-type': 'text/html', 'content-length': String(body.length) },
      }),
    );

    // 正文本身必须出现（旧实现在此处只给出「响应正文读取失败」）。
    const error = await webfetchTool
      .execute({ url: 'https://www.reuters.com/world/', format: 'text', timeout: 20 }, NO_SIGNAL)
      .then(
        () => null,
        (reason: unknown) => reason as Error,
      );
    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toContain('Login required.');
    expect(error?.message).not.toContain('响应正文读取失败');
    expect(error?.message).toMatch(/排查建议：401 常见于站点对爬虫返回「需要登录」/);
  });

  it('错误正文超过 4K 时保留前缀并显式标注截断，而不是丢弃整包', async () => {
    // 用 JSON content-type 走非 htmlToText 分支，确保断言的是「读正文」而非「HTML 清洗」。
    const oversized = JSON.stringify({
      message: 'cloudflare-blocks-agents',
      pad: 'A'.repeat(5000),
    });
    // 不带 cf-mitigated：否则会触发「换 UA 重试一次」，而 mock 复用同一 Response
    // 实例时首个 body 已被 cancel，第二次读到空正文，断言对象就不是本用例了。
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(oversized, {
        status: 403,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const error = await webfetchTool
      .execute({ url: 'https://apnews.com/hub/world-news', format: 'text', timeout: 20 }, NO_SIGNAL)
      .then(
        () => null,
        (reason: unknown) => reason as Error,
      );
    expect(error).toBeInstanceOf(Error);
    // 前缀内容被保留（旧实现是整包丢弃 + 「响应正文读取失败」）。
    expect(error?.message).toContain('cloudflare-blocks-agents');
    expect(error?.message).toContain('已截断');
    expect(error?.message).not.toContain('响应正文读取失败');
  });

  it('Cloudflare challenge 的 403 文案点名「换 UA 重试已自动做过」，普通 403 仍走通用建议', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response('cf challenge page', {
        status: 403,
        headers: { 'cf-mitigated': 'challenge' },
      }),
    );
    await expect(
      webfetchTool.execute(
        { url: 'https://apnews.com/hub/world-news', format: 'text', timeout: 20 },
        NO_SIGNAL,
      ),
    ).rejects.toThrow(/换 UA 重试已由本工具自动做过一次/);

    vi.mocked(globalThis.fetch).mockResolvedValue(new Response('plain forbidden', { status: 403 }));
    await expect(
      webfetchTool.execute(
        { url: 'https://example.com/plain-forbidden', format: 'text', timeout: 20 },
        NO_SIGNAL,
      ),
    ).rejects.toThrow(/排查建议：403\/429 通常是限流或 UA 拦截/);
  });

  it('文本错误正文不被 htmlToText 清洗以外的路径改写', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response('{"message":"API rate limit exceeded"}', {
        status: 429,
        headers: { 'content-type': 'application/json' },
      }),
    );

    await expect(
      webfetchTool.execute(
        { url: 'https://api.github.com/repos/a/b', format: 'text', timeout: 20 },
        NO_SIGNAL,
      ),
    ).rejects.toThrow(/API rate limit exceeded/);
  });
});
