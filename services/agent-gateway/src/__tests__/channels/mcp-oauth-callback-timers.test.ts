import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DesktopLocalhostCallbackHandler,
  MobileDeepLinkCallbackHandler,
} from '../../channels/mcp-oauth.js';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('MobileDeepLinkCallbackHandler timer cleanup', () => {
  it('成功回调后清理超时定时器，超时回调不再触发 reject', async () => {
    vi.useFakeTimers();
    const handler = new MobileDeepLinkCallbackHandler();
    const p = handler.waitForCallback('state-1', 300_000);

    handler.handleDeepLink('myapp://mcp/oauth/callback?code=abc&state=state-1');
    await expect(p).resolves.toBe('abc');

    // 推进超过超时时长：若定时器未清理会触发一个无主 reject（已 settle 的 promise 不受影响，
    // 但 pending 定时器会令 fake-timer 队列非空）。验证没有待触发定时器。
    expect(vi.getTimerCount()).toBe(0);
  });

  it('dispose 清理所有未决定时器', () => {
    vi.useFakeTimers();
    const handler = new MobileDeepLinkCallbackHandler();
    void handler.waitForCallback('s-a', 300_000).catch(() => undefined);
    void handler.waitForCallback('s-b', 300_000).catch(() => undefined);
    expect(vi.getTimerCount()).toBe(2);
    handler.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('超时会 reject 并清理定时器', async () => {
    vi.useFakeTimers();
    const handler = new MobileDeepLinkCallbackHandler();
    const p = handler.waitForCallback('s-timeout', 1000);
    const settled = expect(p).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(1000);
    await settled;
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('DesktopLocalhostCallbackHandler timer cleanup', () => {
  it('dispose 清理超时定时器（不泄漏）', () => {
    vi.useFakeTimers();
    const handler = new DesktopLocalhostCallbackHandler();
    void handler.waitForCallback('state-x', 300_000).catch(() => undefined);
    // listen + setTimeout 已排程；dispose 后定时器应被清理。
    handler.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
});
