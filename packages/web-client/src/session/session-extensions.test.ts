import { afterEach, describe, expect, it, vi } from 'vitest';

// 与 `session-extensions.ts` 同源导入：仓库内 `sessions.ts` 与 `gateway/http.ts`
// 各自导出过一个 `HttpError`，实例判定必须用同一个类。
import { HttpError } from './sessions.js';
import { createSessionExtensionsClient } from './session-extensions.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe('createSessionExtensionsClient', () => {
  it('读取会话扩展状态并携带 bearer 令牌', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe('https://gateway.test/sessions/s-1/extensions');
      expect((init?.headers as Record<string, string>)['Authorization']).toBe('Bearer t-1');
      return jsonResponse({
        sessionId: 's-1',
        source: 'channel',
        managementEnabled: true,
        inheritance: 'explicit',
        configured: true,
        revision: 3,
        skills: [],
        mcpServers: [],
      });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const state = await createSessionExtensionsClient('https://gateway.test').getState(
      't-1',
      's-1',
    );
    expect(state.inheritance).toBe('explicit');
    expect(state.revision).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('提案技能时发送 kind=skill 与幂等键', async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body['kind']).toBe('skill');
      expect(body['skillId']).toBe('demo');
      expect(body['idempotencyKey']).toBe('k-1');
      expect(init?.method).toBe('POST');
      return jsonResponse({ ok: true, status: 'pending_approval', operationId: 'opx_1' }, 201);
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await createSessionExtensionsClient('https://gateway.test').proposeSkill(
      't-1',
      's-1',
      { skillId: 'demo', idempotencyKey: 'k-1' },
    );
    expect(result.operationId).toBe('opx_1');
    expect(result.status).toBe('pending_approval');
  });

  it('确认请求体携带从详情取得的 nonce', async () => {
    globalThis.fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({ decision: 'reject', nonce: 'detail-nonce' });
      return jsonResponse({ ok: true, decision: 'rejected' });
    }) as typeof fetch;
    await createSessionExtensionsClient('https://gateway.test').decide('t-1', 's-1', 'opx_1', {
      decision: 'reject',
      nonce: 'detail-nonce',
    });
  });

  it('确认失败时保留状态码与后端文案（403 非管理员）', async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({ error: '只有会话所有者或其授权的管理员可以确认该操作。' }, 403),
    ) as typeof fetch;

    const client = createSessionExtensionsClient('https://gateway.test');
    await expect(
      client.decide('t-1', 's-1', 'opx_1', { decision: 'approve', nonce: 'nonce-1' }),
    ).rejects.toThrow(/只有会话所有者/);

    globalThis.fetch = vi.fn(async () =>
      jsonResponse({ error: '只有会话所有者或其授权的管理员可以确认该操作。' }, 403),
    ) as typeof fetch;
    try {
      await client.decide('t-1', 's-1', 'opx_1', { decision: 'approve', nonce: 'nonce-1' });
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError).status).toBe(403);
    }
  });

  it('过期确认映射为 410 且给出可操作文案', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({}, 410)) as typeof fetch;
    const client = createSessionExtensionsClient('https://gateway.test');
    await expect(
      client.decide('t-1', 's-1', 'opx_1', { decision: 'approve', nonce: 'nonce-1' }),
    ).rejects.toThrow(/已过期/);
  });

  it('管理员清单的增删走 /settings/session-extension-admins', async () => {
    const urls: string[] = [];
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      urls.push(`${init?.method ?? 'GET'} ${String(url)}`);
      return jsonResponse({ ok: true, admins: ['u-2'] }, init?.method === 'POST' ? 201 : 200);
    }) as typeof fetch;

    const client = createSessionExtensionsClient('https://gateway.test');
    await client.addAdmin('t-1', 'u-2');
    await client.removeAdmin('t-1', 'u-2');

    expect(urls).toEqual([
      'POST https://gateway.test/settings/session-extension-admins',
      'DELETE https://gateway.test/settings/session-extension-admins/u-2',
    ]);
  });
});
