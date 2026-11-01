import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChannelInstance } from '../../channels/types.js';
import type { CronJobRecord } from '../../cron/types.js';
import type * as agentHandlerModule from '../../cron/agent-handler.js';
import { isGatewayToolEnabledForSessionMetadata } from '../../session/session-tool-visibility.js';
import type * as dbModule from '../../infra/db.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

const runSessionInBackgroundMock = vi.hoisted(() => vi.fn());
const resolveAnyChannelMock = vi.hoisted(() => vi.fn());

vi.mock('../../routes/stream-runtime.js', () => ({
  runSessionInBackground: runSessionInBackgroundMock,
}));

vi.mock('../../channels/router.js', () => ({
  resolveAnyChannel: resolveAnyChannelMock,
}));

function cronJob(overrides: Partial<CronJobRecord> = {}): CronJobRecord {
  return {
    id: 'cron-1',
    user_id: 'user-cron',
    name: 'daily report',
    schedule_kind: 'every',
    schedule_at: null,
    schedule_every: 60_000,
    schedule_expr: null,
    schedule_tz: 'UTC',
    prompt: '每天总结项目状态',
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

function qqChannel(overrides: Partial<ChannelInstance> = {}): ChannelInstance {
  return {
    id: 'qq-1',
    ownerUserId: 'user-cron',
    type: 'qq',
    name: 'QQ bot',
    enabled: true,
    config: {},
    createdAt: 0,
    updatedAt: 0,
    tools: { web_search: true, read: true },
    features: { autoStart: true, autoReply: true, streamingReply: false },
    permissions: {
      allowReadHome: false,
      readablePathPrefixes: [],
      allowWriteOutside: false,
      allowShell: true,
      allowSubAgents: true,
    },
    ...overrides,
  };
}

describe('cron agent channel delivery', () => {
  let db: typeof dbModule;
  let handler: typeof agentHandlerModule;

  beforeAll(async () => {
    db = await import('../../infra/db.js');
    await db.connectDb();
    await db.migrate();
    handler = await import('../../cron/agent-handler.js');
  });

  beforeEach(() => {
    runSessionInBackgroundMock.mockReset();
    runSessionInBackgroundMock.mockResolvedValue({ statusCode: 200, stopReason: 'end_turn' });
    resolveAnyChannelMock.mockReset();
    db.sqliteRun('DELETE FROM sessions');
    db.sqliteRun('DELETE FROM users');
    db.sqliteRun("INSERT INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
      'user-cron',
      'cron@example.com',
    ]);
  });

  it('Given channel cron job When prompt is built Then it instructs PluginSendMessage channel routing', () => {
    const prompt = handler.buildCronAgentPrompt(
      cronJob({ plugin_id: 'qq-1', plugin_chat_id: 'c2c:open-id' }),
    );

    expect(prompt).toContain('## Channel Reply Routing');
    expect(prompt).toContain('plugin_id="qq-1"');
    expect(prompt).toContain('chat_id="c2c:open-id"');
    expect(prompt).toContain('PluginSendMessage');
    expect(prompt).toContain('Chinese task -> Chinese reply');
  });

  it('Given channel cron job When it runs Then it uses a dedicated channel session and starts background stream', async () => {
    resolveAnyChannelMock.mockReturnValue(qqChannel());

    await handler.runCronAgentJob(
      cronJob({ plugin_id: 'qq-1', plugin_chat_id: 'c2c:open-id', model: 'mimo-v2.5' }),
    );

    const row = db.sqliteGet<{ id: string; title: string; metadata_json: string }>(
      'SELECT id, title, metadata_json FROM sessions WHERE user_id = ? LIMIT 1',
      ['user-cron'],
    );
    // 必须是**独立的**渠道执行会话：不能是用户对话会话的 key
    // （`channel:qq-1:chat:c2c:open-id`），否则任务触发时会与该渠道的对话争单飞锁。
    expect(row?.title).toBe('cron-channel:qq-1:c2c:open-id:cron-1');
    expect(row?.title.startsWith('channel:')).toBe(false);
    const metadata = JSON.parse(row?.metadata_json ?? '{}') as Record<string, unknown>;
    // 仍保留渠道身份：渠道工具可见性与 allowlist 全靠 `source === 'channel'`，
    // 改成 'cron' 会让渠道权限收敛全部失效。
    expect(metadata['source']).toBe('channel');
    expect(metadata['channelChatId']).toBe('c2c:open-id');
    expect(metadata['channelLlmToolsEnabled']).toBe(true);
    expect(runSessionInBackgroundMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: row?.id,
        userId: 'user-cron',
        requestData: expect.objectContaining({
          displayMessage: '每天总结项目状态',
          message: expect.stringContaining('PluginSendMessage'),
          model: 'mimo-v2.5',
        }),
      }),
    );
  });

  it('渠道任务带历史遗留的 session 投递配置时照常执行（不误判、不误报）', async () => {
    resolveAnyChannelMock.mockReturnValue(qqChannel());
    // 线上实测的坏配置：delivery_mode=session + delivery_target 被写成 chatId。
    // 旧实现在**执行前**按「目标会话必须存在」校验，于是每 10 分钟失败一次、
    // 任务根本没跑过；修好后的语义是：渠道任务的结果由 PluginSendMessage 回发，
    // 这两个字段不参与执行（也不参与成败判定）。
    await expect(
      handler.runCronAgentJob(
        cronJob({
          plugin_id: 'qq-1',
          plugin_chat_id: 'c2c:open-id',
          delivery_mode: 'session',
          delivery_target: 'c2c:open-id',
        }),
      ),
    ).resolves.toBeUndefined();
    expect(runSessionInBackgroundMock).toHaveBeenCalledTimes(1);
  });

  it('渠道任务不与用户对话会话共用（否则触发时与该渠道对话争锁 → 409）', async () => {
    resolveAnyChannelMock.mockReturnValue(qqChannel());
    // 用户在该渠道的对话会话：title 正是 `buildChannelSessionKey` 的产物。
    db.sqliteRun(
      `INSERT INTO sessions (id, user_id, title, messages_json, state_status, metadata_json)
       VALUES ('user-channel-session', 'user-cron', 'channel:qq-1:chat:c2c:open-id', '[]', 'idle', ?)`,
      [
        JSON.stringify({
          source: 'channel',
          channelChatId: 'c2c:open-id',
          channel: { id: 'qq-1' },
        }),
      ],
    );

    await handler.runCronAgentJob(cronJob({ plugin_id: 'qq-1', plugin_chat_id: 'c2c:open-id' }));

    const called = runSessionInBackgroundMock.mock.calls[0]?.[0] as { sessionId: string };
    expect(called.sessionId).not.toBe('user-channel-session');

    // 同一任务再次触发：复用同一条 cron 渠道会话，不无限累积。
    await handler.runCronAgentJob(cronJob({ plugin_id: 'qq-1', plugin_chat_id: 'c2c:open-id' }));
    const second = runSessionInBackgroundMock.mock.calls[1]?.[0] as { sessionId: string };
    expect(second.sessionId).toBe(called.sessionId);

    // 且不会在渠道会话列表里多出脏条目：`channel-conversations` 用
    // `title LIKE 'channel:<plugin>:chat:%'` 收录，cron 会话不得命中它
    // （若当初用 `…:chat:<chat>:cron` 加后缀，就会多出一条 chatId 为 `<chat>:cron` 的会话）。
    const channelListed = db.sqliteGet<{ n: number }>(
      "SELECT COUNT(*) AS n FROM sessions WHERE title LIKE 'channel:qq-1:chat:%'",
    );
    expect(channelListed?.n).toBe(1);

    // 关键：渠道身份必须保住 —— 否则任务即便跑起来也发不回渠道。
    const row = db.sqliteGet<{ metadata_json: string }>(
      'SELECT metadata_json FROM sessions WHERE id = ?',
      [called.sessionId],
    );
    const metadata = JSON.parse(row?.metadata_json ?? '{}') as Record<string, unknown>;
    expect(isGatewayToolEnabledForSessionMetadata('PluginSendMessage', metadata)).toBe(true);

    // 并且打上「cron 执行会话」标记：它的 source 与普通渠道会话相同，
    // 未来的闲置会话清理只能靠这个标记排除，否则会删掉任务执行现场。
    expect(metadata['cronJobId']).toBe('cron-1');
    expect(metadata['isCronExecution']).toBe(1);
  });

  it('普通任务每次触发都新建独立执行会话，不复用 session_id（避免撞单飞锁）', async () => {
    // 用户指定的 session_id 只表达「结果投递到哪」，不再决定执行落在哪个会话：
    // 复用它会与用户正在浏览的会话争锁，导致 409 秒回（本次「24ms completed」根因）。
    db.sqliteRun(
      "INSERT INTO sessions (id, user_id, title, messages_json, state_status) VALUES ('user-session', 'user-cron', 'user session', '[]', 'idle')",
    );

    await handler.runCronAgentJob(cronJob({ session_id: 'user-session' }));

    const called = runSessionInBackgroundMock.mock.calls[0]?.[0] as { sessionId: string };
    expect(called.sessionId).not.toBe('user-session');
    const row = db.sqliteGet<{ metadata_json: string }>(
      'SELECT metadata_json FROM sessions WHERE id = ?',
      [called.sessionId],
    );
    expect(JSON.parse(row?.metadata_json ?? '{}')['source']).toBe('cron');
  });

  it('投递目标会话已被删除时明确失败、且主动推一条通知（用户不必等自己发现）', async () => {
    await expect(
      handler.runCronAgentJob(cronJob({ delivery_mode: 'session', session_id: 'gone-session' })),
    ).rejects.toThrow(/does not exist/);
    expect(runSessionInBackgroundMock).not.toHaveBeenCalled();

    const notice = db.sqliteGet<{ title: string; body: string }>(
      'SELECT title, body FROM notifications WHERE user_id = ?',
      ['user-cron'],
    );
    expect(notice?.title ?? '').toContain('无法执行');
    expect(notice?.body ?? '').toContain('does not exist');
  });

  it('delivery_mode 为 none 时来源会话被删不应阻塞执行', async () => {
    // 回归：此前无条件校验 session_id，`none` / `desktop` 任务只要来源会话被删，
    // 每次触发都在执行前失败并反复推「无法执行」，而它其实完全能跑。
    await handler.runCronAgentJob(cronJob({ session_id: 'gone-session', delivery_mode: 'none' }));
    expect(runSessionInBackgroundMock).toHaveBeenCalledTimes(1);
  });

  it('执行会话数量有上限：超出的旧 idle cron 会话被回收，且不碰用户会话', async () => {
    // 用户自己的会话（非 cron）绝不能被回收。
    db.sqliteRun(
      "INSERT INTO sessions (id, user_id, title, messages_json, state_status) VALUES ('mine', 'user-cron', '我的会话', '[]', 'idle')",
    );
    // 造 25 条本任务的旧 idle 执行会话（上限 20）。
    for (let i = 0; i < 25; i += 1) {
      db.sqliteRun(
        `INSERT INTO sessions (id, user_id, title, messages_json, state_status, metadata_json, created_at)
         VALUES (?, 'user-cron', 'cron:old', '[]', 'idle', ?, ?)`,
        [
          `old-${i}`,
          JSON.stringify({ source: 'cron', cronJobId: 'cron-1' }),
          `2026-01-01 00:00:${String(i).padStart(2, '0')}`,
        ],
      );
    }
    // 另一任务的会话不受本任务回收影响。
    db.sqliteRun(
      `INSERT INTO sessions (id, user_id, title, messages_json, state_status, metadata_json)
       VALUES ('other-job', 'user-cron', 'cron:other', '[]', 'idle', ?)`,
      [JSON.stringify({ source: 'cron', cronJobId: 'cron-2' })],
    );

    await handler.runCronAgentJob(cronJob());

    const count = db.sqliteGet<{ n: number }>(
      `SELECT COUNT(*) AS n FROM sessions
       WHERE user_id = 'user-cron'
         AND json_extract(metadata_json, '$.cronJobId') = 'cron-1'`,
    );
    // 25 条旧 + 本次新建 1 条 = 26 → 回收到上限 20。
    expect(count?.n).toBe(20);
    expect(db.sqliteGet('SELECT id FROM sessions WHERE id = ?', ['mine'])).toBeDefined();
    expect(db.sqliteGet('SELECT id FROM sessions WHERE id = ?', ['other-job'])).toBeDefined();
  });

  it('停在等审批（paused）的执行会话不被回收', async () => {
    for (let i = 0; i < 25; i += 1) {
      db.sqliteRun(
        `INSERT INTO sessions (id, user_id, title, messages_json, state_status, metadata_json, created_at)
         VALUES (?, 'user-cron', 'cron:paused', '[]', ?, ?, ?)`,
        [
          `p-${i}`,
          i === 0 ? 'paused' : 'idle',
          JSON.stringify({ source: 'cron', cronJobId: 'cron-1' }),
          `2026-01-01 00:00:${String(i).padStart(2, '0')}`,
        ],
      );
    }

    await handler.runCronAgentJob(cronJob());

    // 最早那条正是 paused：即使最旧也必须留下（保留「卡在哪一步」的现场）。
    expect(db.sqliteGet('SELECT id FROM sessions WHERE id = ?', ['p-0'])).toBeDefined();
  });
});

