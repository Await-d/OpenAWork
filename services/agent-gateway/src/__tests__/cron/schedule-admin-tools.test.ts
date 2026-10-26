/**
 * `schedule_manage` 工具回归（真实内存 SQLite + 真实调度器/持久化链路）。
 */
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as AdminModule from '../../cron/schedule-admin-tools.js';
import type * as RouterModule from '../../cron/router.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let dbModule: typeof DbModule;
let admin: typeof AdminModule;
let cronScheduler: typeof RouterModule.cronScheduler;

const USER_ID = 'u-schedule-manage';
const OTHER_USER_ID = 'u-schedule-other';
const SESSION_ID = 's-schedule-manage';
const TEAM_SESSION_ID = 's-schedule-team';
const CRON_SESSION_ID = 's-schedule-cron';
const CHANNEL_SESSION_ID = 's-schedule-channel';
const OTHER_CHANNEL_SESSION_ID = 's-schedule-channel-b';
const BROKEN_CHANNEL_SESSION_ID = 's-schedule-channel-broken';
const WORKSPACE_DIR = `${tmpdir()}/openawork-cron-manage-ws`;
const OUTSIDE_DIR = `${tmpdir()}/openawork-cron-manage-outside`;

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  admin = await import('../../cron/schedule-admin-tools.js');
  cronScheduler = (await import('../../cron/router.js')).cronScheduler;
});

