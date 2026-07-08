import { afterEach, describe, expect, it, vi } from 'vitest';
import { runOAuthCodeExchange, OAUTH_CODE_EXCHANGE_TIMEOUT_MS } from './oauth.js';
import { MCPTimeoutError } from './error-handler.js';
import type { MCPAuthProviderLike } from './adapter.js';

/**
 * Regression (§0.140, OAuth code-exchange wall-clock timeout):
 * runOAuthCodeExchange drives the MCP SDK `auth()`, which POSTs to the
 * upstream token endpoint with no built-in timeout. A token endpoint that
 * accepts the connection but never responds used to leave the promise pending
 * forever — wedging the gateway's `/mcp/oauth/callback` handler and the user's
 * browser tab indefinitely. The exchange is now raced against a 30s deadline
 * that rejects with MCPTimeoutError (mapped to a 500 by the callback route).
 */

// The SDK auth() is dynamically imported inside runOAuthCodeExchange; this mock
// lets each test control whether it resolves, hangs, or rejects.
const authMock = vi.fn();
vi.mock('@modelcontextprotocol/sdk/client/auth.js', () => ({
  auth: (...args: unknown[]) => authMock(...args),
}));

const fakeProvider = {} as unknown as MCPAuthProviderLike;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  authMock.mockReset();
});

describe('runOAuthCodeExchange', () => {
  it('正常完成时透传 AUTHORIZED', async () => {
    authMock.mockResolvedValueOnce('AUTHORIZED');
    await expect(
      runOAuthCodeExchange(fakeProvider, 'https://srv.example/mcp', 'code-1'),
    ).resolves.toBe('AUTHORIZED');
  });

  it('SDK 返回 REDIRECT 时原样透传', async () => {
    authMock.mockResolvedValueOnce('REDIRECT');
    await expect(
      runOAuthCodeExchange(fakeProvider, 'https://srv.example/mcp', 'code-1'),
    ).resolves.toBe('REDIRECT');
  });

  it('token 端点挂起超过阈值时抛 MCPTimeoutError（不永久 pending）', async () => {
    vi.useFakeTimers();
    // auth() never settles — simulates a token endpoint that accepts the
    // connection but never responds.
    authMock.mockImplementationOnce(() => new Promise<never>(() => undefined));

    const promise = runOAuthCodeExchange(fakeProvider, 'https://srv.example/mcp', 'code-1');
    const settled = expect(promise).rejects.toBeInstanceOf(MCPTimeoutError);

    await vi.waitFor(() => expect(authMock).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(OAUTH_CODE_EXCHANGE_TIMEOUT_MS);
    await settled;
  });

  it('SDK 以非超时错误失败时原样抛出', async () => {
    authMock.mockRejectedValueOnce(new Error('invalid_grant'));
    await expect(
      runOAuthCodeExchange(fakeProvider, 'https://srv.example/mcp', 'code-1'),
    ).rejects.toThrow('invalid_grant');
  });
});
