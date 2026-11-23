import { afterEach, expect, it, vi } from 'vitest';
import { createDispatchesClient } from './dispatches.js';

afterEach(() => vi.unstubAllGlobals());

it('uses authenticated, encoded routes and sends only the fields of each mutation', async () => {
  const calls: unknown[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer token');
    calls.push([
      url,
      init.method ?? 'GET',
      typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    ]);
    return Response.json({ revision: 3 });
  });
  const client = createDispatchesClient('https://gateway.example/');
  const root = 'https://gateway.example/dispatch-assistant';
  const detail = `${root}/a%2Fb`;
  const item = `${detail}/items/i%2Fj`;
  const draft = { request: '总结', excerpt: '文本' };
  const edit = { revision: 2, title: '标题', items: [] };
  await client.list('token', 'x+=');
  await client.detail('token', 'a/b');
  await client.createDraft('token', draft);
  await client.editDraft('token', 'a/b', edit);
  await expect(client.confirm('token', 'a/b', 3)).resolves.toEqual({ revision: 3 });
  for (const kind of ['cancel', 'retry'] as const) {
    await client.act('token', 'a/b', 'i/j', { kind, expectedAttemptId: 'attempt' });
  }
  await client.act('token', 'a/b', 'i/j', {
    kind: 'follow-up',
    expectedAttemptId: 'attempt',
    question: '为什么？',
  });
  expect(calls).toEqual([
    [`${root}?cursor=x%2B%3D`, 'GET', undefined],
    [detail, 'GET', undefined],
    [`${root}/drafts`, 'POST', draft],
    [`${detail}/draft`, 'PATCH', edit],
    [`${detail}/confirm`, 'POST', { revision: 3 }],
    [`${item}/cancel`, 'POST', { expectedAttemptId: 'attempt' }],
    [`${item}/retry`, 'POST', { expectedAttemptId: 'attempt' }],
    [`${item}/follow-up`, 'POST', { expectedAttemptId: 'attempt', question: '为什么？' }],
  ]);
});
