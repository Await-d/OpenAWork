/**
 * 会话扩展存储层回归（真实内存 SQLite）。
 *
 * 覆盖方案 §会话资源真相源 与 §MCP 生命周期 中最容易写错的部分：revision CAS、
 * 读路径不发写、摘要稳定性、审批单次消费、过期与幂等。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as StoreModule from '../../session-extension/session-extension-store.js';
import type * as OpStoreModule from '../../session-extension/session-extension-operation-store.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let db: typeof DbModule;
let store: typeof StoreModule;
let opStore: typeof OpStoreModule;

const OWNER = 'u-ext-owner';
const ADMIN = 'u-ext-admin';
const OTHER = 'u-ext-other';
const SESSION_A = 's-ext-a';
const SESSION_B = 's-ext-b';

function seedUser(id: string): void {
  db.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    id,
    `${id}@example.com`,
  ]);
}

function seedSession(id: string, owner: string): void {
  db.sqliteRun(
    `INSERT INTO sessions (id, user_id, title, metadata_json, state_status)
     VALUES (?, ?, 'demo', '{}', 'idle')`,
    [id, owner],
  );
}

beforeAll(async () => {
  db = await import('../../infra/db.js');
  await db.connectDb();
  await db.migrate();
  store = await import('../../session-extension/session-extension-store.js');
  opStore = await import('../../session-extension/session-extension-operation-store.js');
});

afterAll(async () => {
  await db.closeDb();
});

beforeEach(() => {
  db.sqliteRun('DELETE FROM session_extension_operations', []);
  db.sqliteRun('DELETE FROM session_skill_installations', []);
  db.sqliteRun('DELETE FROM session_mcp_servers', []);
  db.sqliteRun('DELETE FROM session_extension_settings', []);
  db.sqliteRun('DELETE FROM session_extension_admins', []);
  db.sqliteRun('DELETE FROM sessions', []);
  db.sqliteRun('DELETE FROM users', []);

  seedUser(OWNER);
  seedUser(ADMIN);
  seedUser(OTHER);
  seedSession(SESSION_A, OWNER);
  seedSession(SESSION_B, OWNER);
});

describe('继承策略默认值', () => {
  /** 渠道会话的 metadata 形状与 `buildChannelSessionMetadata` 一致。 */
  function seedChannelSession(id: string, managementEnabled: boolean): void {
    db.sqliteRun(
      `INSERT INTO sessions (id, user_id, title, metadata_json, state_status)
       VALUES (?, ?, 'demo', ?, 'idle')`,
      [
        id,
        OWNER,
        JSON.stringify({
          source: 'channel',
          channelExtensionManagementEnabled: managementEnabled,
          channel: { id: 'plugin-1', type: 'telegram' },
        }),
      ],
    );
  }

  it('渠道开启扩展管理后默认收敛为 explicit，不再全量继承用户级配置', () => {
    seedChannelSession('s-ext-ch-on', true);
    expect(store.resolveSessionExtensionInheritance('s-ext-ch-on')).toBe('explicit');
    // 建行必须用同一口径：否则首次提案建出的行会把刚生效的隔离反过来关掉。
    expect(store.ensureSessionExtensionSettings('s-ext-ch-on', OWNER).inheritance).toBe('explicit');
    expect(store.getSessionExtensionSettings('s-ext-ch-on')?.inheritance).toBe('explicit');
  });

  it('写入路径建行时也用来源感知默认值，不会把隔离反过来关掉', () => {
    // `ensureSessionExtensionSettings` 与写入路径的 `bumpRevisionInTransaction` 都能
    // 建行（都是 `INSERT ... ON CONFLICT DO NOTHING`，先到者决定）。曾经后者写死
    // `inherit`：渠道会话只要先发生一次写入，刚生效的 `explicit` 隔离就会被静默关掉。
    seedChannelSession('s-ext-ch-write', true);
    store.upsertSessionSkill({
      sessionId: 's-ext-ch-write',
      ownerUserId: OWNER,
      resourceRef: 'skill:session:via-write',
      skillId: 'via-write',
      sourceId: 'registry',
      version: '1.0.0',
      manifest: {},
      contentDigest: 'd1',
      expectedRevision: 0,
    });

    expect(store.getSessionExtensionSettings('s-ext-ch-write')?.inheritance).toBe('explicit');
    expect(store.resolveSessionExtensionInheritance('s-ext-ch-write')).toBe('explicit');
  });

  it('渠道未开启管理、以及个人会话，都保持历史 inherit 语义', () => {
    seedChannelSession('s-ext-ch-off', false);
    expect(store.resolveSessionExtensionInheritance('s-ext-ch-off')).toBe('inherit');
    // 个人会话不受影响：改成 explicit 会静默丢掉它们已有的用户级技能 / MCP。
    expect(store.resolveSessionExtensionInheritance(SESSION_A)).toBe('inherit');
  });

  it('用户显式写过的设置行永远优先于来源默认值', () => {
    seedChannelSession('s-ext-ch-manual', true);
    store.ensureSessionExtensionSettings('s-ext-ch-manual', OWNER);
    const rewritten = store.setSessionExtensionInheritance({
      sessionId: 's-ext-ch-manual',
      ownerUserId: OWNER,
      inheritance: 'inherit',
      expectedRevision: 1,
    });
    expect(rewritten?.inheritance).toBe('inherit');
    expect(store.resolveSessionExtensionInheritance('s-ext-ch-manual')).toBe('inherit');
  });
});

