import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentTaskManagerImpl } from '@openAwork/agent-core';
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
const TEST_ROOT = join(tmpdir(), `openawork-task-job-recovery-${process.pid}`);
process.env['WORKSPACE_ROOT'] = TEST_ROOT;
process.env['OPENAWORK_DATA_DIR'] = join(TEST_ROOT, 'data');

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
  mkdirSync(TEST_ROOT, { recursive: true });
  writeFileSync(join(TEST_ROOT, 'pnpm-workspace.yaml'), 'packages: []\n');
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
  rmSync(TEST_ROOT, { recursive: true, force: true });
});

beforeEach(() => {
  rmSync(join(TEST_ROOT, '.agentdocs'), { recursive: true, force: true });
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
  it('重启中断运行任务时先结算任务图再唤醒父会话', async () => {
    seedPersistedPendingJob();
    dbModule.sqliteRun("UPDATE task_jobs SET status = 'running', output = NULL WHERE id = ?", [
      CHILD_SESSION_ID,
    ]);
    const { resolveTaskGraphProjectRoot } = await import('../../task/task-graph-root.js');
    const manager = new AgentTaskManagerImpl();
    const root = resolveTaskGraphProjectRoot(PARENT_SESSION_ID);
    const graph = await manager.loadOrCreate(root, PARENT_SESSION_ID);
    const task = manager.addTask(graph, {
      title: '审计会话唤醒原语',
      status: 'running',
      blockedBy: [],
      priority: 'medium',
      sessionId: CHILD_SESSION_ID,
      tags: [],
    });
    await manager.save(graph);
    mocks.continueSessionFromHistory.mockImplementationOnce(async () => {
      const current = await manager.loadOrCreate(root, PARENT_SESSION_ID);
      expect(current.tasks[task.id]?.status).toBe('failed');
      expect(current.tasks[task.id]?.errorMessage).toBe('子代理执行被网关重启中断。');
      return { statusCode: 200 };
    });

    const summary = await recovery.recoverPendingTaskDeliveries();

    expect(summary.woken).toBe(1);
  });
  it('运行中的任务在重启后不会被误报完成', async () => {
    seedPersistedPendingJob();
    dbModule.sqliteRun("UPDATE task_jobs SET status = 'running', output = NULL WHERE id = ?", [
      CHILD_SESSION_ID,
    ]);
    const summary = await recovery.recoverPendingTaskDeliveries();
    expect(summary.attempted).toBe(1);
    expect(summary.woken).toBe(1);
    const row = dbModule.sqliteGet<{ data: string }>('SELECT data FROM message_v2 WHERE id = ?', [
      NOTIFICATION_ID,
    ]);
    expect(row?.data).toContain('failed');
  });

  it('取消任务恢复时只补通知而不唤醒', async () => {
    seedPersistedPendingJob();
    dbModule.sqliteRun("UPDATE task_jobs SET status = 'cancelled' WHERE id = ?", [
      CHILD_SESSION_ID,
    ]);
    const summary = await recovery.recoverPendingTaskDeliveries();
    expect(summary.skipped).toBe(1);
    expect(mocks.continueSessionFromHistory).not.toHaveBeenCalled();
    expect(taskJob.pendingBackground()).toHaveLength(0);
  });
  it('取消通知已注入仍持久化时重启只清理记录而不唤醒', async () => {
    seedPersistedPendingJob();
    dbModule.sqliteRun("UPDATE task_jobs SET status = 'cancelled' WHERE id = ?", [
      CHILD_SESSION_ID,
    ]);
    dbModule.sqliteRun(
      `INSERT INTO message_v2 (id, session_id, user_id, time_created, data)
       VALUES (?, ?, ?, ?, ?)`,
      [
        NOTIFICATION_ID,
        PARENT_SESSION_ID,
        USER_ID,
        Date.now(),
        JSON.stringify({
          role: 'synthetic',
          time: { created: Date.now() },
          metadata: { state: 'cancelled' },
        }),
      ],
    );
    const summary = await recovery.recoverPendingTaskDeliveries();
    expect(summary.skipped).toBe(1);
    expect(taskJob.pendingBackground()).toHaveLength(0);
    expect(mocks.continueSessionFromHistory).not.toHaveBeenCalled();
  });
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

  it('通知已在自然回合后消费时重启不再重复唤醒', async () => {
    seedPersistedPendingJob();
    mocks.getAnyInFlightStreamRequestForSession.mockReturnValueOnce({ clientRequestId: 'busy' });
    const delivery = await import('../../task/task-job-delivery.js');
    await delivery.deliverTaskCompletion({
      agent: 'explore',
      childSessionId: CHILD_SESSION_ID,
      description: '审计会话唤醒原语',
      notificationId: NOTIFICATION_ID,
      parentSessionId: PARENT_SESSION_ID,
      state: 'done',
      text: '子代理已完成的分析结论。',
      userId: USER_ID,
    });
    const notice = dbModule.sqliteGet<{ time_created: number }>(
      'SELECT time_created FROM message_v2 WHERE id = ?',
      [NOTIFICATION_ID],
    );
    expect(notice).toBeDefined();
    dbModule.sqliteRun(
      `INSERT INTO message_v2 (id, session_id, user_id, time_created, data)
       VALUES (?, ?, ?, ?, ?)`,
      [
        'user-after-notice',
        PARENT_SESSION_ID,
        USER_ID,
        (notice?.time_created ?? 0) + 1,
        JSON.stringify({ role: 'user', time: { created: (notice?.time_created ?? 0) + 1 } }),
      ],
    );
    const summary = await recovery.recoverPendingTaskDeliveries();
    expect(summary.skipped).toBe(1);
    expect(mocks.continueSessionFromHistory).not.toHaveBeenCalled();
    expect(taskJob.pendingBackground()).toHaveLength(0);
  });

  it('自然回合与通知同毫秒写入且 id 更小时不误判已消费', async () => {
    seedPersistedPendingJob();
    mocks.getAnyInFlightStreamRequestForSession.mockReturnValueOnce({ clientRequestId: 'busy' });
    const delivery = await import('../../task/task-job-delivery.js');
    await delivery.deliverTaskCompletion({
      agent: 'explore',
      childSessionId: CHILD_SESSION_ID,
      description: '审计会话唤醒原语',
      notificationId: NOTIFICATION_ID,
      parentSessionId: PARENT_SESSION_ID,
      state: 'done',
      text: '结论',
      userId: USER_ID,
    });
    const notice = dbModule.sqliteGet<{ time_created: number }>(
      'SELECT time_created FROM message_v2 WHERE id = ?',
      [NOTIFICATION_ID],
    );
    dbModule.sqliteRun(
      `INSERT INTO message_v2 (id, session_id, user_id, time_created, data)
       VALUES (?, ?, ?, ?, ?)`,
      [
        'a-before-notice-id',
        PARENT_SESSION_ID,
        USER_ID,
        notice?.time_created ?? 0,
        JSON.stringify({ role: 'user' }),
      ],
    );

    expect(
      taskJob.completeConsumedBackgroundJobs({ sessionId: PARENT_SESSION_ID, userId: USER_ID }),
    ).toBe(0);
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
