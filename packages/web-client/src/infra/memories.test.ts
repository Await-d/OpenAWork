import { afterEach, describe, expect, it, vi } from 'vitest';

import { HttpError } from '../gateway/http.js';
import { createMemoriesClient } from './memories.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('createMemoriesClient', () => {
  it('list 成功时返回记忆列表载荷', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        json: async () => ({ items: [{ id: 'memory-1' }] }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createMemoriesClient('http://localhost:3000');
    const result = (await client.list('token-1')) as { items?: Array<{ id: string }> };

    expect(result.items?.[0]?.id).toBe('memory-1');
  });

  it('create 失败时会保留后端 error 文案', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 409,
        json: async () => ({ error: 'memory already exists' }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createMemoriesClient('http://localhost:3000');

    await expect(client.create('token-1', { body: 'memory' })).rejects.toThrow(
      'memory already exists',
    );
  });

  it('remove 网络异常时会转换成中文网络错误', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('Failed to fetch');
    }) as typeof fetch;

    const client = createMemoriesClient('http://localhost:3000');

    await expect(client.remove('token-1', 'memory-1')).rejects.toThrow('网络异常，删除记忆失败。');
  });

  it('getSettings 404 时会保留 HttpError 状态码', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 404,
        json: async () => ({ error: 'memory settings not found' }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createMemoriesClient('http://localhost:3000');

    try {
      await client.getSettings('token-1');
      throw new Error('expected getSettings to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError).status).toBe(404);
      expect((error as Error).message).toContain('memory settings not found');
    }
  });

  it('create 会读取 ApiErrorResponse.data.message', async () => {
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

    const client = createMemoriesClient('http://localhost:3000');

    await expect(client.create('token-1', { body: 'memory' })).rejects.toThrow('请求体参数无效。');
  });
});

describe('createMemoriesClient 规则', () => {
  it('listRules 携带鉴权和作用域查询并解包 rules', async () => {
    const rules = [{ id: 'rule-1', name: '代码规范', body: '使用类型导入' }];
    const fetchMock = vi.fn(async () => Response.json({ rules }));
    globalThis.fetch = fetchMock;
    const result = await createMemoriesClient('http://localhost:3000').listRules('token-1', {
      scopeType: 'workspace',
      scopeId: '/work/demo',
    });
    expect(result).toEqual(rules);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/memories/rules?scopeType=workspace&scopeId=%2Fwork%2Fdemo',
      expect.objectContaining({ headers: { Authorization: 'Bearer token-1' } }),
    );
  });

  it('proposeRule POST 正文及期望版本，只返回待确认结果', async () => {
    const input = {
      scope: { type: 'user' as const, id: 'user-1' },
      name: '代码规范',
      body: '使用类型导入',
      expectedRevision: 3,
    };
    const pending = {
      status: 'pending_confirmation',
      proposalId: 'proposal-1',
      message: '等待确认',
      scope: input.scope,
    };
    const fetchMock = vi.fn(async () => Response.json(pending, { status: 202 }));
    globalThis.fetch = fetchMock;
    expect(
      await createMemoriesClient('http://localhost:3000').proposeRule('token-1', input),
    ).toEqual(pending);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/memories/rules',
      expect.objectContaining({
        method: 'POST',
        headers: { Authorization: 'Bearer token-1', 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
    );
  });

  it('disableRule 与 deleteRule 编码 ID、携带鉴权并返回操作结果', async () => {
    const fetchMock = vi.fn(async () => Response.json({ ok: true, enabled: false }));
    globalThis.fetch = fetchMock;
    const client = createMemoriesClient('http://localhost:3000');
    expect(await client.disableRule('token-1', 'rule/a')).toEqual({ ok: true, enabled: false });
    expect(await client.deleteRule('token-1', 'rule/a')).toMatchObject({ ok: true });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://localhost:3000/memories/rules/rule%2Fa/disable',
      expect.objectContaining({ method: 'POST', headers: { Authorization: 'Bearer token-1' } }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://localhost:3000/memories/rules/rule%2Fa',
      expect.objectContaining({ method: 'DELETE', headers: { Authorization: 'Bearer token-1' } }),
    );
  });

  it.each(['listRules', 'proposeRule', 'disableRule', 'deleteRule'] as const)(
    '%s 失败保留后端错误及 HTTP 状态',
    async (method) => {
      globalThis.fetch = vi.fn(async () =>
        Response.json({ error: '无权管理规则' }, { status: 403 }),
      );
      const client = createMemoriesClient('http://localhost:3000');
      const request =
        method === 'proposeRule'
          ? client.proposeRule('token-1', {
              scope: { type: 'user', id: 'user-1' },
              name: '规则',
              body: '正文',
            })
          : method === 'listRules'
            ? client.listRules('token-1')
            : client[method]('token-1', 'rule-1');
      await expect(request).rejects.toMatchObject({ status: 403, message: '无权管理规则' });
    },
  );
});

function captureFetch(): { calls: Array<[string, RequestInit | undefined]> } {
  const calls: Array<[string, RequestInit | undefined]> = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push([String(input), init]);
    return {
      ok: true,
      status: 200,
      json: async () => ({}),
    } as unknown as Response;
  }) as typeof fetch;
  return { calls };
}

