// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useCommandRegistry } from './useCommandRegistry.js';

const authState = vi.hoisted(() => ({
  accessToken: 'token-a',
  gatewayUrl: 'https://gw-a.test',
}));

const GATEWAY_URL = authState.gatewayUrl;
const NEXT_GATEWAY_URL = 'https://gw-b.test';

vi.mock('../../stores/auth/auth.js', () => ({
  useAuthStore: (
    selector: (state: { accessToken: string; gatewayUrl: string }) => unknown,
  ): unknown => selector(authState),
}));

const loggerMocks = vi.hoisted(() => ({
  error: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('../../utils/log/logger.js', () => ({
  logger: loggerMocks,
}));

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function flushAsyncWork(rounds = 6): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

afterEach(() => {
  cleanup();
  authState.gatewayUrl = GATEWAY_URL;
  loggerMocks.error.mockReset();
  loggerMocks.warn.mockReset();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('useCommandRegistry', () => {
  it('网关暂时不可用时会自动重试并恢复 composer 命令', async () => {
    vi.useFakeTimers();
    let callCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        callCount += 1;
        if (callCount === 1) {
          return jsonResponse({ error: 'commands unavailable' }, 503);
        }
        return jsonResponse({
          commands: [
            {
              id: 'palette-only',
              label: '设置',
              contexts: ['palette'],
            },
            {
              id: 'composer-command',
              label: '/compact',
              description: '压缩当前会话上下文',
              contexts: ['composer'],
              execution: 'server',
            },
          ],
        });
      }) as typeof fetch,
    );

    const { result } = renderHook(() => useCommandRegistry('composer'));

    await flushAsyncWork();
    expect(result.current).toEqual([]);
    expect(callCount).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    await flushAsyncWork();

    expect(result.current.map((command) => command.id)).toEqual(['composer-command']);
    expect(loggerMocks.warn).toHaveBeenCalledWith(
      'failed to load command registry, will retry',
      expect.objectContaining({
        attempt: 1,
        delayMs: 2_000,
        gatewayUrl: GATEWAY_URL,
        surface: 'composer',
        status: 503,
      }),
    );
  });

  it('切换 Gateway 时不会保留旧 Gateway 的命令，切换后失败仍会自动恢复', async () => {
    vi.useFakeTimers();
    let nextGatewayCallCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.startsWith(NEXT_GATEWAY_URL)) {
          nextGatewayCallCount += 1;
          if (nextGatewayCallCount === 1) {
            return jsonResponse({ error: 'new gateway unavailable' }, 503);
          }
          return jsonResponse({
            commands: [
              {
                id: 'new-gateway-command',
                label: '/new-command',
                contexts: ['composer'],
                execution: 'server',
              },
            ],
          });
        }

        return jsonResponse({
          commands: [
            {
              id: 'old-gateway-command',
              label: '/old-command',
              contexts: ['composer'],
              execution: 'server',
            },
          ],
        });
      }) as typeof fetch,
    );

    const { result, rerender } = renderHook(() => useCommandRegistry('composer'));
    await flushAsyncWork();
    expect(result.current.map((command) => command.id)).toEqual(['old-gateway-command']);

    authState.gatewayUrl = NEXT_GATEWAY_URL;
    rerender();
    await flushAsyncWork();
    expect(result.current).toEqual([]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    await flushAsyncWork();

    expect(result.current.map((command) => command.id)).toEqual(['new-gateway-command']);
    expect(nextGatewayCallCount).toBe(2);
  });
});