beforeEach(() => {
  cronScheduler.stopAll();
  for (const job of cronScheduler.listJobs()) {
    cronScheduler.removeJob(job.id);
  }
  dbModule.sqliteRun('DELETE FROM cron_job_executions', []);
  dbModule.sqliteRun('DELETE FROM cron_jobs', []);
  dbModule.sqliteRun('DELETE FROM sessions', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  for (const userId of [USER_ID, OTHER_USER_ID]) {
    dbModule.sqliteRun(
      "INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')",
      [userId, `${userId}@example.com`],
    );
  }
  dbModule.sqliteRun(
    `INSERT INTO sessions (id, user_id, title, metadata_json, state_status)
     VALUES (?, ?, 'demo', ?, 'idle')`,
    [SESSION_ID, USER_ID, JSON.stringify({ workingDirectory: WORKSPACE_DIR })],
  );
  dbModule.sqliteRun(
    `INSERT INTO sessions (id, user_id, title, metadata_json, state_status, role_layer, team_parent_session_id, handoff_state)
     VALUES (?, ?, 'team', '{}', 'idle', 'executor', 'parent-1', 'running')`,
    [TEAM_SESSION_ID, USER_ID],
  );
  dbModule.sqliteRun(
    `INSERT INTO sessions (id, user_id, title, metadata_json, state_status)
     VALUES (?, ?, 'cron', '{"source":"cron"}', 'idle')`,
    [CRON_SESSION_ID, USER_ID],
  );
  // 渠道会话：带完整作用域元数据（`channel.id` + `channelChatId`）。
  dbModule.sqliteRun(
    `INSERT INTO sessions (id, user_id, title, metadata_json, state_status)
     VALUES (?, ?, 'channel', ?, 'idle')`,
    [
      CHANNEL_SESSION_ID,
      USER_ID,
      JSON.stringify({
        source: 'channel',
        channelChatId: 'chat-a',
        channel: { id: 'plugin-a', type: 'qq' },
      }),
    ],
  );
  // 同渠道不同会话：用来验证作用域隔离（看不到/删不掉别人的任务）。
  dbModule.sqliteRun(
    `INSERT INTO sessions (id, user_id, title, metadata_json, state_status)
     VALUES (?, ?, 'channel-b', ?, 'idle')`,
    [
      OTHER_CHANNEL_SESSION_ID,
      USER_ID,
      JSON.stringify({
        source: 'channel',
        channelChatId: 'chat-b',
        channel: { id: 'plugin-a', type: 'qq' },
      }),
    ],
  );
  // 渠道元数据不完整的会话：fail-closed。
  dbModule.sqliteRun(
    `INSERT INTO sessions (id, user_id, title, metadata_json, state_status)
     VALUES (?, ?, 'channel-broken', '{"source":"channel"}', 'idle')`,
    [BROKEN_CHANNEL_SESSION_ID, USER_ID],
  );
});

afterAll(async () => {
  cronScheduler.stopAll();
  await dbModule.closeDb();
});

function run(input: Record<string, unknown>, sessionId = SESSION_ID): Promise<string> {
  return admin.runScheduleManageTool({
    userId: USER_ID,
    sessionId,
    input: admin.scheduleManageInputSchema.parse(input),
  });
}

function countJobs(): number {
  return dbModule.sqliteGet<{ n: number }>('SELECT COUNT(*) AS n FROM cron_jobs', [])?.n ?? 0;
}

function addEveryJob(name = '巡检'): Promise<string> {
  return run({
    action: 'add',
    job: {
      name,
      schedule_kind: 'every',
      schedule_every: 3_600_000,
      prompt: '检查服务状态',
    },
  });
}

describe('schedule_manage · 契约', () => {
  it('工具名常量与定义一致（防漂移）', () => {
    expect(admin.SCHEDULE_MANAGE_TOOL_NAME).toBe('schedule_manage');
    expect(admin.scheduleManageToolDefinition.name).toBe(admin.SCHEDULE_MANAGE_TOOL_NAME);
  });

  it('输入 schema：add 必填字段与调度类型一致性校验', () => {
    expect(admin.scheduleManageInputSchema.safeParse({ action: 'list' }).success).toBe(true);
    expect(admin.scheduleManageInputSchema.safeParse({ action: 'add' }).success).toBe(false);
    expect(
      admin.scheduleManageInputSchema.safeParse({
        action: 'add',
        job: { name: 'x', schedule_kind: 'every', prompt: 'p' },
      }).success,
    ).toBe(false);
    expect(
      admin.scheduleManageInputSchema.safeParse({
        action: 'add',
        job: { name: 'x', schedule_kind: 'cron', schedule_expr: '0 9 * * *', prompt: 'p' },
      }).success,
    ).toBe(true);
    expect(admin.scheduleManageInputSchema.safeParse({ action: 'remove' }).success).toBe(false);
  });
});

describe('schedule_manage · add / list / update / remove', () => {
  it('add 持久化任务并立即可 list；重启恢复数据源可见', async () => {
    const output = await addEveryJob();
    const parsed = JSON.parse(output) as { ok: boolean; job: { id: string; enabled: boolean } };
    expect(parsed.ok).toBe(true);
    expect(parsed.job.enabled).toBe(true);
    expect(countJobs()).toBe(1);

    const listParsed = JSON.parse(await run({ action: 'list' })) as {
      count: number;
      jobs: Array<{ id: string; scheduleKind: string }>;
    };
    expect(listParsed.count).toBe(1);
    expect(listParsed.jobs[0]).toMatchObject({ id: parsed.job.id, scheduleKind: 'every' });
  });

  it('update 部分字段并落库；enable / disable 切换持久化 enabled', async () => {
    const added = JSON.parse(await addEveryJob()) as { job: { id: string } };
    const jobId = added.job.id;

    await run({ action: 'update', jobId, job: { name: '巡检 v2' } });
    expect(cronScheduler.getJob(jobId)?.name).toBe('巡检 v2');
    expect(
      dbModule.sqliteGet<{ name: string }>('SELECT name FROM cron_jobs WHERE id = ?', [jobId])
        ?.name,
    ).toBe('巡检 v2');

    await run({ action: 'disable', jobId });
    expect(cronScheduler.getJob(jobId)?.enabled).toBe(false);
    expect(
      dbModule.sqliteGet<{ enabled: number }>('SELECT enabled FROM cron_jobs WHERE id = ?', [jobId])
        ?.enabled,
    ).toBe(0);

    await run({ action: 'enable', jobId });
    expect(cronScheduler.getJob(jobId)?.enabled).toBe(true);
    expect(
      dbModule.sqliteGet<{ enabled: number }>('SELECT enabled FROM cron_jobs WHERE id = ?', [jobId])
        ?.enabled,
    ).toBe(1);
  });

  it('remove 从调度器与持久化同时删除', async () => {
    const added = JSON.parse(await addEveryJob()) as { job: { id: string } };
    const output = await run({ action: 'remove', jobId: added.job.id });
    expect(JSON.parse(output)).toMatchObject({ removed: true });
    expect(cronScheduler.getJob(added.job.id)).toBeUndefined();
    expect(countJobs()).toBe(0);
  });

  it('update / remove / history 拒绝非本人任务', async () => {
    cronScheduler.addJob({
      id: 'other-job',
      user_id: OTHER_USER_ID,
      name: 'other',
      schedule_kind: 'every',
      schedule_at: null,
      schedule_every: 3_600_000,
      schedule_expr: null,
      schedule_tz: 'UTC',
      prompt: 'p',
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
      created_at: Date.now(),
      updated_at: Date.now(),
    });

    await expect(run({ action: 'update', jobId: 'other-job', job: { name: 'x' } })).rejects.toThrow(
      /未找到/,
    );
    await expect(run({ action: 'remove', jobId: 'other-job' })).rejects.toThrow(/未找到/);
    await expect(run({ action: 'history', jobId: 'other-job' })).rejects.toThrow(/未找到/);
  });

  it('add 拒绝过去的 at 与过小的 every（避免永不触发 / 高频任务）', async () => {
    await expect(
      run({
        action: 'add',
        job: {
          name: 'x',
          schedule_kind: 'at',
          schedule_at: Date.now() - 1000,
          prompt: 'p',
        },
      }),
    ).rejects.toThrow(/未来时间/);
    await expect(
      run({
        action: 'add',
        job: { name: 'x', schedule_kind: 'every', schedule_every: 10, prompt: 'p' },
      }),
    ).rejects.toThrow(/1000/);
  });

  it('update 把调度改成 cron 但缺表达式时拒绝（防静默失效）', async () => {
    const added = JSON.parse(await addEveryJob()) as { job: { id: string } };
    await expect(
      run({ action: 'update', jobId: added.job.id, job: { schedule_kind: 'cron' } }),
    ).rejects.toThrow(/schedule_expr/);
    // 拒绝后原任务保持不变。
    expect(cronScheduler.getJob(added.job.id)?.schedule_kind).toBe('every');
  });

  it('working_folder 必须在当前会话工作区内', async () => {
    const inside = JSON.parse(
      await run({
        action: 'add',
        job: {
          name: 'inside',
          schedule_kind: 'every',
          schedule_every: 3_600_000,
          prompt: 'p',
          working_folder: WORKSPACE_DIR,
        },
      }),
    ) as { ok: boolean };
    expect(inside.ok).toBe(true);

    await expect(
      run({
        action: 'add',
        job: {
          name: 'outside',
          schedule_kind: 'every',
          schedule_every: 3_600_000,
          prompt: 'p',
          working_folder: OUTSIDE_DIR,
        },
      }),
    ).rejects.toThrow(/工作区内/);
  });

  it('history 读取持久化执行历史', async () => {
    const added = JSON.parse(await addEveryJob()) as { job: { id: string } };
    const jobId = added.job.id;
    dbModule.sqliteRun(
      `INSERT INTO cron_job_executions (id, job_id, user_id, started_at, finished_at, status, error, session_id)
       VALUES ('exec-1', ?, ?, 1000, 2000, 'failed', 'boom', NULL)`,
      [jobId, USER_ID],
    );

    const parsed = JSON.parse(await run({ action: 'history', jobId })) as {
      count: number;
      history: Array<{ id: string; status: string; error?: string }>;
    };
    expect(parsed.count).toBe(1);
    expect(parsed.history[0]).toMatchObject({ id: 'exec-1', status: 'failed', error: 'boom' });
  });
});

describe('schedule_manage · 渠道会话作用域', () => {
  it('渠道会话可建任务，且投稿目标被钉回当前渠道 + 当前会话', async () => {
    const output = await run(
      {
        action: 'add',
        job: {
          name: '每日群报',
          schedule_kind: 'every',
          schedule_every: 3_600_000,
          prompt: '报进度',
        },
      },
      CHANNEL_SESSION_ID,
    );
    const parsed = JSON.parse(output) as { ok: boolean; job: { id: string } };
    expect(parsed.ok).toBe(true);

    // `plugin_id` + `plugin_chat_id` 是渠道回发的唯一依据；`delivery_mode` 保持
    // `none`——填 `session` + chatId 会让 `prepareCronSession` 拿 chatId 去查
    // sessions 表并抛错（任务到点必失败）。
    const stored = cronScheduler.getJob(parsed.job.id);
    expect(stored).toMatchObject({
      plugin_id: 'plugin-a',
      plugin_chat_id: 'chat-a',
      delivery_mode: 'none',
      delivery_target: null,
    });
  });

  it('渠道会话只能看到本会话的任务', async () => {
    await run(
      {
        action: 'add',
        job: {
          name: 'chat-a 的任务',
          schedule_kind: 'every',
          schedule_every: 3_600_000,
          prompt: 'p',
        },
      },
      CHANNEL_SESSION_ID,
    );
    await run(
      {
        action: 'add',
        job: {
          name: 'chat-b 的任务',
          schedule_kind: 'every',
          schedule_every: 3_600_000,
          prompt: 'p',
        },
      },
      OTHER_CHANNEL_SESSION_ID,
    );

    const listA = JSON.parse(await run({ action: 'list' }, CHANNEL_SESSION_ID)) as {
      count: number;
      jobs: Array<{ name: string }>;
    };
    expect(listA.count).toBe(1);
    expect(listA.jobs[0]?.name).toBe('chat-a 的任务');
  });

  it('渠道会话删不掉别的渠道会话的任务（按未找到处理）', async () => {
    const other = JSON.parse(
      await run(
        {
          action: 'add',
          job: {
            name: 'chat-b 的任务',
            schedule_kind: 'every',
            schedule_every: 3_600_000,
            prompt: 'p',
          },
        },
        OTHER_CHANNEL_SESSION_ID,
      ),
    ) as { job: { id: string } };

    await expect(
      run({ action: 'remove', jobId: other.job.id }, CHANNEL_SESSION_ID),
    ).rejects.toThrow(/未找到/);
    expect(cronScheduler.getJob(other.job.id)).toBeDefined();
  });

  it('渠道会话不能把任务归属到别的渠道', async () => {
    await expect(
      run(
        {
          action: 'add',
          job: {
            name: '逃逸',
            schedule_kind: 'every',
            schedule_every: 3_600_000,
            prompt: 'p',
            plugin_id: 'plugin-other',
          },
        },
        CHANNEL_SESSION_ID,
      ),
    ).rejects.toThrow(/当前渠道/);
  });

  it('渠道元数据不完整时 fail-closed', async () => {
    await expect(run({ action: 'list' }, BROKEN_CHANNEL_SESSION_ID)).rejects.toThrow(/渠道标识/);
  });

  it('渠道会话放通后，定时任务派发的运行仍禁止再管理定时任务（防自我复制旁路）', async () => {
    // 渠道任务执行时会**复用渠道会话**（`prepareCronSession`），此时
    // metadata.source 仍是 'channel'。只按 source 判定会放过
    // 「定时任务 → 继续建定时任务」这条无人值守路径。
    const cronDispatched = {
      userId: USER_ID,
      sessionId: CHANNEL_SESSION_ID,
      input: admin.scheduleManageInputSchema.parse({ action: 'list' }),
      clientRequestId: `cron-${'job-1'}-00000000-0000-4000-8000-000000000000`,
    };
    await expect(admin.runScheduleManageTool(cronDispatched)).rejects.toThrow(/禁止自我复制/);

    // 同一渠道会话里用户自己发的回合（外部随机键）仍然可用。
    await expect(
      admin.runScheduleManageTool({
        ...cronDispatched,
        clientRequestId: '00000000-0000-4000-8000-000000000000',
      }),
    ).resolves.toBeTypeOf('string');
  });

  it('run 立即执行一次并写入执行历史', async () => {
    const added = JSON.parse(
      await run(
        {
          action: 'add',
          job: { name: '手动', schedule_kind: 'every', schedule_every: 3_600_000, prompt: 'p' },
        },
        SESSION_ID,
      ),
    ) as { job: { id: string } };

    const output = JSON.parse(await run({ action: 'run', jobId: added.job.id })) as {
      ok: boolean;
      started: boolean;
    };
    expect(output).toMatchObject({ ok: true, started: true });
  });
});

describe('schedule_manage · 会话守卫', () => {
  it('cron / team 会话拒绝所有动作；渠道会话放通', async () => {
    await expect(run({ action: 'list' }, CRON_SESSION_ID)).rejects.toThrow(/禁止自我复制/);
    await expect(run({ action: 'list' }, TEAM_SESSION_ID)).rejects.toThrow(/团队会话/);
    // 渠道会话已放通（作用域收敛由上面的作用域用例覆盖）。
    await expect(run({ action: 'list' }, CHANNEL_SESSION_ID)).resolves.toBeTypeOf('string');
  });

  it('resolveScheduleManageSessionDenial：cron 优先 / team 元数据 / 普通会话 / 缺行', () => {
    expect(
      admin.resolveScheduleManageSessionDenial({
        metadata_json: JSON.stringify({ source: 'cron', teamWorkspaceId: 'ws-1' }),
        role_layer: 'executor',
        team_parent_session_id: 'parent-1',
        handoff_state: 'running',
      }),
    ).toContain('禁止自我复制');
    expect(
      admin.resolveScheduleManageSessionDenial({
        metadata_json: JSON.stringify({ teamRoleInstance: { role: 'executor' } }),
        role_layer: null,
        team_parent_session_id: null,
        handoff_state: null,
      }),
    ).toContain('团队会话');
    expect(
      admin.resolveScheduleManageSessionDenial({
        metadata_json: '{}',
        role_layer: null,
        team_parent_session_id: null,
        handoff_state: null,
      }),
    ).toBeNull();
    expect(admin.resolveScheduleManageSessionDenial(null)).toContain('已拒绝');
  });

  it('渠道作用域解析：完整元数据可得，缺失时为 null（fail-closed）', () => {
    expect(
      admin.resolveScheduleManageChannelScope({
        source: 'channel',
        channelChatId: 'chat-a',
        channel: { id: 'plugin-a' },
      }),
    ).toEqual({ pluginId: 'plugin-a', chatId: 'chat-a' });

    expect(admin.resolveScheduleManageChannelScope({ source: 'channel' })).toBeNull();
    expect(
      admin.resolveScheduleManageChannelScope({
        source: 'channel',
        channel: { id: 'plugin-a' },
      }),
    ).toBeNull();
    // 非渠道会话没有作用域限制。
    expect(admin.resolveScheduleManageChannelScope({ source: 'desktop' })).toBeNull();
  });
});
