import { afterEach, describe, expect, it, vi } from 'vitest';

import { createCronClient } from './cron.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe('createCronClient', () => {
  it('list 成功时返回 jobs 列表', async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse(200, {
        jobs: [{ id: 'job-1', name: '每日同步', expression: '* * * * *', status: 'enabled' }],
      }),
    ) as typeof fetch;

    const client = createCronClient('http://localhost:3000');
    const result = await client.list('token-1');

    expect(result[0]?.id).toBe('job-1');
  });

  it('setEnabled 失败时会保留后端 error 文案', async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse(409, { error: 'job cannot be disabled' }),
    ) as typeof fetch;

    const client = createCronClient('http://localhost:3000');

    await expect(client.setEnabled('token-1', 'job-1', false)).rejects.toThrow(
      'job cannot be disabled',
    );
  });

  it('remove 网络异常时会转换成中文网络错误', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('Failed to fetch');
    }) as typeof fetch;

    const client = createCronClient('http://localhost:3000');

    await expect(client.remove('token-1', 'job-1')).rejects.toThrow('网络异常，删除定时任务失败。');
  });

  it('setEnabled 会读取 ApiErrorResponse.data.message', async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse(400, {
        name: 'BadRequest',
        data: { message: '请求体参数无效。', kind: 'Body' },
      }),
    ) as typeof fetch;

    const client = createCronClient('http://localhost:3000');

    await expect(client.setEnabled('token-1', 'job-1', false)).rejects.toThrow('请求体参数无效。');
  });

  it('create 提交 body 并返回 job', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      jsonResponse(201, { job: { id: 'job-9', name: 'x' } }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = createCronClient('http://localhost:3000');
    const created = await client.create('token-1', {
      name: 'x',
      schedule_kind: 'cron',
      schedule_expr: '0 9 * * *',
      prompt: 'p',
    });

    expect(created.id).toBe('job-9');
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(request?.method).toBe('POST');
    expect(JSON.parse(String(request?.body))).toMatchObject({ schedule_expr: '0 9 * * *' });
  });

  it('create 的 400 会把 zod issues 原因透出给用户', async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse(400, {
        code: 'invalid_cron_job',
        error: '定时任务配置无效。',
        issues: [{ message: 'schedule_expr 必须是合法的 5 段 cron 表达式（分 时 日 月 周）。' }],
      }),
    ) as typeof fetch;

    const client = createCronClient('http://localhost:3000');

    await expect(
      client.create('token-1', { name: 'x', schedule_kind: 'cron', prompt: 'p' }),
    ).rejects.toThrow(/5 段 cron 表达式/);
  });

  it('runNow 命中的是 /run 端点', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      jsonResponse(202, { ok: true }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = createCronClient('http://localhost:3000');
    await client.runNow('token-1', 'job-1');

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('http://localhost:3000/cron/jobs/job-1/run');
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.method).toBe('POST');
  });

  it('history 返回执行记录', async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse(200, { history: [{ id: 'e1', job_id: 'job-1', status: 'failed' }] }),
    ) as typeof fetch;

    const client = createCronClient('http://localhost:3000');
    const history = await client.history('token-1', 'job-1');

    expect(history[0]?.status).toBe('failed');
  });

  it('history 的 includePreview=false 会带上 preview=0（否则摘要关不掉）', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      jsonResponse(200, { history: [] }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = createCronClient('http://localhost:3000');
    await client.history('token-1', 'job-1', { limit: 1, includePreview: false });

    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain('limit=1');
    expect(url).toContain('preview=0');
  });

  it('update 用 PATCH 提交局部字段并返回 job', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      jsonResponse(200, {
        job: { id: 'job-1', name: 'n', schedule_kind: 'every', delivery_mode: 'desktop' },
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = createCronClient('http://localhost:3000');
    const job = await client.update('token-1', 'job-1', { delivery_mode: 'desktop' });

    expect((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.method).toBe('PATCH');
    expect(String((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.body)).toContain(
      'delivery_mode',
    );
    expect(job?.id).toBe('job-1');
  });
});
