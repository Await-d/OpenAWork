import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as TaskJobModule from '../../task/task-job.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['JWT_SECRET'] = 'task-job-test-secret-1234567890';

let dbModule: typeof DbModule;
let taskJob: typeof TaskJobModule;

const USER_ID = 'u-task-job';
const PARENT_SESSION_ID = 'sess-task-job-parent';

function seedSession(sessionId: string): void {
  dbModule.sqliteRun(
    `INSERT OR IGNORE INTO sessions (id, user_id, messages_json, state_status, metadata_json, title)
     VALUES (?, ?, '[]', 'idle', '{}', ?)`,
    [sessionId, USER_ID, sessionId],
  );
}

function makeRecovery(childSessionId: string): TaskJobModule.TaskJobRecovery {
  return {
    kind: 'subagent',
    parentSessionId: PARENT_SESSION_ID,
    childSessionId,
    agent: 'explore',
    description: '审计会话唤醒原语',
  };
}

beforeAll(async () => {
  vi.resetModules();
  dbModule = await import('../../infra/db.js');
  taskJob = await import('../../task/task-job.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  dbModule.sqliteRun('INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
    USER_ID,
    'task-job@example.test',
    'x',
  ]);
  seedSession(PARENT_SESSION_ID);
});

afterAll(async () => {
  await dbModule.closeDb();
});

beforeEach(() => {
  taskJob.resetTaskJobsForTests();
  dbModule.sqliteRun('DELETE FROM task_jobs');
});

