/**
 * stream → team-events 桥接的 roleLayer 守卫 + 持久化验证。
 *
 * executor / reviewer 走完整 stream 协议（runSessionInBackground → handleStreamRequest），
 * 其 sessionContext.roleLayer 来自 sessions.role_layer 列（createTeamSession 必写）。
 * 本测试锁定两件事：
 *   1. 有 roleLayer 时发出 team_usage / team_tool_call / team_timing 事件，并落库到
 *      team_usage_records（跨刷新存活）；roleLayer 为空（chat 端）一律不发不落库。
 *   2. 非流式 workflow 路径（reception/pm1/pm2）的 publishTeamWorkflowUsageEvent
 *      同样落库——与 stream 路径口径一致。
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as EventsModule from '../../routes/stream-team-events.js';
import type * as RecordsModule from '../../team/team-usage-records-store.js';
import type * as BusActual from '../../handoff/bus/team-events-bus.js';

process.env['DATABASE_URL'] = ':memory:';

let dbModule: typeof DbModule;
let events: typeof EventsModule;
let records: typeof RecordsModule;

const USER_ID = 'u-stream-team-events';

const publishSpy = vi.fn();
vi.mock('../../handoff/bus/team-events-bus.js', async (orig) => {
  type BusModule = typeof BusActual;
  const actual = await (orig() as Promise<BusModule>);
  return {
    ...actual,
    publishTeamEvent: (event: unknown) => {
      publishSpy(event);
    },
  };
});

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.migrate();
  events = await import('../../routes/stream-team-events.js');
  records = await import('../../team/team-usage-records-store.js');
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM team_usage_records', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    `${USER_ID}@example.com`,
  ]);
  publishSpy.mockReset();
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('stream-team-events · roleLayer 守卫 + 持久化', () => {
  it('executor session 发出 team_usage 事件并落库', () => {
    events.publishTeamUsageEvent({
      userId: USER_ID,
      sessionId: 's-exec',
      sessionContext: { metadataJson: '{}', roleLayer: 'executor' },
      round: 1,
      provider: 'anthropic',
      model: 'claude',
      inputTokens: 100,
      outputTokens: 50,
      costUsd: 0.01,
    });

    expect(publishSpy).toHaveBeenCalledTimes(1);
    const envelope = publishSpy.mock.calls[0]?.[0] as {
      layer?: string;
      payload?: Record<string, unknown>;
    };
    expect(envelope.layer).toBe('executor');
    expect(envelope.payload?.['__teamEventKind']).toBe('team_usage');

    const rows = records.listTeamUsageRecords({ userId: USER_ID, sessionIds: ['s-exec'] });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.layer).toBe('executor');
    expect(rows[0]?.inputTokens).toBe(100);
    expect(rows[0]?.outputTokens).toBe(50);
    expect(rows[0]?.callCount).toBe(1);
  });

  it('chat 会话（roleLayer=null）不发事件也不落库', () => {
    events.publishTeamUsageEvent({
      userId: USER_ID,
      sessionId: 's-chat',
      sessionContext: { metadataJson: '{}', roleLayer: null },
      round: 1,
      inputTokens: 100,
      outputTokens: 50,
    });
    events.publishTeamToolCallEvent({
      userId: USER_ID,
      sessionId: 's-chat',
      sessionContext: { metadataJson: '{}', roleLayer: null },
      toolName: 'read',
      durationMs: 12,
      success: true,
    });
    expect(publishSpy).not.toHaveBeenCalled();
    expect(records.listTeamUsageRecords({ userId: USER_ID, sessionIds: ['s-chat'] })).toHaveLength(
      0,
    );
  });

  it('非流式 workflow 用量（reception/pm1/pm2）同样落库', () => {
    events.publishTeamWorkflowUsageEvent({
      userId: USER_ID,
      sessionId: 's-pm1',
      layer: 'pm1',
      provider: 'openai',
      model: 'gpt-4o',
      inputTokens: 200,
      outputTokens: 80,
      costUsd: 0.02,
    });
    expect(publishSpy).toHaveBeenCalledTimes(1);
    const rows = records.listTeamUsageRecords({ userId: USER_ID, sessionIds: ['s-pm1'] });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.layer).toBe('pm1');
    expect(rows[0]?.inputTokens).toBe(200);
    expect(rows[0]?.callCount).toBe(1);
  });

  it('workflow 用量 layer 为空 / 零 token 时不发不落库', () => {
    events.publishTeamWorkflowUsageEvent({
      userId: USER_ID,
      sessionId: 's-x',
      layer: null,
      inputTokens: 100,
      outputTokens: 50,
    });
    events.publishTeamWorkflowUsageEvent({
      userId: USER_ID,
      sessionId: 's-y',
      layer: 'pm2',
      inputTokens: 0,
      outputTokens: 0,
    });
    expect(publishSpy).not.toHaveBeenCalled();
    expect(
      records.listTeamUsageRecords({ userId: USER_ID, sessionIds: ['s-x', 's-y'] }),
    ).toHaveLength(0);
  });
});