describe('会话扩展设置', () => {
  it('未配置时按历史 inherit 语义回退，且读路径不建行', () => {
    expect(store.getSessionExtensionSettings(SESSION_A)).toBeUndefined();
    expect(store.resolveSessionExtensionInheritance(SESSION_A)).toBe('inherit');
    expect(store.readSessionExtensionRevision(SESSION_A)).toBe(0);
    // 读路径不得顺手 INSERT：否则再也分不清「显式 inherit」与「历史缺省」。
    expect(store.getSessionExtensionSettings(SESSION_A)).toBeUndefined();
  });

  it('ensure 建行后继承模式为默认值，revision 从 1 开始', () => {
    const settings = store.ensureSessionExtensionSettings(SESSION_A, OWNER);
    expect(settings.inheritance).toBe('inherit');
    expect(settings.revision).toBe(1);
    expect(settings.explicitRow).toBe(true);

    // 重复 ensure 不新增行也不改 revision。
    const again = store.ensureSessionExtensionSettings(SESSION_A, OWNER);
    expect(again.revision).toBe(1);
  });

  it('设置继承模式必须携带匹配的 expectedRevision', () => {
    store.ensureSessionExtensionSettings(SESSION_A, OWNER);
    expect(
      store.setSessionExtensionInheritance({
        sessionId: SESSION_A,
        ownerUserId: OWNER,
        inheritance: 'explicit',
        expectedRevision: 99,
      }),
    ).toBeUndefined();

    const updated = store.setSessionExtensionInheritance({
      sessionId: SESSION_A,
      ownerUserId: OWNER,
      inheritance: 'explicit',
      expectedRevision: 1,
    });
    expect(updated?.inheritance).toBe('explicit');
    expect(updated?.revision).toBe(2);
  });

  it('会话之间的扩展互不影响', () => {
    store.upsertSessionSkill({
      sessionId: SESSION_A,
      ownerUserId: OWNER,
      resourceRef: 'skill:session:a',
      skillId: 'a',
      sourceId: 'builtin',
      version: '1.0.0',
      manifest: { id: 'a' },
      contentDigest: 'digest-a',
      expectedRevision: 0,
    });
    expect(store.listSessionSkills(SESSION_A)).toHaveLength(1);
    expect(store.listSessionSkills(SESSION_B)).toHaveLength(0);
    expect(store.readSessionExtensionRevision(SESSION_B)).toBe(0);
  });
});

