import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChannelInstance } from '../../channels/types.js';
import type { CronJobRecord } from '../../cron/types.js';
import type * as agentHandlerModule from '../../cron/agent-handler.js';
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

  it('Given channel cron job When it runs Then it creates channel-managed session and starts background stream', async () => {
    resolveAnyChannelMock.mockReturnValue(qqChannel());

    await handler.runCronAgentJob(
      cronJob({ plugin_id: 'qq-1', plugin_chat_id: 'c2c:open-id', model: 'mimo-v2.5' }),
    );

    const row = db.sqliteGet<{ id: string; title: string; metadata_json: string }>(
      'SELECT id, title, metadata_json FROM sessions WHERE user_id = ? LIMIT 1',
      ['user-cron'],
    );
    expect(row?.title).toBe('channel:qq-1:chat:c2c:open-id');
    const metadata = JSON.parse(row?.metadata_json ?? '{}') as Record<string, unknown>;
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
});
