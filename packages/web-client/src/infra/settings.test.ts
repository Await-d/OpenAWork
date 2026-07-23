import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSettingsClient } from './settings.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('createSettingsClient profile methods', () => {
  it('getProfile 成功时返回昵称资料', async () => {
    const fetchMock = vi.fn(async () => {
      return {
        ok: true,
        json: async () => ({
          email: 'user@example.com',
          nickname: '林雾',
          displayName: '林雾',
          updatedAt: '2026-07-16T00:00:00.000Z',
        }),
      } as unknown as Response;
    }) as typeof fetch;
    globalThis.fetch = fetchMock;

    const client = createSettingsClient('http://localhost:3000');
    const result = await client.getProfile('token-1');

    expect(result).toMatchObject({
      email: 'user@example.com',
      nickname: '林雾',
      displayName: '林雾',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/settings/profile',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer token-1' }),
      }),
    );
  });

  it('putProfile 通过 settings profile endpoint 保存昵称', async () => {
    const fetchMock = vi.fn(async () => {
      return {
        ok: true,
        json: async () => ({
          email: 'user@example.com',
          nickname: null,
          displayName: 'user@example.com',
        }),
      } as unknown as Response;
    }) as typeof fetch;
    globalThis.fetch = fetchMock;

    const client = createSettingsClient('http://localhost:3000');
    const result = await client.putProfile('token-1', { nickname: null });

    expect(result).toMatchObject({
      email: 'user@example.com',
      nickname: null,
      displayName: 'user@example.com',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/settings/profile',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ nickname: null }),
      }),
    );
  });
});

describe('createSettingsClient.getProvidersResult', () => {
  it('成功时返回 providers 载荷', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        json: async () => ({ providers: [{ id: 'openai' }] }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createSettingsClient('http://localhost:3000');
    const result = await client.getProvidersResult('token-1', { enabledOnly: true });

    expect(result).toMatchObject({
      ok: true,
      retryable: false,
      providers: { providers: [{ id: 'openai' }] },
    });
  });

  it('HTTP 错误时返回结构化失败信息', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 503,
        json: async () => ({ error: 'providers unavailable' }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createSettingsClient('http://localhost:3000');
    const result = await client.getProvidersResult('token-1');

    expect(result).toMatchObject({
      ok: false,
      retryable: true,
      errorMessage: 'providers unavailable',
      status: 503,
    });
  });

  it('getProvidersResult 会读取 ApiErrorResponse.data.message', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 400,
        json: async () => ({
          name: 'BadRequest',
          data: { message: '请求体参数无效。', kind: 'Body' },
        }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createSettingsClient('http://localhost:3000');
    const result = await client.getProvidersResult('token-1');

    expect(result).toMatchObject({
      ok: false,
      retryable: false,
      errorMessage: '请求体参数无效。',
      status: 400,
    });
  });
});