describe('会话技能', () => {
  it('安装/覆盖按 revision CAS，冲突时不落条目', () => {
    const installed = store.upsertSessionSkill({
      sessionId: SESSION_A,
      ownerUserId: OWNER,
      resourceRef: 'skill:session:a',
      skillId: 'a',
      sourceId: 'builtin',
      version: '1.0.0',
      manifest: { id: 'a', version: '1.0.0' },
      contentDigest: 'd1',
      expectedRevision: 0,
    });
    expect(installed?.revision).toBe(1);

    const conflicted = store.upsertSessionSkill({
      sessionId: SESSION_A,
      ownerUserId: OWNER,
      resourceRef: 'skill:session:b',
      skillId: 'b',
      sourceId: 'builtin',
      version: '1.0.0',
      manifest: { id: 'b' },
      contentDigest: 'd2',
      expectedRevision: 0,
    });
    expect(conflicted).toBeUndefined();
    expect(store.listSessionSkills(SESSION_A).map((s) => s.skillId)).toEqual(['a']);
  });

  it('启停与固定通过 flags 更新，未知条目返回 undefined', () => {
    store.upsertSessionSkill({
      sessionId: SESSION_A,
      ownerUserId: OWNER,
      resourceRef: 'skill:session:a',
      skillId: 'a',
      sourceId: 'builtin',
      version: null,
      manifest: {},
      contentDigest: 'd1',
      expectedRevision: 0,
    });

    expect(
      store.setSessionSkillFlags({
        sessionId: SESSION_A,
        ownerUserId: OWNER,
        resourceRef: 'skill:session:missing',
        enabled: false,
        expectedRevision: 1,
      }),
    ).toBeUndefined();

    const disabled = store.setSessionSkillFlags({
      sessionId: SESSION_A,
      ownerUserId: OWNER,
      resourceRef: 'skill:session:a',
      enabled: false,
      pinned: true,
      expectedRevision: 1,
    });
    expect(disabled?.revision).toBe(2);

    const skill = store.getSessionSkill(SESSION_A, 'skill:session:a');
    expect(skill?.enabled).toBe(false);
    expect(skill?.pinned).toBe(true);
  });

  it('卸载后 revision 前进且条目消失', () => {
    store.upsertSessionSkill({
      sessionId: SESSION_A,
      ownerUserId: OWNER,
      resourceRef: 'skill:session:a',
      skillId: 'a',
      sourceId: 'builtin',
      version: null,
      manifest: {},
      contentDigest: 'd1',
      expectedRevision: 0,
    });
    const removed = store.removeSessionSkill({
      sessionId: SESSION_A,
      ownerUserId: OWNER,
      resourceRef: 'skill:session:a',
      expectedRevision: 1,
    });
    expect(removed?.revision).toBe(2);
    expect(store.listSessionSkills(SESSION_A)).toHaveLength(0);
  });
});

describe('会话 MCP', () => {
  it('配置落库并可启停，危险字段只在 secretRef 中引用', () => {
    const added = store.upsertSessionMcpServer({
      sessionId: SESSION_A,
      ownerUserId: OWNER,
      resourceRef: 'mcp:session:local',
      displayId: 'local',
      config: { name: 'local', transport: 'sse', url: 'https://example.com/mcp' },
      secretRef: 'secret:session:local',
      expectedRevision: 0,
    });
    expect(added?.revision).toBe(1);

    const disabled = store.setSessionMcpEnabled({
      sessionId: SESSION_A,
      ownerUserId: OWNER,
      resourceRef: 'mcp:session:local',
      enabled: false,
      expectedRevision: 1,
    });
    expect(disabled?.revision).toBe(2);

    const record = store.getSessionMcpServer(SESSION_A, 'mcp:session:local');
    expect(record?.enabled).toBe(false);
    expect(record?.secretRef).toBe('secret:session:local');
  });

  it('disabledTools 以字符串数组持久化，脏数据容错为空数组', () => {
    store.upsertSessionMcpServer({
      sessionId: SESSION_A,
      ownerUserId: OWNER,
      resourceRef: 'mcp:session:x',
      displayId: 'x',
      config: { name: 'x' },
      disabledTools: ['dangerous', 42 as unknown as string],
      expectedRevision: 0,
    });
    expect(store.getSessionMcpServer(SESSION_A, 'mcp:session:x')?.disabledTools).toEqual([
      'dangerous',
    ]);
  });
});

describe('摘要稳定性', () => {
  it('键顺序不同但内容相同视为同一摘要', () => {
    const a = store.computeSessionExtensionDigest({ name: 'x', transport: 'sse', args: [1, 2] });
    const b = store.computeSessionExtensionDigest({ transport: 'sse', args: [1, 2], name: 'x' });
    expect(a).toBe(b);
  });

  it('内容变化必须换摘要（审批 A 不能执行 B）', () => {
    const before = store.computeSessionExtensionDigest({ url: 'https://a.example/mcp' });
    const after = store.computeSessionExtensionDigest({ url: 'https://b.example/mcp' });
    expect(before).not.toBe(after);
  });
});

