import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { DispatchDetail, DispatchList } from '@openAwork/shared';
import authPlugin from '../../infra/auth.js';
import { connectDb, migrate, sqliteRun } from '../../infra/db.js';
import { registerErrorHandler } from '../../infra/error-handler.js';
import requestWorkflowPlugin from '../../runtime/request-workflow.js';
import { registerDispatchRoutes } from '../../routes/dispatches.js';
import { DispatchScheduler } from '../../dispatch/dispatch-scheduler.js';
import {
  claimDispatchJob,
  finishDispatchJob,
  readDispatchHistory,
} from '../../dispatch/dispatch-queue.js';
import { getDispatch } from '../../dispatch/dispatch-store.js';

const root = '/dispatch-assistant';
const owner = 'u-dispatch-test';
const other = 'u-dispatch-other';
const items = [
  { title: '摘要', objective: '概括内容', acceptance: '给出三点', role: 'summarize' as const },
  { title: '要点', objective: '提取日期', acceptance: '保留来源措辞', role: 'extract' as const },
];
const selection = { providerId: 'p', modelId: 'm' };
const plan = vi.fn(async () => ({ selection, plan: { title: '会议纪要', items } }));
const validateModel = vi.fn(async () => undefined);
const pending = new Map<string, { complete: (text: string) => void; signal: AbortSignal }>();
let enabled = true;
const scheduler = new DispatchScheduler(
  (job, signal) =>
    new Promise<string>((resolve, reject) => {
      pending.set(job.id, { complete: resolve, signal });
      signal.addEventListener('abort', () => reject(new Error('派工已取消')), { once: true });
    }),
  () => enabled,
);
let app: FastifyInstance;

beforeAll(async () => {
  await connectDb();
  await migrate();
  app = Fastify();
  registerErrorHandler(app).setSpaIndexHtml('<main>派工页面</main>');
  await app.register(requestWorkflowPlugin);
  await app.register(authPlugin);
  await app.register(registerDispatchRoutes, {
    enabled: () => enabled,
    scheduler,
    plan,
    validateModel,
  });
  await app.ready();
});

beforeEach(() => {
  enabled = true;
  plan.mockClear();
  validateModel.mockClear();
  for (const id of [owner, other]) {
    sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
      id,
      `${id}@example.test`,
    ]);
  }
});

afterEach(async () => {
  await scheduler.stop();
  pending.clear();
  sqliteRun('DELETE FROM dispatches WHERE owner_user_id IN (?, ?)', [owner, other]);
});

afterAll(async () => app?.close());

function send(method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object, user = owner) {
  const token = app.jwt.sign({ sub: user, email: `${user}@example.test` });
  return app.inject({ method, url, payload, headers: { authorization: `Bearer ${token}` } });
}

async function draft() {
  const response = await send('POST', `${root}/drafts`, {
    request: '概括会议纪要',
    excerpt: '会议于周三召开。',
  });
  expect(response.statusCode).toBe(200);
  return response.json<DispatchDetail>();
}

it('隔离账户、校验输入，并让浏览器深链接回到 SPA', async () => {
  expect((await app.inject({ url: root })).statusCode).toBe(401);
  expect(
    (await app.inject({ url: '/dispatches/test', headers: { accept: 'text/html' } })).body,
  ).toContain('派工页面');
  expect(
    (await send('POST', `${root}/drafts`, { request: '摘要', excerpt: '文本', ownerUserId: other }))
      .statusCode,
  ).toBe(400);
  expect(plan).not.toHaveBeenCalled();
  const created = await draft();
  expect((await send('GET', `${root}/${created.id}`, undefined, other)).statusCode).toBe(404);
  expect(
    (await send('POST', `${root}/${created.id}/confirm`, { revision: 1 }, other)).statusCode,
  ).toBe(404);
  expect((await send('GET', root, undefined, other)).json<DispatchList>().entries).toEqual([]);
});

