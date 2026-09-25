/**
 * 会话路由选择（模型/思考档位）持久化与唤醒回退回归。
 *
 * 唤醒轮（子代理完成 → 父会话 `continueSessionFromHistory`）构造的是空
 * requestData；若不在请求缺省时回退会话 metadata，`thinkingLanguagePrompt`
 * 的 system 槽位会在「启用/未启用」间翻转，整段历史 prompt-cache 被反复打断。
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as RouteSelectionModule from '../../session/session-route-selection.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let dbModule: typeof DbModule;
let routeSelection: typeof RouteSelectionModule;

const USER_ID = 'u-session-route-selection';
const SESSION_ID = 'sess-session-route-selection';

function readMetadata(): Record<string, unknown> {
  const row = dbModule.sqliteGet<{ metadata_json: string }>(
    'SELECT metadata_json FROM sessions WHERE id = ? AND user_id = ?',
    [SESSION_ID, USER_ID],
  );
  return JSON.parse(row?.metadata_json ?? '{}') as Record<string, unknown>;
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  routeSelection = await import('../../session/session-route-selection.js');
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM sessions', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    `${USER_ID}@example.com`,
  ]);
  dbModule.sqliteRun(
    `INSERT INTO sessions (id, user_id, title, messages_json, metadata_json, state_status)
     VALUES (?, ?, 'route selection', '[]', '{"existing":"keep"}', 'idle')`,
    [SESSION_ID, USER_ID],
  );
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('persistSessionRouteSelection', () => {
  it('写入变更字段并保留其它 metadata；值未变化时不重复写库', () => {
    expect(
      routeSelection.persistSessionRouteSelection(SESSION_ID, USER_ID, {
        modelId: 'deepseek-v4.1-flash',
        providerId: 'opencode-go',
        thinkingEnabled: true,
        reasoningEffort: 'high',
      }),
    ).toBe(true);

    expect(readMetadata()).toMatchObject({
      existing: 'keep',
      modelId: 'deepseek-v4.1-flash',
      providerId: 'opencode-go',
      thinkingEnabled: true,
      reasoningEffort: 'high',
    });

    // 幂等：相同值不再写库。
    expect(
      routeSelection.persistSessionRouteSelection(SESSION_ID, USER_ID, {
        modelId: 'deepseek-v4.1-flash',
        providerId: 'opencode-go',
        thinkingEnabled: true,
        reasoningEffort: 'high',
      }),
    ).toBe(false);
  });

  it('未提供的字段不下发、也不清除既有值（唤醒轮只读不写）', () => {
    routeSelection.persistSessionRouteSelection(SESSION_ID, USER_ID, {
      modelId: 'm-1',
      thinkingEnabled: true,
    });
    expect(
      routeSelection.persistSessionRouteSelection(SESSION_ID, USER_ID, {
        providerId: 'p-1',
      }),
    ).toBe(true);
    expect(readMetadata()).toMatchObject({
      modelId: 'm-1',
      providerId: 'p-1',
      thinkingEnabled: true,
    });
  });

  it('会话不存在时返回 false 且不抛错', () => {
    expect(
      routeSelection.persistSessionRouteSelection('sess-missing', USER_ID, { modelId: 'm' }),
    ).toBe(false);
  });
});

describe('resolveEffectiveThinkingSelection', () => {
  it('team 权威绑定 > 请求显式值 > 会话 metadata', () => {
    expect(
      routeSelection.resolveEffectiveThinkingSelection({
        hasAuthoritativeTeamModel: true,
        sessionThinkingEnabled: true,
        sessionReasoningEffort: 'high',
        requestDataThinkingEnabled: false,
        requestDataReasoningEffort: 'low',
      }),
    ).toEqual({ thinkingEnabled: true, reasoningEffort: 'high' });

    expect(
      routeSelection.resolveEffectiveThinkingSelection({
        hasAuthoritativeTeamModel: false,
        sessionThinkingEnabled: true,
        sessionReasoningEffort: 'high',
        requestDataThinkingEnabled: false,
        requestDataReasoningEffort: 'low',
      }),
    ).toEqual({ thinkingEnabled: false, reasoningEffort: 'low' });
  });

  it('请求未携带时回退会话 metadata（唤醒轮与正常轮前缀一致）', () => {
    expect(
      routeSelection.resolveEffectiveThinkingSelection({
        hasAuthoritativeTeamModel: false,
        sessionThinkingEnabled: true,
        sessionReasoningEffort: 'medium',
      }),
    ).toEqual({ thinkingEnabled: true, reasoningEffort: 'medium' });
  });

  it('全部缺省时返回空对象（不伪造档位）', () => {
    expect(
      routeSelection.resolveEffectiveThinkingSelection({
        hasAuthoritativeTeamModel: false,
      }),
    ).toEqual({});
  });
});
