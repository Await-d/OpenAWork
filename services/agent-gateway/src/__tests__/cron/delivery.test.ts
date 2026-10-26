/**
 * 定时任务结果投递回归（真实内存 SQLite + 真实通知/消息存储）。
 *
 * 覆盖两条通道与它们的幂等性、以及「目标会话被删不改变执行结论」的降级语义。
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as dbModule from '../../infra/db.js';
import type * as deliveryModule from '../../cron/delivery.js';
import type { CronJobRecord } from '../../cron/types.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

const USER_ID = 'u-cron-delivery';

function cronJob(overrides: Partial<CronJobRecord> = {}): CronJobRecord {
  return {
    id: 'cron-d1',
    user_id: USER_ID,
    name: '每日新闻',
    schedule_kind: 'every',
    schedule_at: null,
    schedule_every: 3_600_000,
    schedule_expr: null,
    schedule_tz: 'UTC',
    prompt: '总结新闻',
    agent_id: null,
    model: null,
    working_folder: null,
    session_id: null,
    delivery_mode: 'none',
    delivery_target: null,
    plugin_id: null,
    plugin_chat_id: null,
    enabled: true,
    delete_after_run: false,
    max_iterations: 10,
    last_fired_at: null,
    fire_count: 0,
    created_at: 0,
    updated_at: 0,
    ...overrides,
  };
}

describe('cron delivery', () => {
  let db: typeof dbModule;
  let delivery: typeof deliveryModule;

  beforeAll(async () => {
    db = await import('../../infra/db.js');
    await db.connectDb();
    await db.migrate();
    delivery = await import('../../cron/delivery.js');
  });

  beforeEach(() => {
    db.sqliteRun('DELETE FROM notifications');
    db.sqliteRun('DELETE FROM part_v2');
    db.sqliteRun('DELETE FROM message_v2');
    db.sqliteRun('DELETE FROM session_entry');
    db.sqliteRun('DELETE FROM event_log');
    db.sqliteRun('DELETE FROM event_sequences');
    db.sqliteRun('DELETE FROM sessions');
    db.sqliteRun('DELETE FROM users');
    db.sqliteRun("INSERT INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
      USER_ID,
      'cron@example.com',
    ]);
  });

  function insertSession(id: string, title = 'target'): void {
    db.sqliteRun(
      "INSERT INTO sessions (id, user_id, title, messages_json, state_status) VALUES (?, ?, ?, '[]', 'idle')",
      [id, USER_ID, title],
    );
  }

  it('session 模式：把结果投到目标会话，且可幂等重复投递', () => {
    insertSession('target-session');
    const job = cronJob({ delivery_mode: 'session', delivery_target: 'target-session' });
    const context = {
      executionSessionId: 'exec-session',
      executionStartedAt: 1_700_000_000_000,
      resultText: '今天有三条要闻。',
      succeeded: true,
    };

    delivery.deliverCronResult(job, context);
    delivery.deliverCronResult(job, context);

    const rows = db.sqliteAll<{ id: string; data: string }>(
      "SELECT id, data FROM message_v2 WHERE session_id = 'target-session'",
    );
    expect(rows).toHaveLength(1);
    const message = JSON.parse(rows[0]?.data ?? '{}') as {
      role?: string;
      description?: string;
      metadata?: Record<string, unknown>;
    };
    expect(message.role).toBe('synthetic');
    const metadata = message.metadata ?? {};
    expect(metadata['source']).toBe('cron');
    expect(metadata['state']).toBe('done');
    // 刻意不带 childID：客户端会把它接到「子代理检查器」，而 cron 执行会话并非
    // 子代理，带上只会打开一个空面板（见 delivery.ts 的说明）。
    expect(metadata['childID']).toBeUndefined();
    // 标题行渲染为 `<agent> <状态> · <description>`：agent 已是任务名，
    // description 再放任务名会显示成「每日新闻 已完成 · 每日新闻」。
    expect(metadata['agent']).toBe('每日新闻');
    expect(message.description).toBe('定时任务');
  });

  it('session 模式：未指定 delivery_target 时回落到 job.session_id', () => {
    insertSession('legacy-session');
    delivery.deliverCronResult(
      cronJob({ delivery_mode: 'session', session_id: 'legacy-session' }),
      {
        executionSessionId: 'exec-2',
        executionStartedAt: 2,
        resultText: '内容',
        succeeded: true,
      },
    );

    const count = db.sqliteGet<{ n: number }>(
      "SELECT COUNT(*) AS n FROM message_v2 WHERE session_id = 'legacy-session'",
    );
    expect(count?.n).toBe(1);
  });

  it('session 模式：目标会话已被删除时不抛错，但如实上报未送达', () => {
    // 关键语义：投递层**不**自己抛错（它无权改判执行结论），但必须把「没送到」
    // 告诉调用方，否则这条事实只会留在日志里，用户永远看不到。
    const outcome = delivery.deliverCronResult(
      cronJob({ delivery_mode: 'session', delivery_target: 'gone' }),
      {
        executionSessionId: 'exec-3',
        executionStartedAt: 3,
        resultText: '内容',
        succeeded: true,
      },
    );
    expect(outcome).toMatchObject({ attempted: true, delivered: false });
    expect(outcome.error).toMatch(/不存在/);
  });

  it('none 模式：attempted=false（用户明确只看执行历史，不算投递失败）', () => {
    expect(
      delivery.deliverCronResult(cronJob({ delivery_mode: 'none' }), {
        executionSessionId: 'exec-7',
        executionStartedAt: 7,
        resultText: 'x',
        succeeded: true,
      }),
    ).toMatchObject({ attempted: false, delivered: false });
  });

  it('目标不可达时能推一条通知，且同任务只保留一条未读（不刷屏）', () => {
    const job = cronJob({ delivery_mode: 'session', delivery_target: 'gone' });
    delivery.notifyCronJobUnavailable(job, '投递目标会话不存在');
    delivery.notifyCronJobUnavailable(job, '投递目标会话不存在（第二次触发）');

    const rows = db.sqliteAll<{ title: string; body: string }>(
      "SELECT title, body FROM notifications WHERE user_id = ? AND status = 'unread'",
      [USER_ID],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toContain('无法执行');
    // dedupeKey 命中时刷新为最新原因。
    expect(rows[0]?.body).toContain('第二次触发');
  });

  it('目标不可达的通知：用户读过之后再次失败仍会重新提醒', () => {
    const job = cronJob({ delivery_mode: 'session', delivery_target: 'gone' });
    delivery.notifyCronJobUnavailable(job, '第一次失败');
    // 用户读掉这条通知：后续失败不应因为固定 id 撞主键而被静默吞掉。
    db.sqliteRun("UPDATE notifications SET status = 'read' WHERE user_id = ?", [USER_ID]);
    delivery.notifyCronJobUnavailable(job, '第二次失败');

    const rows = db.sqliteAll<{ body: string; status: string }>(
      'SELECT body, status FROM notifications WHERE user_id = ? ORDER BY rowid ASC',
      [USER_ID],
    );
    expect(rows).toHaveLength(2);
    expect(rows[1]?.status).toBe('unread');
    expect(rows[1]?.body).toContain('第二次失败');
  });

  it('desktop 模式：写用户级通知（复用 /notification-events 链路）', () => {
    // `notifications.session_id` 有指向 sessions 的外键，执行会话必须先存在。
    insertSession('exec-4', 'cron:执行现场');
    delivery.deliverCronResult(cronJob({ delivery_mode: 'desktop' }), {
      executionSessionId: 'exec-4',
      executionStartedAt: 4,
      resultText: '结果正文',
      succeeded: true,
    });

    const row = db.sqliteGet<{ title: string; body: string; kind: string; session_id: string }>(
      'SELECT title, body, kind, session_id FROM notifications WHERE user_id = ?',
      [USER_ID],
    );
    expect(row?.title ?? '').toContain('每日新闻');
    expect(row?.body).toBe('结果正文');
    // informational 不打红点（红点只留给需要用户操作的待办）。
    expect(row?.kind).toBe('informational');
    expect(row?.session_id).toBe('exec-4');

    // 幂等：同一执行的重复投递是空操作。
    delivery.deliverCronResult(cronJob({ delivery_mode: 'desktop' }), {
      executionSessionId: 'exec-4',
      executionStartedAt: 4,
      resultText: '结果正文',
      succeeded: true,
    });
    const count = db.sqliteGet<{ n: number }>(
      'SELECT COUNT(*) AS n FROM notifications WHERE user_id = ?',
      [USER_ID],
    );
    expect(count?.n).toBe(1);
  });

  it('desktop 模式：执行会话已被回收时仍投递成功（只是不带跳转）', () => {
    // 执行会话会被 `createCronExecutionSession` 按任务回收，而
    // `notifications.session_id` 有 FK。带着已消失的 session 写通知会 INSERT 失败，
    // 并被投递层的 catch 吞掉 —— 通知静默丢失。这条锁定「不带 session 也要送达」。
    delivery.deliverCronResult(cronJob({ delivery_mode: 'desktop' }), {
      executionSessionId: 'recycled-session',
      executionStartedAt: 7,
      resultText: '内容',
      succeeded: true,
    });

    const row = db.sqliteGet<{ title: string; session_id: string | null }>(
      'SELECT title, session_id FROM notifications WHERE user_id = ?',
      [USER_ID],
    );
    expect(row?.title ?? '').toContain('每日新闻');
    expect(row?.session_id).toBeNull();
  });

  it('失败时同样投递（把「没跑成」也告诉用户），且状态为 failed', () => {
    insertSession('target-fail');
    delivery.deliverCronResult(
      cronJob({ delivery_mode: 'session', delivery_target: 'target-fail' }),
      {
        executionSessionId: 'exec-5',
        executionStartedAt: 5,
        resultText: '',
        succeeded: false,
        errorMessage: '会话已有其他请求运行中（SESSION_ALREADY_RUNNING）',
      },
    );

    const row = db.sqliteGet<{ data: string }>(
      "SELECT data FROM message_v2 WHERE session_id = 'target-fail'",
    );
    const message = JSON.parse(row?.data ?? '{}') as { metadata?: Record<string, unknown> };
    expect(message.metadata?.['state']).toBe('failed');

    const body = db.sqliteGet<{ data: string }>(
      "SELECT data FROM part_v2 WHERE session_id = 'target-fail'",
    );
    expect(body?.data ?? '').toContain('SESSION_ALREADY_RUNNING');
  });

  it('none 模式：不产生任何投递副作用', () => {
    delivery.deliverCronResult(cronJob({ delivery_mode: 'none' }), {
      executionSessionId: 'exec-6',
      executionStartedAt: 6,
      resultText: 'x',
      succeeded: true,
    });
    const count = db.sqliteGet<{ n: number }>('SELECT COUNT(*) AS n FROM notifications');
    expect(count?.n).toBe(0);
  });
  it('delivery_mode=none 也能在历史里读到产出（这是「内容取不到」的兜底出口）', async () => {
    insertSession('exec-preview', 'cron:每日新闻');
    const { appendSessionMessageV2 } = await import('../../message/message-v2-adapter.js');
    appendSessionMessageV2({
      sessionId: 'exec-preview',
      userId: USER_ID,
      role: 'assistant',
      messageId: 'msg-preview-1',
      status: 'final',
      content: [{ type: 'text', text: '今天有三条要闻：1) …' }],
    });

    const entries = delivery.attachExecutionPreviews({
      userId: USER_ID,
      executions: [
        {
          id: 'e1',
          job_id: 'cron-d1',
          started_at: 1,
          finished_at: 2,
          status: 'completed',
          session_id: 'exec-preview',
        },
      ],
    });

    expect(entries[0]?.outputPreview).toContain('今天有三条要闻');
  });

  it('没有 session_id 的旧记录不会报错，只是没有摘要', () => {
    const entries = delivery.attachExecutionPreviews({
      userId: USER_ID,
      executions: [
        { id: 'e2', job_id: 'cron-d1', started_at: 1, finished_at: 2, status: 'completed' },
      ],
    });
    expect(entries[0]?.outputPreview).toBeUndefined();
  });

  it('只对最近若干条生成摘要（避免 N+1 放大）', async () => {
    insertSession('exec-preview-2', 'cron:每日新闻');
    const { appendSessionMessageV2 } = await import('../../message/message-v2-adapter.js');
    appendSessionMessageV2({
      sessionId: 'exec-preview-2',
      userId: USER_ID,
      role: 'assistant',
      messageId: 'msg-preview-2',
      status: 'final',
      content: [{ type: 'text', text: '第二条产出' }],
    });

    const base = {
      job_id: 'cron-d1',
      started_at: 1,
      finished_at: 2,
      status: 'completed' as const,
      session_id: 'exec-preview-2',
    };
    const entries = delivery.attachExecutionPreviews({
      userId: USER_ID,
      executions: [
        { ...base, id: 'a' },
        { ...base, id: 'b' },
      ],
      previewLimit: 1,
    });
    expect(entries[0]?.outputPreview).toBe('第二条产出');
    expect(entries[1]?.outputPreview).toBeUndefined();
  });
});