it('只确认当前版本，并发执行两个事项，重放确认和追问不会重复入队', async () => {
  scheduler.start();
  const created = await draft();
  const url = `${root}/${created.id}`;
  expect(created).toMatchObject({ status: 'draft', items: [] });
  expect(pending.size).toBe(0);
  expect(
    (await send('PATCH', `${url}/draft`, { revision: 1, title: '更新后的纪要', items })).statusCode,
  ).toBe(200);
  expect((await send('POST', `${url}/confirm`, { revision: 1 })).statusCode).toBe(409);
  const response = await send('POST', `${url}/confirm`, { revision: 2 });
  expect(response.statusCode).toBe(200);
  const [first, second] = response.json<DispatchDetail>().items;
  const initial = first?.attempts[0];
  const secondInitial = second?.attempts[0];
  if (!first || !initial || !secondInitial) throw new Error('缺少待执行事项');
  expect(pending.size).toBe(2);
  expect(
    (await send('POST', `${url}/confirm`, { revision: 2 }))
      .json<DispatchDetail>()
      .items.map(({ id }) => id),
  ).toEqual([first.id, second.id]);
  expect(validateModel).toHaveBeenCalledTimes(1);
  pending.get(initial.id)?.complete('摘要完成');
  pending.get(secondInitial.id)?.complete('提取完成');
  await vi.waitFor(() => expect(getDispatch(owner, created.id).status).toBe('succeeded'));

  await scheduler.stop();
  const followUpUrl = `${url}/items/${first.id}/follow-up`;
  const input = { expectedAttemptId: initial.id, question: '再缩短一句' };
  expect((await send('POST', followUpUrl, input)).statusCode).toBe(200);
  const replay = await send('POST', followUpUrl, input);
  expect(replay.json<DispatchDetail>().items.map(({ attempts }) => attempts.length)).toEqual([
    2, 1,
  ]);
  expect((await send('POST', followUpUrl, { ...input, question: '不同内容' })).statusCode).toBe(
    409,
  );
  const job = claimDispatchJob();
  if (!job) throw new Error('缺少追问任务');
  expect(job.threadId).toBe(initial.threadId);
  expect(readDispatchHistory(job)).toEqual([{ question: null, result: '摘要完成' }]);
  finishDispatchJob(job, { result: '一句摘要' });
});

it('启动恢复标记未知在途为中断，停用期间保留队列，恢复后可取消运行', async () => {
  const created = await draft();
  const url = `${root}/${created.id}`;
  const result = await send('POST', `${url}/confirm`, { revision: 1 });
  expect(result.statusCode).toBe(200);
  const interrupted = claimDispatchJob();
  if (!interrupted) throw new Error('缺少在途任务');
  enabled = false;
  scheduler.start();
  expect((await send('GET', root)).json<DispatchList>().enabled).toBe(false);
  expect(
    (await send('POST', `${root}/drafts`, { request: '摘要', excerpt: '文本' })).statusCode,
  ).toBe(503);
  const attempts = (await send('GET', url))
    .json<DispatchDetail>()
    .items.map(({ attempts: history }) => history[0]);
  expect(attempts.find((attempt) => attempt?.id === interrupted.id)).toMatchObject({
    status: 'interrupted',
    error: 'gateway-stopped',
  });
  expect(attempts.some((attempt) => attempt?.status === 'queued')).toBe(true);
  expect(pending.size).toBe(0);

  enabled = true;
  scheduler.wake();
  const active = getDispatch(owner, created.id).items.find(
    ({ attempts: history }) => history[0]?.status === 'running',
  );
  const current = active?.attempts[0];
  if (!active || !current) throw new Error('缺少恢复认领的事项');
  const stop = () =>
    send('POST', `${url}/items/${active.id}/cancel`, { expectedAttemptId: current.id });
  expect((await stop()).statusCode).toBe(200);
  expect(pending.get(current.id)?.signal.aborted).toBe(true);
  await vi.waitFor(() =>
    expect(
      getDispatch(owner, created.id).items.find(({ id }) => id === active.id)?.attempts[0]?.status,
    ).toBe('cancelled'),
  );
  expect((await stop()).statusCode).toBe(200);
});

