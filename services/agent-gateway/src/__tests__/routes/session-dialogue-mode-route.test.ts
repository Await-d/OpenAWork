import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyAnswer,
  buildConfirmNode,
  createGrillState,
  parseGrillState,
  serializeGrillState,
} from '@openAwork/agent-core';

// ─── Hoisted mocks ────────────────────────────────────────────────────
// 该路由只依赖会话元数据读写 + 澄清状态结算，这里用 mock 隔离 sqlite 与元数据解析，
// 以便直接断言"恰好一次写入"以及写入内容（模式 + 审计字段 + 确认门控）。
const mocks = vi.hoisted(() => ({
  sqliteGet: vi.fn(),
  sqliteRun: vi.fn(),
  parseSessionMetadataJson: vi.fn(() => ({}) as Record<string, unknown>),
}));

vi.mock('../../infra/db.js', () => ({
  sqliteGet: mocks.sqliteGet,
  sqliteRun: mocks.sqliteRun,
}));

vi.mock('../../session/session-workspace-metadata.js', () => ({
  parseSessionMetadataJson: mocks.parseSessionMetadataJson,
}));

vi.mock('../../infra/auth.js', () => ({
  requireAuth: async (request: { user?: unknown }) => {
    request.user = { sub: 'test-user', email: 'test@openAwork.local' };
  },
}));

vi.mock('../../runtime/request-workflow.js', () => ({
  startRequestWorkflow: () => ({
    step: { succeed: vi.fn(), fail: vi.fn() },
    child: () => ({ succeed: vi.fn(), fail: vi.fn() }),
  }),
}));

import { sessionDialogueModeRoutes } from '../../routes/session-dialogue-mode.js';

const SESSION_ID = 'session-1';

/** 决策节点已全部结算、只剩确认节点的 grill 状态。 */
function buildAwaitingConfirmStateJson(): string {
  const state = createGrillState([
    {
      id: 'goal',
      question: '目标是什么？',
      options: [{ label: '改单文件', description: '范围清晰' }],
      dependsOn: [],
    },
    buildConfirmNode(['goal']),
  ]);
  return serializeGrillState(applyAnswer(state, 'goal', '改单文件'));
}

function buildSessionRow(metadataJson: string) {
  return { metadata_json: metadataJson };
}

async function createApp() {
  const app = Fastify();
  await app.register(sessionDialogueModeRoutes);
  return app;
}

function readSingleMetadataWrite(): Record<string, unknown> {
  expect(mocks.sqliteRun).toHaveBeenCalledTimes(1);
  const [sql, params] = mocks.sqliteRun.mock.calls[0] as [string, unknown[]];
  expect(sql).toContain('UPDATE sessions SET metadata_json');
  expect(params[1]).toBe(SESSION_ID);
  return JSON.parse(params[0] as string) as Record<string, unknown>;
}

describe('POST /sessions/:sessionId/clarify/confirm', () => {
  beforeEach(() => {
    mocks.sqliteGet.mockReset();
    mocks.sqliteRun.mockReset();
    mocks.parseSessionMetadataJson.mockReset().mockReturnValue({});
  });

  it('澄清模式确认 → 一次写入同时切模式、写审计并结算确认门控', async () => {
    const clarificationState = buildAwaitingConfirmStateJson();
    mocks.parseSessionMetadataJson.mockReturnValue({
      clarificationState,
      dialogueMode: 'clarify',
    });
    mocks.sqliteGet.mockReturnValue(buildSessionRow('{}'));

    const app = await createApp();
    const response = await app.inject({
      method: 'POST',
      url: `/sessions/${SESSION_ID}/clarify/confirm`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, switched: true, dialogueMode: 'coding' });

    const metadata = readSingleMetadataWrite();
    expect(metadata.dialogueMode).toBe('coding');
    expect(metadata.dialogueModeSwitch).toMatchObject({
      from: 'clarify',
      reason: 'user_confirmed',
      to: 'coding',
    });

    const settled = parseGrillState(metadata.clarificationState as string);
    expect(settled?.confirmedAt).toBeTypeOf('number');

    await app.close();
  });

  it('已在编程模式时幂等：不写库，回传当前模式', async () => {
    mocks.parseSessionMetadataJson.mockReturnValue({ dialogueMode: 'coding' });
    mocks.sqliteGet.mockReturnValue(buildSessionRow('{}'));

    const app = await createApp();
    const response = await app.inject({
      method: 'POST',
      url: `/sessions/${SESSION_ID}/clarify/confirm`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, switched: false, dialogueMode: 'coding' });
    expect(mocks.sqliteRun).not.toHaveBeenCalled();

    await app.close();
  });

  it('会话不存在（或非本人）返回 404 且不写库', async () => {
    mocks.sqliteGet.mockReturnValue(undefined);

    const app = await createApp();
    const response = await app.inject({
      method: 'POST',
      url: `/sessions/${SESSION_ID}/clarify/confirm`,
    });

    expect(response.statusCode).toBe(404);
    expect(mocks.sqliteRun).not.toHaveBeenCalled();

    await app.close();
  });

  it('无澄清状态时只切模式，不写 clarificationState', async () => {
    mocks.parseSessionMetadataJson.mockReturnValue({ dialogueMode: 'clarify' });
    mocks.sqliteGet.mockReturnValue(buildSessionRow('{}'));

    const app = await createApp();
    const response = await app.inject({
      method: 'POST',
      url: `/sessions/${SESSION_ID}/clarify/confirm`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ switched: true, dialogueMode: 'coding' });

    const metadata = readSingleMetadataWrite();
    expect(metadata.dialogueMode).toBe('coding');
    expect(metadata.clarificationState).toBeUndefined();

    await app.close();
  });

  it('team 澄清链条（clarificationIntent）不切换模式，且不写库', async () => {
    mocks.parseSessionMetadataJson.mockReturnValue({
      clarificationIntent: '把会话数据迁移到 Postgres',
      dialogueMode: 'clarify',
    });
    mocks.sqliteGet.mockReturnValue(buildSessionRow('{}'));

    const app = await createApp();
    const response = await app.inject({
      method: 'POST',
      url: `/sessions/${SESSION_ID}/clarify/confirm`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, switched: false });
    expect(mocks.sqliteRun).not.toHaveBeenCalled();

    await app.close();
  });
});