describe('cron 执行结果判定', () => {
  let handler: typeof agentHandlerModule;

  beforeAll(async () => {
    handler = await import('../../cron/agent-handler.js');
  });

  it('正常终态不抛错（end_turn / max_tokens）', () => {
    for (const stopReason of ['end_turn', 'max_tokens'] as const) {
      expect(() => handler.assertCronRunSucceeded({ statusCode: 200, stopReason })).not.toThrow();
    }
  });

  it('会话冲突抛出可读原因（两种真实形状：裸 409 与补全后的 409+error）', () => {
    // 裸形状：`handleStreamRequest` 的 early-return（无 stopReason）。
    expect(() =>
      handler.assertCronRunSucceeded({
        statusCode: 409,
        errorSummary: '会话已有其他请求运行中（SESSION_ALREADY_RUNNING）',
      }),
    ).toThrow(/409/);
    // 线上真实形状：`runSessionInBackground` 会把无 stopReason 的结果补成
    // `stopReason: 'error'`（routes/stream-runtime.ts 的防御性补全），
    // 因此判定**不能**依赖 `stopReason === undefined`。
    expect(() =>
      handler.assertCronRunSucceeded({
        statusCode: 409,
        stopReason: 'error',
        errorSummary: '会话已有其他请求运行中（SESSION_ALREADY_RUNNING）',
      }),
    ).toThrow(/409/);
  });

  it('权限停滞给出可操作建议（cron 会话无人批准）', () => {
    expect(() =>
      handler.assertCronRunSucceeded({ statusCode: 200, stopReason: 'tool_permission' }),
    ).toThrow(/等待用户批准/);
  });

  it('replay 拦截 / 错误终态都算失败', () => {
    for (const result of [
      {
        statusCode: 200,
        stopReason: 'error' as const,
        errorSummary: '请求被 replay 拦截（同 clientRequestId 已有持久化结果）',
      },
      { statusCode: 500, stopReason: 'error' as const, errorSummary: 'upstream boom' },
      { statusCode: 200, stopReason: 'cancelled' as const },
    ]) {
      expect(() => handler.assertCronRunSucceeded(result), JSON.stringify(result)).toThrow();
    }
  });
});