it('数据库恢复后补写原结果，停用期间也不会重跑模型', async () => {
  scheduler.start();
  const { id } = await draft();
  const url = `${root}/${id}`;
  const { items: confirmed } = (
    await send('POST', `${url}/confirm`, { revision: 1 })
  ).json<DispatchDetail>();
  const initial = confirmed[0]?.attempts[0];
  if (!initial) throw new Error('缺少待执行事项');
  const flight = pending.get(initial.id);
  sqliteRun(`CREATE TEMP TRIGGER block_dispatch_settlement BEFORE UPDATE OF result ON dispatch_attempts
    BEGIN SELECT RAISE(ABORT, 'temporary test error'); END`);
  try {
    enabled = false;
    flight?.complete('需要补写的结果');
    const detail = (await send('GET', url)).json<DispatchDetail>();
    expect(detail.items[0]?.attempts[0]?.status).toBe('running');
  } finally {
    sqliteRun('DROP TRIGGER block_dispatch_settlement');
  }
  scheduler.wake();
  const detail = (await send('GET', url)).json<DispatchDetail>();
  expect(detail.items[0]?.attempts[0]).toMatchObject({
    status: 'succeeded',
    result: '需要补写的结果',
  });
  expect(pending.get(initial.id)).toBe(flight);
});

it('重试追问保留原问题和同事项历史，并可在停用后重放', async () => {
  const { id } = await draft();
  const url = `${root}/${id}`;
  await send('POST', `${url}/confirm`, { revision: 1 });
  const historyByItem = new Map<string, string>();
  for (const result of ['甲的初次结果', '乙的初次结果']) {
    const job = claimDispatchJob();
    if (!job) throw new Error('缺少待执行事项');
    finishDispatchJob(job, { result });
    historyByItem.set(job.itemId, result);
  }
  const first = (await send('GET', url)).json<DispatchDetail>().items[0];
  const initial = first?.attempts[0];
  if (!first || !initial) throw new Error('缺少初次结果');
  const itemUrl = `${url}/items/${first.id}`;
  const question = { expectedAttemptId: initial.id, question: '原追问' };
  expect((await send('POST', `${itemUrl}/follow-up`, question)).statusCode).toBe(200);
  const failed = claimDispatchJob();
  if (!failed) throw new Error('缺少追问任务');
  finishDispatchJob(failed, { error: 'generation-failed' });
  const retry = { expectedAttemptId: failed.id };
  expect((await send('POST', `${itemUrl}/retry`, retry)).statusCode).toBe(200);
  const retried = claimDispatchJob();
  if (!retried) throw new Error('缺少重试任务');
  expect(retried).toMatchObject({ question: '原追问', threadId: initial.threadId });
  expect(readDispatchHistory(retried)).toEqual([
    { question: null, result: historyByItem.get(first.id) },
  ]);
  finishDispatchJob(retried, { result: '追问重试结果' });

  enabled = false;
  expect(
    (await send('POST', `${itemUrl}/retry`, retry)).json<DispatchDetail>().items[0]?.attempts,
  ).toHaveLength(3);
  expect((await send('POST', `${itemUrl}/follow-up`, question)).statusCode).toBe(200);
  expect(
    (await send('POST', `${itemUrl}/follow-up`, { ...question, expectedAttemptId: retried.id }))
      .statusCode,
  ).toBe(503);
  expect((await send('POST', `${itemUrl}/retry`, retry, other)).statusCode).toBe(404);
});

it('后台更新较早记录时，继续翻页仍能找到它', async () => {
  const oldest = await draft();
  const clock = vi.spyOn(Date, 'now');
  const epoch = Date.now();
  try {
    for (let i = 1; i <= 20; i++) {
      clock.mockReturnValue(epoch + i);
      await draft();
    }
    const first = (await send('GET', root)).json<DispatchList>();
    expect(first.entries).toHaveLength(20);
    expect(first.entries.some(({ id }) => id === oldest.id)).toBe(false);
    if (!first.nextCursor) throw new Error('缺少分页游标');
    clock.mockReturnValue(epoch + 21);
    await send('POST', `${root}/${oldest.id}/confirm`, { revision: 1 });
    const next = (
      await send('GET', `${root}?${new URLSearchParams({ cursor: first.nextCursor })}`)
    ).json<DispatchList>();
    expect(next.entries.map(({ id }) => id)).toEqual([oldest.id]);
  } finally {
    clock.mockRestore();
  }
});
