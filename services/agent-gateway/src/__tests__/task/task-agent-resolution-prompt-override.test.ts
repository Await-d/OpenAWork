/**
 * T-14 回归：内置 Agent 的**用户级提示词覆盖**必须进入委派解析结果。
 *
 * 链路事实（已核查）：
 *   - 新委派：`delegation.ts` 用本次 `resolveDelegatedAgent` 的结果写
 *     `childSessionMetadata.delegatedSystemPrompt`（快照 = 派发当时的提示词）；
 *   - 显式 task resume：`{ ...已存在 metadata, ...childSessionMetadata }` → 快照被**刷新**为最新；
 *   - 团队 handoff：`mergeDelegatedSystemPromptIntoMetadata` **不覆盖**已存在值；
 *   - `routes/stream.ts` 的优先级 `delegatedSystemPrompt > 请求 prompt > Agent prompt` 不变。
 *
 * 本用例锁定其中最容易被上游改动打断的一环：委托解析真的读到了用户覆盖。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as CatalogModule from '../../agent/agent-catalog.js';
import type * as DbModule from '../../infra/db.js';
import type * as TaskAgentResolutionModule from '../../task/task-agent-resolution.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['JWT_SECRET'] = 'task-agent-resolution-override-test-secret';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let dbModule: typeof DbModule;
let catalog: typeof CatalogModule;
let resolver: typeof TaskAgentResolutionModule;

const USER_ID = 'u-delegated-override';
const OVERRIDE_TEXT = '覆盖后的构建提示词（用户级）';

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  catalog = await import('../../agent/agent-catalog.js');
  resolver = await import('../../task/task-agent-resolution.js');
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM user_settings', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    `${USER_ID}@example.com`,
  ]);
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('delegated prompt override', () => {
  it('无覆盖时使用内置默认提示词', () => {
    const resolved = resolver.resolveDelegatedAgent(USER_ID, { subagent_type: 'build' });
    expect(resolved.agentId).toBe('build');
    expect(resolved.systemPrompt ?? '').not.toContain(OVERRIDE_TEXT);
  });

  it('存在用户覆盖时委派解析结果包含覆盖文本', () => {
    catalog.updateManagedAgentForUser(USER_ID, 'build', { systemPrompt: OVERRIDE_TEXT });

    const resolved = resolver.resolveDelegatedAgent(USER_ID, { subagent_type: 'build' });

    expect(resolved.systemPrompt ?? '').toContain(OVERRIDE_TEXT);
  });

  it('清除覆盖（systemPrompt: null）后委派解析回落到默认', () => {
    catalog.updateManagedAgentForUser(USER_ID, 'build', { systemPrompt: OVERRIDE_TEXT });
    catalog.updateManagedAgentForUser(USER_ID, 'build', { systemPrompt: null });

    const resolved = resolver.resolveDelegatedAgent(USER_ID, { subagent_type: 'build' });

    expect(resolved.systemPrompt ?? '').not.toContain(OVERRIDE_TEXT);
  });

  it('只改模型不会把提示词覆盖带进委派结果（覆盖状态独立）', () => {
    catalog.updateManagedAgentForUser(USER_ID, 'build', { model: 'gpt-5' });

    const resolved = resolver.resolveDelegatedAgent(USER_ID, { subagent_type: 'build' });

    expect(resolved.systemPrompt ?? '').not.toContain(OVERRIDE_TEXT);
  });
});