describe('task-job 注册表', () => {
  it('start 创建 running 任务并携带恢复载体与通知身份', () => {
    seedSession('child-a');
    const info = taskJob.start({
      id: 'child-a',
      title: '任务 A',
      notificationId: 'notif-a',
      recovery: makeRecovery('child-a'),
    });

    expect(info.status).toBe('running');
    expect(info.type).toBe('subagent');
    expect(info.title).toBe('任务 A');
    expect(info.notificationId).toBe('notif-a');
    expect(info.recovery?.childSessionId).toBe('child-a');
    expect(taskJob.get('child-a')?.status).toBe('running');
  });

  it('对运行中的同名任务 start 是幂等的（复用既有 startedAt）', () => {
    seedSession('child-b');
    const first = taskJob.start({ id: 'child-b', title: '任务 B' });
    const second = taskJob.start({ id: 'child-b', title: '任务 B 改名' });

    expect(second.startedAt).toBe(first.startedAt);
    expect(second.title).toBe('任务 B');
  });

  it('settle 写入终态，且重复 settle 不覆盖既有结果', () => {
    seedSession('child-c');
    taskJob.start({ id: 'child-c' });

    const settled = taskJob.settle('child-c', { status: 'completed', output: '首次结果' });
    expect(settled?.status).toBe('completed');
    expect(settled?.output).toBe('首次结果');
    expect(settled?.completedAt).toBeTypeOf('number');

    const again = taskJob.settle('child-c', { status: 'error', error: '不应覆盖' });
    expect(again?.status).toBe('completed');
    expect(again?.output).toBe('首次结果');
    expect(again?.error).toBeUndefined();
  });

  it('settle 未知 id 返回 undefined', () => {
    expect(taskJob.settle('missing', { status: 'completed' })).toBeUndefined();
  });

  it('cancel 只对运行中任务生效，终态时幂等', () => {
    seedSession('child-d');
    taskJob.start({ id: 'child-d' });

    const cancelled = taskJob.cancel('child-d');
    expect(cancelled?.status).toBe('cancelled');

    const again = taskJob.cancel('child-d');
    expect(again?.status).toBe('cancelled');
  });

  it('background 分配通知身份并持久化，pendingBackground 可读回', () => {
    seedSession('child-e');
    taskJob.start({ id: 'child-e', recovery: makeRecovery('child-e') });

    const backgrounded = taskJob.background('child-e');
    expect(backgrounded?.notificationId).toBeTypeOf('string');

    const pending = taskJob.pendingBackground();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.childSessionId).toBe('child-e');
    expect(pending[0]?.agent).toBe('explore');

    // 重复 background 不重新分配通知身份
    const again = taskJob.background('child-e');
    expect(again?.notificationId).toBe(backgrounded?.notificationId);
    expect(taskJob.pendingBackground()).toHaveLength(1);
  });

  it('后台结算使用交付通知身份持久化，重启后仍可恢复', () => {
    seedSession('child-recover');
    taskJob.start({ id: 'child-recover', recovery: makeRecovery('child-recover') });
    const notificationId = 'task-job:child-recover:123';
    taskJob.settle('child-recover', { status: 'completed', output: '分析结论', notificationId });
    taskJob.resetTaskJobsForTests();

    expect(taskJob.listPersistedBackgroundJobs()).toMatchObject([
      { notificationId, status: 'completed', output: '分析结论' },
    ]);
  });

  it('后台任务运行期间已有持久记录，终态通知身份与结果更新同一条记录', () => {
    seedSession('child-running');
    taskJob.start({ id: 'child-running', recovery: makeRecovery('child-running') });
    const running = taskJob.background('child-running');
    expect(taskJob.listPersistedBackgroundJobs()).toMatchObject([
      { notificationId: running?.notificationId, status: 'running' },
    ]);
    taskJob.settle('child-running', {
      status: 'completed',
      notificationId: 'task-job:child-running:123',
      output: '结束',
    });
    expect(taskJob.listPersistedBackgroundJobs()).toMatchObject([
      { notificationId: 'task-job:child-running:123', status: 'completed', output: '结束' },
    ]);
  });

  it('无可恢复载体且已终态的任务不能转后台', () => {
    seedSession('child-f');
    taskJob.start({ id: 'child-f' });
    taskJob.settle('child-f', { status: 'completed', output: 'done' });

    expect(taskJob.background('child-f')).toBeUndefined();
  });

  it('completeBackground 清理持久化记录与内存条目', () => {
    seedSession('child-g');
    taskJob.start({ id: 'child-g', recovery: makeRecovery('child-g') });
    const notificationId = taskJob.background('child-g')?.notificationId;
    expect(notificationId).toBeTypeOf('string');
    taskJob.settle('child-g', { status: 'completed', output: 'ok' });

    taskJob.completeBackground(notificationId!);

    expect(taskJob.get('child-g')).toBeUndefined();
    expect(taskJob.pendingBackground()).toHaveLength(0);
  });

  it('settle 后可转后台并持久化终态结果（对齐上游「先完成再转后台」）', () => {
    seedSession('child-h');
    taskJob.start({ id: 'child-h', recovery: makeRecovery('child-h') });
    taskJob.settle('child-h', { status: 'completed', output: '完成文本' });

    const backgrounded = taskJob.background('child-h');
    expect(backgrounded?.notificationId).toBeTypeOf('string');

    const row = dbModule.sqliteGet<{ status: string; output: string }>(
      'SELECT status, output FROM task_jobs WHERE id = ?',
      ['child-h'],
    );
    expect(row?.status).toBe('completed');
    expect(row?.output).toBe('完成文本');
  });

  it('消费历史超过 25 条时淘汰最旧的已消费条目', () => {
    for (let index = 0; index < 30; index += 1) {
      const id = `child-consume-${index}`;
      seedSession(id);
      taskJob.start({ id });
      taskJob.settle(id, { status: 'completed', output: `r${index}` });
      taskJob.consume(id);
    }

    expect(taskJob.listActive()).toHaveLength(25);
    // 最旧的 5 条被淘汰，最新的仍在
    expect(taskJob.get('child-consume-0')).toBeUndefined();
    expect(taskJob.get('child-consume-29')?.status).toBe('completed');
  });

  it('waitForSettle 在任务结算时解析，已终态时立即返回', async () => {
    seedSession('child-i');
    taskJob.start({ id: 'child-i' });

    const pending = taskJob.waitForSettle('child-i');
    taskJob.settle('child-i', { status: 'completed', output: 'done' });
    await expect(pending).resolves.toMatchObject({ status: 'completed', output: 'done' });

    taskJob.start({ id: 'child-i-2' });
    taskJob.settle('child-i-2', { status: 'error', error: 'boom' });
    await expect(taskJob.waitForSettle('child-i-2')).resolves.toMatchObject({ status: 'error' });

    await expect(taskJob.waitForSettle('missing')).resolves.toBeUndefined();
  });

  it('会话删除时按 FK CASCADE 清理 task_jobs 行', () => {
    seedSession('child-j');
    taskJob.start({ id: 'child-j', recovery: makeRecovery('child-j') });
    taskJob.background('child-j');
    expect(taskJob.pendingBackground()).toHaveLength(1);

    dbModule.sqliteRun('DELETE FROM sessions WHERE id = ?', ['child-j']);

    expect(taskJob.pendingBackground()).toHaveLength(0);
  });

  it('pendingBackground 跳过损坏的 recovery_json 记录', () => {
    seedSession('child-k');
    dbModule.sqliteRun(
      `INSERT INTO task_jobs (id, notification_id, recovery_json, status)
       VALUES (?, ?, ?, 'completed')`,
      ['child-k', 'notif-broken', '{not-json'],
    );

    expect(taskJob.pendingBackground()).toHaveLength(0);
  });
});