describe('createSettingsClient mutation error handling', () => {
  it('listMcpServers 通过 settings MCP endpoint 读取同源配置', async () => {
    const fetchMock = vi.fn(async () => {
      return {
        ok: true,
        json: async () => ({
          servers: [],
          builtinServers: [{ id: 'omo', builtinKind: 'adapter', source: 'system' }],
        }),
      } as unknown as Response;
    }) as typeof fetch;
    globalThis.fetch = fetchMock;

    const client = createSettingsClient('http://localhost:3000');
    const result = await client.listMcpServers('token-1');

    expect(result).toMatchObject({
      builtinServers: [{ id: 'omo', builtinKind: 'adapter', source: 'system' }],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/settings/mcp-servers',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer token-1' }),
      }),
    );
  });

  it('putMcpServers writes the normalized settings payload through the web client', async () => {
    const fetchMock = vi.fn(async () => {
      return { ok: true, status: 200 } as unknown as Response;
    }) as typeof fetch;
    globalThis.fetch = fetchMock;

    const client = createSettingsClient('http://localhost:3000');
    await client.putMcpServers('token-1', {
      servers: [
        {
          id: 'omo',
          name: 'omo',
          transport: 'stdio',
          builtin: true,
          builtinKind: 'adapter',
          source: 'system',
          enabled: false,
          disabledTools: ['omo_list_agents'],
        },
      ],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/settings/mcp-servers',
      expect.objectContaining({
        body: JSON.stringify({
          servers: [
            {
              id: 'omo',
              name: 'omo',
              transport: 'stdio',
              builtin: true,
              builtinKind: 'adapter',
              source: 'system',
              enabled: false,
              disabledTools: ['omo_list_agents'],
            },
          ],
        }),
        method: 'PUT',
      }),
    );
  });

  it('putProviders 会保留后端 error 文案', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 409,
        json: async () => ({ error: 'provider config conflict' }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createSettingsClient('http://localhost:3000');

    await expect(
      client.putProviders('token-1', {
        providers: [],
      }),
    ).rejects.toThrow('provider config conflict');
  });

  it('discoverProviders 请求正确路径并返回 JSON', async () => {
    globalThis.fetch = vi.fn(async (input) => {
      expect(String(input)).toContain('/settings/providers/discover');
      return {
        ok: true,
        status: 200,
        json: async () => ({ providers: [{ id: 'together', name: 'Together' }] }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createSettingsClient('http://localhost:3000');
    const data = (await client.discoverProviders('token-1')) as {
      providers: Array<{ id: string }>;
    };
    expect(data.providers[0]?.id).toBe('together');
  });

  it('importProviderFromModelsDev 以 POST 发送 modelsDevProviderId', async () => {
    globalThis.fetch = vi.fn(async (input, init) => {
      expect(String(input)).toContain('/settings/providers/import-from-models-dev');
      expect(init?.method).toBe('POST');
      const body = JSON.parse(String(init?.body)) as { modelsDevProviderId: string };
      expect(body.modelsDevProviderId).toBe('together');
      return {
        ok: true,
        status: 200,
        json: async () => ({ provider: { id: 'custom-md-together-1', type: 'custom' } }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createSettingsClient('http://localhost:3000');
    const data = (await client.importProviderFromModelsDev('token-1', {
      modelsDevProviderId: 'together',
    })) as { provider: { type: string } };
    expect(data.provider.type).toBe('custom');
  });

  it('retryMcpServer 网络异常时会转换成中文网络错误', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('Failed to fetch');
    }) as typeof fetch;

    const client = createSettingsClient('http://localhost:3000');

    await expect(client.retryMcpServer('token-1', 'mcp-1')).rejects.toThrow(
      '网络异常，重试 MCP 服务连接失败。',
    );
  });

  it('putWebsearch 在 403 时会给出权限文案', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 403,
        json: async () => ({}),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createSettingsClient('http://localhost:3000');

    await expect(
      client.putWebsearch('token-1', {
        providers: [],
        rolloutMode: 'sequential',
      }),
    ).rejects.toThrow('认证失效或当前账号无权保存 Websearch 策略。');
  });

  it('clearDiagnostics 在网络异常时会转换成中文网络错误', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('Failed to fetch');
    }) as typeof fetch;

    const client = createSettingsClient('http://localhost:3000');

    await expect(client.clearDiagnostics('token-1')).rejects.toThrow(
      '网络异常，清空诊断信息失败。',
    );
  });
});

describe('createSettingsClient telemetry methods', () => {
  it('getTelemetryConsent 成功时返回同意状态', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        json: async () => ({ status: 'accepted', updatedAt: '2026-07-04T00:00:00Z' }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createSettingsClient('http://localhost:3000');
    const result = await client.getTelemetryConsent('token-1');

    expect(result).toMatchObject({ status: 'accepted', updatedAt: '2026-07-04T00:00:00Z' });
  });

  it('updateTelemetryConsent 发送 PUT 请求并返回结果', async () => {
    const fetchMock = vi.fn(async () => {
      return {
        ok: true,
        json: async () => ({ ok: true, status: 'accepted' }),
      } as unknown as Response;
    }) as typeof fetch;
    globalThis.fetch = fetchMock;

    const client = createSettingsClient('http://localhost:3000');
    const result = await client.updateTelemetryConsent('token-1', 'accepted');

    expect(result).toMatchObject({ ok: true, status: 'accepted' });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/settings/telemetry/consent',
      expect.objectContaining({ method: 'PUT' }),
    );
  });

  it('updateTelemetryConsent 失败时抛出错误', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 403,
        json: async () => ({ error: 'forbidden' }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createSettingsClient('http://localhost:3000');

    await expect(client.updateTelemetryConsent('token-1', 'declined')).rejects.toThrow();
  });

  it('reportTelemetryEvent 发送 POST 请求并返回结果', async () => {
    const fetchMock = vi.fn(async () => {
      return {
        ok: true,
        json: async () => ({ ok: true }),
      } as unknown as Response;
    }) as typeof fetch;
    globalThis.fetch = fetchMock;

    const client = createSettingsClient('http://localhost:3000');
    const result = await client.reportTelemetryEvent('token-1', 'app_start', {
      platform: 'win32',
    });

    expect(result).toMatchObject({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/settings/telemetry/event',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('reportTelemetryEvent 网络异常时抛出中文错误', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('Failed to fetch');
    }) as typeof fetch;

    const client = createSettingsClient('http://localhost:3000');

    await expect(client.reportTelemetryEvent('token-1', 'app_start')).rejects.toThrow(
      '网络异常，上报遥测事件失败。',
    );
  });
});
