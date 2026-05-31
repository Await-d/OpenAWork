import { afterEach, describe, expect, it, vi } from 'vitest';

import { createNotificationsClient } from './notifications.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('createNotificationsClient', () => {
  it('list 成功时返回 notifications 列表', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        json: async () => ({
          notifications: [
            {
              id: 'notice-1',
              title: '需要审批',
              body: 'bash 权限请求',
              eventType: 'permission_asked',
              sessionId: 'session-1',
              createdAt: '2026-05-26T00:00:00.000Z',
              readAt: null,
              status: 'unread',
            },
          ],
        }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createNotificationsClient('http://localhost:3000');
    const result = await client.list('token-1', { status: 'unread' });

    expect(result[0]?.id).toBe('notice-1');
  });

  it('listPreferences 失败时会保留后端 error 文案', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 503,
        json: async () => ({ error: 'preferences unavailable' }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createNotificationsClient('http://localhost:3000');

    await expect(client.listPreferences('token-1')).rejects.toThrow('preferences unavailable');
  });

  it('markRead 网络异常时会转换成中文网络错误', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('Failed to fetch');
    }) as typeof fetch;

    const client = createNotificationsClient('http://localhost:3000');

    await expect(client.markRead('token-1', 'notice-1')).rejects.toThrow(
      '网络异常，标记通知为已读失败。',
    );
  });

  it('markAllRead 在 403 时会给出权限文案', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 403,
        json: async () => ({}),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createNotificationsClient('http://localhost:3000');

    await expect(client.markAllRead('token-1')).rejects.toThrow(
      '认证失效或当前账号无权标记全部通知为已读。',
    );
  });

  it('updatePreferences 在 404 时会给出明确文案', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 404,
        json: async () => ({}),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createNotificationsClient('http://localhost:3000');

    await expect(
      client.updatePreferences('token-1', {
        channel: 'web',
        preferences: [],
      }),
    ).rejects.toThrow('目标通知资源不存在，无法保存通知偏好。');
  });

  it('list 会读取 ApiErrorResponse.data.message', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 400,
        json: async () => ({
          name: 'BadRequest',
          data: { message: '查询参数无效。', kind: 'Query' },
        }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createNotificationsClient('http://localhost:3000');

    await expect(client.list('token-1')).rejects.toThrow('查询参数无效。');
  });
});
