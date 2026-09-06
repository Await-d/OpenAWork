import { beforeEach, describe, expect, it, vi } from 'vitest';

const ASYNC_EXTENSION_CHANNEL_CLOSED_MESSAGE =
  'A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received';

describe('installExtensionNoiseFilter', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('会消费浏览器扩展异步响应通道提前关闭产生的拒绝事件', async () => {
    const { installExtensionNoiseFilter } = await import('./extension-noise-filter.js');
    installExtensionNoiseFilter();

    const event = new PromiseRejectionEvent('unhandledrejection', {
      promise: Promise.resolve(),
      reason: new Error(ASYNC_EXTENSION_CHANNEL_CLOSED_MESSAGE),
      cancelable: true,
    });

    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it('不会消费应用自身的未处理拒绝事件', async () => {
    const { installExtensionNoiseFilter } = await import('./extension-noise-filter.js');
    installExtensionNoiseFilter();

    const event = new PromiseRejectionEvent('unhandledrejection', {
      promise: Promise.resolve(),
      reason: new Error('会话快照加载失败'),
      cancelable: true,
    });

    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });
});
