import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as TaskJobModule from '../../task/task-job.js';
import type * as TaskJobDeliveryModule from '../../task/task-job-delivery.js';
import type * as TaskWakeBudgetModule from '../../task/task-wake-budget.js';

const mocks = vi.hoisted(() => ({
  continueSessionFromHistory: vi.fn(async () => ({ statusCode: 200 })),
  getAnyInFlightStreamRequestForSession: vi.fn(
    () => undefined as undefined | { clientRequestId: string },
  ),
}));

vi.mock('../../routes/stream-runtime.js', () => ({
  continueSessionFromHistory: mocks.continueSessionFromHistory,
}));

vi.mock('../../routes/stream-cancellation.js', () => ({
  getAnyInFlightStreamRequestForSession: mocks.getAnyInFlightStreamRequestForSession,
}));

process.env['DATABASE_URL'] = ':memory:';
process.env['JWT_SECRET'] = 'task-job-delivery-test-secret-1234567890';

let dbModule: typeof DbModule;
let taskJob: typeof TaskJobModule;
let delivery: typeof TaskJobDeliveryModule;
let wakeBudget: typeof TaskWakeBudgetModule;

const USER_ID = 'u-task-job-delivery';
const PARENT_SESSION_ID = 'sess-delivery-parent';
const CHILD_SESSION_ID = 'sess-delivery-child';

function seedSessions(): void {
  dbModule.sqliteRun(
    `INSERT OR REPLACE INTO sessions (id, user_id, messages_json, state_status, metadata_json, title)
     VALUES (?, ?, '[]', 'idle', '{}', ?)`,
    [PARENT_SESSION_ID, USER_ID, PARENT_SESSION_ID],
  );
  dbModule.sqliteRun(
    `INSERT OR REPLACE INTO sessions (id, user_id, messages_json, state_status, metadata_json, title)
     VALUES (?, ?, '[]', 'idle', ?, ?)`,
    [
      CHILD_SESSION_ID,
      USER_ID,
      JSON.stringify({ parentSessionId: PARENT_SESSION_ID, createdByTool: 'task' }),
      CHILD_SESSION_ID,
    ],
  );
}

function seedPersistedJob(notificationId: string): void {
  taskJob.start({
    id: CHILD_SESSION_ID,
    title: '审计会话唤醒原语',
    recovery: {
      kind: 'subagent',
      parentSessionId: PARENT_SESSION_ID,
      childSessionId: CHILD_SESSION_ID,
      agent: 'explore',
      description: '审计会话唤醒原语',
    },
    notificationId,
  });
  taskJob.background(CHILD_SESSION_ID);
}

function deliver(notificationId: string, resume?: boolean) {
  return delivery.deliverTaskCompletion({
    childSessionId: CHILD_SESSION_ID,
    description: '审计会话唤醒原语',
    notificationId,
    parentSessionId: PARENT_SESSION_ID,
    ...(resume !== undefined ? { resume } : {}),
    state: 'done',
    text: '子代理已完成 · 审计会话唤醒原语',
    agent: 'explore',
    userId: USER_ID,
  });
}

beforeAll(async () => {
  vi.resetModules();
  dbModule = await import('../../infra/db.js');
  taskJob = await import('../../task/task-job.js');
  delivery = await import('../../task/task-job-delivery.js');
  wakeBudget = await import('../../task/task-wake-budget.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  dbModule.sqliteRun('INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
    USER_ID,
    'task-job-delivery@example.test',
    'x',
  ]);
});

afterAll(async () => {
  await dbModule.closeDb();
});

beforeEach(() => {
  mocks.continueSessionFromHistory.mockClear();
  mocks.getAnyInFlightStreamRequestForSession.mockReset();
  mocks.getAnyInFlightStreamRequestForSession.mockReturnValue(undefined);
  taskJob.resetTaskJobsForTests();
  wakeBudget.resetWakeBudgetForTests();
  dbModule.sqliteRun('DELETE FROM task_jobs');
  dbModule.sqliteRun('DELETE FROM part_v2');
  dbModule.sqliteRun('DELETE FROM message_v2');
  dbModule.sqliteRun('DELETE FROM session_messages');
  dbModule.sqliteRun('DELETE FROM sessions');
  seedSessions();
});

describe('resolveTaskJobWakeDecision（纯函数）', () => {
  it('resume:false 只入库，不唤醒', () => {
    expect(
      delivery.resolveTaskJobWakeDecision({
        hasInFlightStream: false,
        parentStateStatus: 'idle',
        resume: false,
      }),
    ).toEqual({ action: 'defer', reason: 'resume-false' });
  });

  it('有在飞请求 → busy', () => {
    expect(
      delivery.resolveTaskJobWakeDecision({ hasInFlightStream: true, parentStateStatus: 'idle' }),
    ).toEqual({ action: 'defer', reason: 'busy' });
  });

  it('父会话 running / paused → parent-paused', () => {
    expect(
      delivery.resolveTaskJobWakeDecision({
        hasInFlightStream: false,
        parentStateStatus: 'running',
      }),
    ).toEqual({ action: 'defer', reason: 'parent-paused' });
    expect(
      delivery.resolveTaskJobWakeDecision({
        hasInFlightStream: false,
        parentStateStatus: 'paused',
      }),
    ).toEqual({ action: 'defer', reason: 'parent-paused' });
  });

  it('空闲 → 唤醒，且在飞判定优先于状态判定', () => {
    expect(
      delivery.resolveTaskJobWakeDecision({ hasInFlightStream: false, parentStateStatus: 'idle' }),
    ).toEqual({ action: 'wake' });
    expect(
      delivery.resolveTaskJobWakeDecision({
        hasInFlightStream: true,
        parentStateStatus: 'running',
      }),
    ).toEqual({ action: 'defer', reason: 'busy' });
  });
});