describe('审批人清单', () => {
  it('owner 隐式满足；其他用户需显式加入', () => {
    expect(store.isSessionExtensionApprover(OWNER, OWNER)).toBe(true);
    expect(store.isSessionExtensionApprover(OWNER, ADMIN)).toBe(false);
    expect(store.isSessionExtensionApprover(OWNER, OTHER)).toBe(false);

    store.addSessionExtensionAdmin(OWNER, ADMIN);
    expect(store.isSessionExtensionApprover(OWNER, ADMIN)).toBe(true);
    expect(store.listSessionExtensionAdmins(OWNER)).toEqual([ADMIN]);

    expect(store.removeSessionExtensionAdmin(OWNER, ADMIN)).toBe(true);
    expect(store.isSessionExtensionApprover(OWNER, ADMIN)).toBe(false);
  });
});

describe('操作提案状态机', () => {
  function createOp(
    overrides: Partial<Parameters<typeof opStore.createSessionExtensionOperation>[0]> = {},
  ) {
    return opStore.createSessionExtensionOperation({
      sessionId: SESSION_A,
      ownerUserId: OWNER,
      kind: 'mcp',
      action: 'add',
      resourceRef: 'mcp:session:local',
      payload: { displayId: 'local' },
      configDigest: 'digest-1',
      expectedRevision: 0,
      channelId: 'ch-1',
      chatId: 'chat-1',
      requesterActorId: 'actor-1',
      ...overrides,
    });
  }

  it('创建后处于待审批，且携带原请求者身份', () => {
    const op = createOp();
    expect(op.status).toBe('pending_approval');
    expect(op.channelId).toBe('ch-1');
    expect(op.requesterActorId).toBe('actor-1');
    expect(op.nonce.length).toBeGreaterThan(0);
  });

  it('审批单次消费：第二次审批不会再放行', () => {
    const op = createOp();
    const first = opStore.approveSessionExtensionOperation({
      sessionId: SESSION_A,
      operationId: op.id,
      nonce: op.nonce,
      approverUserId: ADMIN,
    });
    expect(first.kind).toBe('approved');

    const second = opStore.approveSessionExtensionOperation({
      sessionId: SESSION_A,
      operationId: op.id,
      nonce: op.nonce,
      approverUserId: ADMIN,
    });
    expect(second.kind).toBe('not_pending');
  });

  it('错误或其他操作的 nonce 不能批准或拒绝提案', () => {
    const op = createOp();
    const other = createOp({ idempotencyKey: 'different-nonce' });
    for (const nonce of ['invalid', other.nonce]) {
      const params = { sessionId: SESSION_A, operationId: op.id, approverUserId: ADMIN, nonce };
      expect(opStore.approveSessionExtensionOperation(params).kind).toBe('invalid_nonce');
      expect(opStore.rejectSessionExtensionOperation(params)).toBeUndefined();
      expect(opStore.getSessionExtensionOperation(SESSION_A, op.id)?.status).toBe(
        'pending_approval',
      );
    }
  });

  it('过期提案不能通过拒绝动作消费 nonce', () => {
    const op = createOp({ ttlMs: 1, now: Date.now() - 10_000 });
    expect(
      opStore.rejectSessionExtensionOperation({
        sessionId: SESSION_A,
        operationId: op.id,
        approverUserId: ADMIN,
        nonce: op.nonce,
      }),
    ).toBeUndefined();
  });

  it('同幂等键复用未终结提案，避免渠道重发产生两条', () => {
    const first = createOp({ idempotencyKey: 'idem-1' });
    const second = createOp({ idempotencyKey: 'idem-1' });
    expect(second.id).toBe(first.id);
  });

  it('过期提案被标记为 expired 并拒绝审批', () => {
    const op = createOp({ ttlMs: 1, now: Date.now() - 10_000 });
    const result = opStore.approveSessionExtensionOperation({
      sessionId: SESSION_A,
      operationId: op.id,
      nonce: op.nonce,
      approverUserId: ADMIN,
    });
    expect(result.kind).toBe('expired');
    expect(opStore.getSessionExtensionOperation(SESSION_A, op.id)?.status).toBe('expired');
  });

  it('拒绝与取消是终态，不参与普通授权级联', () => {
    const rejectOp = createOp();
    const rejected = opStore.rejectSessionExtensionOperation({
      sessionId: SESSION_A,
      operationId: rejectOp.id,
      nonce: rejectOp.nonce,
      approverUserId: ADMIN,
      reason: '来源不可信',
    });
    expect(rejected?.status).toBe('rejected');

    // 同会话另一条提案不受影响：拒绝不级联。
    const sibling = createOp({ idempotencyKey: 'idem-2' });
    expect(opStore.getSessionExtensionOperation(SESSION_A, sibling.id)?.status).toBe(
      'pending_approval',
    );

    const cancelled = opStore.cancelSessionExtensionOperation({
      sessionId: SESSION_A,
      operationId: sibling.id,
    });
    expect(cancelled?.status).toBe('cancelled');
  });

  it('approved → applying → succeeded 有效；未 approved 不能直接结算', () => {
    const op = createOp();
    expect(
      opStore.markSessionExtensionOperationApplying({
        sessionId: SESSION_A,
        operationId: op.id,
      }),
    ).toBeUndefined();

    opStore.approveSessionExtensionOperation({
      sessionId: SESSION_A,
      operationId: op.id,
      nonce: op.nonce,
      approverUserId: ADMIN,
    });
    expect(
      opStore.markSessionExtensionOperationApplying({
        sessionId: SESSION_A,
        operationId: op.id,
      })?.status,
    ).toBe('applying');

    const settled = opStore.settleSessionExtensionOperation({
      sessionId: SESSION_A,
      operationId: op.id,
      status: 'configured_unavailable',
      result: { ok: false },
      errorCode: 'probe_failed',
    });
    expect(settled?.status).toBe('configured_unavailable');

    // 终态不可再次结算。
    expect(
      opStore.settleSessionExtensionOperation({
        sessionId: SESSION_A,
        operationId: op.id,
        status: 'succeeded',
      }),
    ).toBeUndefined();
  });

  it('重启恢复把卡在 applying 的提案改判失败，不自动重放', () => {
    const op = createOp();
    opStore.approveSessionExtensionOperation({
      sessionId: SESSION_A,
      operationId: op.id,
      nonce: op.nonce,
      approverUserId: ADMIN,
    });
    opStore.markSessionExtensionOperationApplying({ sessionId: SESSION_A, operationId: op.id });

    expect(opStore.failInterruptedSessionExtensionOperations()).toBeGreaterThanOrEqual(1);
    const recovered = opStore.getSessionExtensionOperation(SESSION_A, op.id);
    expect(recovered?.status).toBe('failed');
    expect(recovered?.errorCode).toBe('gateway_restart');
  });

  it('批量过期只收敛待审批提案', () => {
    const stale = createOp({ ttlMs: 1, now: Date.now() - 10_000 });
    const fresh = createOp({ ttlMs: 10 * 60 * 1000 });
    opStore.expireStaleSessionExtensionOperations();
    expect(opStore.getSessionExtensionOperation(SESSION_A, stale.id)?.status).toBe('expired');
    expect(opStore.getSessionExtensionOperation(SESSION_A, fresh.id)?.status).toBe(
      'pending_approval',
    );
  });
});

describe('清理', () => {
  it('会话删除级联清空扩展与操作记录', () => {
    store.upsertSessionSkill({
      sessionId: SESSION_A,
      ownerUserId: OWNER,
      resourceRef: 'skill:session:a',
      skillId: 'a',
      sourceId: 'builtin',
      version: null,
      manifest: {},
      contentDigest: 'd1',
      expectedRevision: 0,
    });
    opStore.createSessionExtensionOperation({
      sessionId: SESSION_A,
      ownerUserId: OWNER,
      kind: 'skill',
      action: 'install',
      resourceRef: 'skill:session:a',
      payload: {},
      configDigest: 'd1',
      expectedRevision: 1,
    });

    db.sqliteRun('DELETE FROM sessions WHERE id = ?', [SESSION_A]);

    expect(store.listSessionSkills(SESSION_A)).toHaveLength(0);
    expect(store.getSessionExtensionSettings(SESSION_A)).toBeUndefined();
    expect(opStore.listSessionExtensionOperations({ sessionId: SESSION_A })).toHaveLength(0);
  });
});
