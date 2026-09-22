import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as TaskJobModule from '../../task/task-job.js';
import type * as TaskJobRecoveryModule from '../../task/task-job-recovery.js';

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
process.env['JWT_SECRET'] = 'task-job-recovery-test-secret-1234567890';

let dbModule: typeof DbModule;
let taskJob: typeof TaskJobModule;
let recovery: typeof TaskJobRecoveryModule;

const USER_ID = 'u-task-job-recovery';
const PARENT_SESSION_ID = 'sess-recovery-parent';
const CHILD_SESSION_ID = 'sess-recovery-child';
const NOTIFICATION_ID = 'task-job:sess-recovery-child:1730000000000';

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

/** 模拟「重启前已持久化、尚未投递」的一条通知。 */
function seedPersistedPendingJob(output = '子代理已完成的分析结论。'): void {
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
    notificationId: NOTIFICATION_ID,
  });
  taskJob.background(CHILD_SESSION_ID);
  taskJob.settle(CHILD_SESSION_ID, { status: 'completed', output });
  // 模拟进程重启：内存注册表清空，只剩持久化记录。
  taskJob.resetTaskJobsForTests();
}

beforeAll(async () => {
  vi.resetModules();
  dbModule = await import('../../infra/db.js');
  taskJob = await import('../../task/task-job.js');
  recovery = await import('../../task/task-job-recovery.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  dbModule.sqliteRun('INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
    USER_ID,
    'task-job-recovery@example.test',
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
  dbModule.sqliteRun('DELETE FROM task_jobs');
  dbModule.sqliteRun('DELETE FROM part_v2');
  dbModule.sqliteRun('DELETE FROM message_v2');
  dbModule.sqliteRun('DELETE FROM session_messages');
  dbModule.sqliteRun('DELETE FROM sessions');
  seedSessions();
});

describe('recoverPendingTaskDeliveries', () => {
  it('无待投递记录时返回全零摘要', async () => {
    const summary = await recovery.recoverPendingTaskDeliveries();

    expect(summary).toEqual({
      attempted: 0,
      deferred: 0,
      dropped: 0,
      failed: 0,
      skipped: 0,
      woken: 0,
    });
  });

  it('重启后把未投递通知补投给空闲父会话并唤醒', async () => {
    seedPersistedPendingJob();

    const summary = await recovery.recoverPendingTaskDeliveries();

    expect(summary.attempted).toBe(1);
    expect(summary.woken).toBe(1);
    expect(mocks.continueSessionFromHistory).toHaveBeenCalledWith({
      clientRequestId: NOTIFICATION_ID,
      sessionId: PARENT_SESSION_ID,
      userId: USER_ID,
    });
    // 已投递 → 持久化记录被清理
    expect(taskJob.pendingBackground()).toHaveLength(0);
  });

  it('父会话繁忙时保持延后并保留记录（下次启动再试）', async () => {
    seedPersistedPendingJob();
    mocks.getAnyInFlightStreamRequestForSession.mockReturnValue({ clientRequestId: 'in-flight' });

    const summary = await recovery.recoverPendingTaskDeliveries();

    expect(summary.deferred).toBe(1);
    expect(summary.woken).toBe(0);
    expect(taskJob.pendingBackground()).toHaveLength(1);
  });

  it('父会话已被删除时清理记录且不抛错', async () => {
    seedPersistedPendingJob();
    dbModule.sqliteRun('DELETE FROM sessions WHERE id = ?', [PARENT_SESSION_ID]);

    const summary = await recovery.recoverPendingTaskDeliveries();

    expect(summary.skipped).toBe(1);
    expect(mocks.continueSessionFromHistory).not.toHaveBeenCalled();
    expect(taskJob.pendingBackground()).toHaveLength(0);
  });

  it('记录损坏时跳过该条并清理，不阻断其余记录', async () => {
    dbModule.sqliteRun(
      `INSERT INTO task_jobs (id, notification_id, recovery_json, status)
       VALUES (?, ?, '{not-json', 'completed')`,
      [CHILD_SESSION_ID, NOTIFICATION_ID],
    );

    const summary = await recovery.recoverPendingTaskDeliveries();

    expect(summary.attempted).toBe(0);
    // `listPersistedBackgroundJobs` 已过滤掉不可解析的行；记录仍在，交由后续人工/清理处理。
    expect(summary.failed).toBe(0);
  });

  it('单条投递抛错时计入 failed 且不中断扫描', async () => {
    seedPersistedPendingJob();
    mocks.continueSessionFromHistory.mockRejectedValueOnce(new Error('upstream down'));

    const summary = await recovery.recoverPendingTaskDeliveries();

    expect(summary.attempted).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.woken).toBe(0);
  });
});