describe('createMemoriesClient 提议与历史', () => {
  it('listProposals 会拼接 status/limit/offset 查询串并解包 proposals', async () => {
    const { calls } = captureFetch();

    const client = createMemoriesClient('http://localhost:3000');
    const result = await client.listProposals('token-1', {
      status: 'pending',
      limit: 50,
      offset: 10,
    });

    expect(calls[0]?.[0]).toBe(
      'http://localhost:3000/memories/proposals?status=pending&limit=50&offset=10',
    );
    expect(calls[0]?.[1]?.method ?? 'GET').toBe('GET');
    expect(Array.isArray(result)).toBe(true);
  });

  it('getProposal 命中单条路径并解包 proposal/relations', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          proposal: { id: 'p-1', action: 'create' },
          relations: [{ kind: 'duplicate', memoryId: 'm-1', key: 'k', value: 'v' }],
        }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createMemoriesClient('http://localhost:3000');
    const result = await client.getProposal('token-1', 'p-1');

    expect(result.proposal.id).toBe('p-1');
    expect(result.relations[0]?.kind).toBe('duplicate');
  });

  it('decideProposal 用 POST 提交 decision body 到 decision 子路径', async () => {
    const { calls } = captureFetch();

    const client = createMemoriesClient('http://localhost:3000');
    await client.decideProposal('token-1', 'p-1', { decision: 'reject', keepOriginal: true });

    expect(calls[0]?.[0]).toBe('http://localhost:3000/memories/proposals/p-1/decision');
    expect(calls[0]?.[1]?.method).toBe('POST');
    expect(JSON.parse(String(calls[0]?.[1]?.body))).toEqual({
      decision: 'reject',
      keepOriginal: true,
    });
  });

  it('countPendingProposals 读取 pending/count 并解包 count', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        status: 200,
        json: async () => ({ count: 7 }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createMemoriesClient('http://localhost:3000');
    await expect(client.countPendingProposals('token-1')).resolves.toBe(7);
  });

  it('listRevisions 拼接 memoryId/limit 查询串', async () => {
    const { calls } = captureFetch();

    const client = createMemoriesClient('http://localhost:3000');
    await client.listRevisions('token-1', { memoryId: 'memory-1', limit: 20 });

    expect(calls[0]?.[0]).toBe(
      'http://localhost:3000/memories/revisions?memoryId=memory-1&limit=20',
    );
  });

  it('rollbackRevision 用 POST 命中 rollback 子路径', async () => {
    const { calls } = captureFetch();

    const client = createMemoriesClient('http://localhost:3000');
    await client.rollbackRevision('token-1', 'revision-9');

    expect(calls[0]?.[0]).toBe('http://localhost:3000/memories/revisions/revision-9/rollback');
    expect(calls[0]?.[1]?.method).toBe('POST');
  });

  it('remove 支持 expectedRevision 查询参数', async () => {
    const { calls } = captureFetch();

    const client = createMemoriesClient('http://localhost:3000');
    await client.remove('token-1', 'memory-1', { expectedRevision: 3 });

    expect(calls[0]?.[0]).toBe('http://localhost:3000/memories/memory-1?expectedRevision=3');
    expect(calls[0]?.[1]?.method).toBe('DELETE');
  });

  it('decideProposal 409 冲突会保留状态码与 code', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 409,
        json: async () => ({ code: 'memory_proposal_conflict' }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createMemoriesClient('http://localhost:3000');

    try {
      await client.decideProposal('token-1', 'p-1', { decision: 'approve' });
      throw new Error('expected decideProposal to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError).status).toBe(409);
      expect((error as HttpError).data).toEqual({ code: 'memory_proposal_conflict' });
      expect((error as Error).message).toContain('重新查看');
    }
  });

  it('decideProposal 410 过期会保留状态码与 code', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 410,
        json: async () => ({ code: 'memory_proposal_expired' }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createMemoriesClient('http://localhost:3000');

    try {
      await client.decideProposal('token-1', 'p-1', { decision: 'approve' });
      throw new Error('expected decideProposal to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError).status).toBe(410);
      expect((error as Error).message).toContain('已过期');
    }
  });

  it('decideProposal 403 无权会保留状态码与 code', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 403,
        json: async () => ({ code: 'memory_proposal_forbidden' }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createMemoriesClient('http://localhost:3000');

    try {
      await client.decideProposal('token-1', 'p-1', { decision: 'approve' });
      throw new Error('expected decideProposal to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError).status).toBe(403);
      expect((error as Error).message).toContain('无权');
    }
  });

  it('countPendingProposals 网络异常会归一化成中文网络错误', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('Failed to fetch');
    }) as typeof fetch;

    const client = createMemoriesClient('http://localhost:3000');

    await expect(client.countPendingProposals('token-1')).rejects.toThrow(
      '网络异常，读取待确认数量失败。',
    );
  });
});
