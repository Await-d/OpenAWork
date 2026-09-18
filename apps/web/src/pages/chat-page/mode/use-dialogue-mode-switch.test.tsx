// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  subscribeSessionDialogueModeSwitch,
  type SessionDialogueModeSwitch,
} from '../../../utils/session/dialogue-mode-events.js';
import { useDialogueModeSwitch } from './use-dialogue-mode-switch.js';

const toastMock = vi.hoisted(() => vi.fn());

vi.mock('../../../components/common/feedback/ToastNotification.js', () => ({
  toast: toastMock,
}));

const GATEWAY_URL = 'http://localhost:3000';
const SESSION_ID = 'session-1';

function makeOptions(overrides: Partial<Parameters<typeof useDialogueModeSwitch>[0]> = {}) {
  return {
    enabled: true,
    gatewayUrl: GATEWAY_URL,
    sessionId: SESSION_ID,
    token: 'token-1',
    ...overrides,
  };
}

beforeEach(() => {
  toastMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useDialogueModeSwitch — 确认转换', () => {
  it('成功后广播 user 来源的模式切换', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, switched: true, dialogueMode: 'coding' }),
    }));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const received: SessionDialogueModeSwitch[] = [];
    const unsubscribe = subscribeSessionDialogueModeSwitch((event) => received.push(event));

    const { result } = renderHook(() => useDialogueModeSwitch(makeOptions()));
    await act(async () => {
      await result.current.confirmSwitchToCoding();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      `${GATEWAY_URL}/sessions/${SESSION_ID}/clarify/confirm`,
    );
    expect(received).toEqual([{ dialogueMode: 'coding', sessionId: SESSION_ID, source: 'user' }]);
    expect(toastMock).not.toHaveBeenCalled();
    expect(result.current.pending).toBe(false);

    unsubscribe();
  });

  it('服务端说"无需切换"时采用服务端模式并给出 info 提示', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, switched: false, dialogueMode: 'programmer' }),
    }));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const received: SessionDialogueModeSwitch[] = [];
    const unsubscribe = subscribeSessionDialogueModeSwitch((event) => received.push(event));

    const { result } = renderHook(() => useDialogueModeSwitch(makeOptions()));
    await act(async () => {
      await result.current.confirmSwitchToCoding();
    });

    expect(received).toEqual([
      { dialogueMode: 'programmer', sessionId: SESSION_ID, source: 'user' },
    ]);
    expect(toastMock).toHaveBeenCalledWith(
      expect.stringContaining('已不在澄清模式'),
      'info',
      expect.any(Number),
    );

    unsubscribe();
  });

  it('失败时回落到 error 提示且不广播', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({ error: '服务端炸了' }),
    }));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const listener = vi.fn();
    const unsubscribe = subscribeSessionDialogueModeSwitch(listener);

    const { result } = renderHook(() => useDialogueModeSwitch(makeOptions()));
    await act(async () => {
      await result.current.confirmSwitchToCoding();
    });

    expect(listener).not.toHaveBeenCalled();
    expect(toastMock).toHaveBeenCalledWith('服务端炸了', 'error', expect.any(Number));

    unsubscribe();
  });

  it('非澄清模式（enabled=false）不发请求', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const { result } = renderHook(() => useDialogueModeSwitch(makeOptions({ enabled: false })));
    await act(async () => {
      await result.current.confirmSwitchToCoding();
    });

    expect(fetchMock).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current.pending).toBe(false));
  });

  it('缺少 token / sessionId 时不发请求', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const { result } = renderHook(() =>
      useDialogueModeSwitch(makeOptions({ sessionId: null, token: null })),
    );
    await act(async () => {
      await result.current.confirmSwitchToCoding();
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