describe('deliverTaskCompletion', () => {
  it('空闲父会话：入库 + 唤醒，并清理持久化通知', async () => {
    seedPersistedJob('task-job:notif-wake');
    const result = await deliver('task-job:notif-wake');

    expect(result.wake).toBe('woken');
    expect(result.created).toBe(true);
    expect(mocks.continueSessionFromHistory).toHaveBeenCalledWith({
      clientRequestId: 'task-job:notif-wake',
      sessionId: PARENT_SESSION_ID,
      userId: USER_ID,
    });
    expect(taskJob.pendingBackground()).toHaveLength(0);
  });

  it('续接返回非 200 时报告延后并保留持久化通知', async () => {
    seedPersistedJob('task-job:notif-retry');
    mocks.continueSessionFromHistory.mockResolvedValueOnce({ statusCode: 503 });

    const result = await deliver('task-job:notif-retry');

    expect(result.wake).toBe('deferred');
    expect(taskJob.listPersistedBackgroundJobs()).toHaveLength(1);
  });

  it('resume:false：只入库不唤醒，视为已交付并清理记录', async () => {
    seedPersistedJob('task-job:notif-admit');
    const result = await deliver('task-job:notif-admit', false);

    expect(result.wake).toBe('skipped');
    expect(result.deferReason).toBe('resume-false');
    expect(mocks.continueSessionFromHistory).not.toHaveBeenCalled();
    expect(taskJob.pendingBackground()).toHaveLength(0);
  });

  it('resume:false 的通知已存在时仍清理待交付记录', async () => {
    seedPersistedJob('task-job:notif-cancel');
    await deliver('task-job:notif-cancel', false);
    seedPersistedJob('task-job:notif-cancel');
    const result = await deliver('task-job:notif-cancel', false);
    expect(result.created).toBe(false);
    expect(taskJob.pendingBackground()).toHaveLength(0);
    expect(mocks.continueSessionFromHistory).not.toHaveBeenCalled();
  });

  it('父会话繁忙：留库待消费，不注册重试、不清理记录（供恢复扫描补偿）', async () => {
    seedPersistedJob('task-job:notif-busy');
    mocks.getAnyInFlightStreamRequestForSession.mockReturnValue({ clientRequestId: 'in-flight' });

    const result = await deliver('task-job:notif-busy');

    expect(result.wake).toBe('deferred');
    expect(result.deferReason).toBe('busy');
    expect(mocks.continueSessionFromHistory).not.toHaveBeenCalled();
    expect(taskJob.pendingBackground()).toHaveLength(1);
  });

  it('父会话 paused：同样延后', async () => {
    seedPersistedJob('task-job:notif-paused');
    dbModule.sqliteRun('UPDATE sessions SET state_status = ? WHERE id = ?', [
      'paused',
      PARENT_SESSION_ID,
    ]);

    const result = await deliver('task-job:notif-paused');

    expect(result.wake).toBe('deferred');
    expect(result.deferReason).toBe('parent-paused');
  });

  it('父会话不存在：跳过并清理记录', async () => {
    seedPersistedJob('task-job:notif-missing');
    dbModule.sqliteRun('DELETE FROM sessions WHERE id = ?', [PARENT_SESSION_ID]);

    const result = await deliver('task-job:notif-missing');

    expect(result.wake).toBe('parent-missing');
    expect(mocks.continueSessionFromHistory).not.toHaveBeenCalled();
    expect(taskJob.pendingBackground()).toHaveLength(0);
  });

  it('同通知身份重复投递幂等：只写一条通知，且二次不重复唤醒', async () => {
    seedPersistedJob('task-job:notif-idem');
    const first = await deliver('task-job:notif-idem');
    const second = await deliver('task-job:notif-idem');

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);

    const notices = dbModule.sqliteAll<{ id: string }>(
      "SELECT id FROM message_v2 WHERE session_id = ? AND json_extract(data, '$.role') = 'synthetic'",
      [PARENT_SESSION_ID],
    );
    expect(notices).toHaveLength(1);
    // 第二次投递仍会尝试唤醒（唤醒幂等由 clientRequestId 重放保证），但绝不产生第二条通知。
    expect(mocks.continueSessionFromHistory).toHaveBeenCalledTimes(2);
  });

  it('唤醒预算耗尽时仍然投递通知，但不再唤醒（防无界自激）', async () => {
    seedPersistedJob('task-job:notif-budget');
    // 预先把预算用光（10 次）。
    for (let index = 0; index < 10; index += 1) {
      wakeBudget.tryConsumeWakeBudget({ sessionId: PARENT_SESSION_ID, userId: USER_ID });
    }

    const result = await deliver('task-job:notif-budget');

    expect(result.wake).toBe('skipped');
    expect(result.deferReason).toBe('budget-exhausted');
    expect(mocks.continueSessionFromHistory).not.toHaveBeenCalled();
    // 通知已投递（不丢信息）
    expect(result.created).toBe(true);
  });
});
