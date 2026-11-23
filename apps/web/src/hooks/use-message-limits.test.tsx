import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MESSAGE_LIMITS_POLL_MS, useMessageLimits } from './use-message-limits.js';

const { read, write } = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }));
vi.mock('@openAwork/web-client', async (original) => ({
  ...(await original<typeof import('@openAwork/web-client')>()),
  createMessageLimitsClient: () => ({ read, write }),
}));
const snapshot = { maxChars: 4096, canEdit: true };
let identity = 0;
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  read.mockResolvedValue(snapshot);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  identity += 1;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
const mount = (token = `poll-${identity}`) =>
  renderHook(() => useMessageLimits('http://poll.test', token));

it('持续挂载的客户端定时获取远端上限，卸载后停止', async () => {
  const hook = mount();
  await act(async () => undefined);
  expect(hook.result.current.maxChars).toBe(4096);
  read.mockResolvedValue({ ...snapshot, maxChars: 8192 });
  await act(async () => vi.advanceTimersByTimeAsync(MESSAGE_LIMITS_POLL_MS));
  expect(hook.result.current.maxChars).toBe(8192);
  hook.unmount();
  const calls = read.mock.calls.length;
  await act(async () => vi.advanceTimersByTimeAsync(MESSAGE_LIMITS_POLL_MS * 2));
  expect(read).toHaveBeenCalledTimes(calls);
});

it('隐藏时不轮询，重新可见即刷新，重叠事件只产生一次读取', async () => {
  const hook = mount();
  await act(async () => undefined);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  await act(async () => vi.advanceTimersByTimeAsync(MESSAGE_LIMITS_POLL_MS * 3));
  expect(read).toHaveBeenCalledTimes(1);
  let finish!: (value: typeof snapshot) => void;
  read.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
  });
  await act(async () => vi.advanceTimersByTimeAsync(MESSAGE_LIMITS_POLL_MS));
  expect(read).toHaveBeenCalledTimes(2);
  await act(async () => finish({ ...snapshot, maxChars: 1024 }));
  expect(hook.result.current.maxChars).toBe(1024);
});

it('保存使在途旧读取失效，读取完成前不重叠请求', async () => {
  const hook = mount();
  await act(async () => undefined);
  let finish!: (value: typeof snapshot) => void;
  read.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  act(() => hook.result.current.reload());
  write.mockResolvedValue({ ...snapshot, maxChars: 8192 });
  await act(async () => {
    await hook.result.current.save(8192);
  });
  expect(read).toHaveBeenCalledTimes(2);
  await act(async () => finish(snapshot));
  expect(hook.result.current.maxChars).toBe(8192);
});

it('清理闲置身份缓存后重新进入会重新读取，保留活跃订阅', async () => {
  const active = mount('active');
  await act(async () => undefined);
  for (let index = 0; index < 20; index++) {
    const hook = mount(`inactive-${index}`);
    await act(async () => undefined);
    hook.unmount();
  }
  const fresh = mount('inactive-0');
  expect(fresh.result.current.snapshot).toBeNull();
  await act(async () => undefined);
  expect(active.result.current.maxChars).toBe(4096);
});
