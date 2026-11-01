/**
 * 会话级 MCP 的连接池 / 目录缓存隔离回归。
 *
 * 只给每个会话一个 ToolRegistry 并不能隔离 MCP 进程状态：底层连接池仍按
 * `${userId}:${poolKey}` 复用。这里锁定「会话身份进 key」这一修复。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import {
  getMcpPoolKey,
  buildSessionMcpKeyMarker,
  type ConfiguredMCPServer,
} from '../../mcp/mcp-runtime.js';
import {
  clearCatalogSnapshotsMatching,
  getCatalogSnapshot,
  setCatalogSnapshot,
} from '../../mcp/mcp-tool-catalog.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let db: typeof DbModule;

// `setCatalogSnapshot` 会经池监听器回读用户配置来过滤 `disabledTools`，
// 因此目录相关断言需要真实 DB（内存 SQLite）。
beforeAll(async () => {
  db = await import('../../infra/db.js');
  await db.connectDb();
  await db.migrate();
});

afterAll(async () => {
  await db.closeDb();
});

const BASE: ConfiguredMCPServer = {
  id: 'local',
  name: 'local',
  transport: 'sse',
  url: 'https://example.com/mcp',
  enabled: true,
};

describe('getMcpPoolKey 会话隔离', () => {
  it('用户级条目沿用既有键（无会话标记）', () => {
    const key = getMcpPoolKey(BASE);
    expect(key).not.toContain('::session::');
  });

  it('同一配置在不同会话下得到不同的池键', () => {
    const a = getMcpPoolKey({ ...BASE, sessionScope: { ownerUserId: 'u-1', sessionId: 's-a' } });
    const b = getMcpPoolKey({ ...BASE, sessionScope: { ownerUserId: 'u-1', sessionId: 's-b' } });
    expect(a).not.toBe(b);
  });

  it('同一会话同一配置的键稳定（可复用连接）', () => {
    const scope = { ownerUserId: 'u-1', sessionId: 's-a' } as const;
    expect(getMcpPoolKey({ ...BASE, sessionScope: scope })).toBe(
      getMcpPoolKey({ ...BASE, sessionScope: scope }),
    );
  });

  it('配置变化换键（旧连接随即失效）', () => {
    const scope = { ownerUserId: 'u-1', sessionId: 's-a' } as const;
    const before = getMcpPoolKey({ ...BASE, sessionScope: scope });
    const after = getMcpPoolKey({
      ...BASE,
      url: 'https://changed.example/mcp',
      sessionScope: scope,
    });
    expect(before).not.toBe(after);
  });

  it('会话身份编码无歧义（含冒号的 id 不会碰撞）', () => {
    const one = getMcpPoolKey({
      ...BASE,
      sessionScope: { ownerUserId: 'u:1', sessionId: 'x' },
    });
    const two = getMcpPoolKey({
      ...BASE,
      sessionScope: { ownerUserId: 'u', sessionId: '1:x' },
    });
    expect(one).not.toBe(two);
  });
});

describe('目录快照按会话清理', () => {
  it('只清理匹配的键，其他会话与用户级快照不受影响', () => {
    const marker = buildSessionMcpKeyMarker({ ownerUserId: 'u-1', sessionId: 's-a' });
    const sessionKey = `${getMcpPoolKey({ ...BASE, sessionScope: { ownerUserId: 'u-1', sessionId: 's-a' } })}`;
    const otherSessionKey = `${getMcpPoolKey({ ...BASE, sessionScope: { ownerUserId: 'u-1', sessionId: 's-b' } })}`;
    const userKey = getMcpPoolKey(BASE);

    setCatalogSnapshot('u-1', sessionKey, 'local', [
      { name: 't1', description: 'd', inputSchema: {} },
    ]);
    setCatalogSnapshot('u-1', otherSessionKey, 'local', [
      { name: 't2', description: 'd', inputSchema: {} },
    ]);
    setCatalogSnapshot('u-1', userKey, 'local', [
      { name: 't3', description: 'd', inputSchema: {} },
    ]);

    const removed = clearCatalogSnapshotsMatching((key) => key.includes(marker));
    expect(removed).toBe(1);

    expect(getCatalogSnapshot('u-1', sessionKey)).toBeNull();
    expect(getCatalogSnapshot('u-1', otherSessionKey)).not.toBeNull();
    expect(getCatalogSnapshot('u-1', userKey)).not.toBeNull();
  });
});
