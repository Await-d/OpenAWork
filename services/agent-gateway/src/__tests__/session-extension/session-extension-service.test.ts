/**
 * 会话扩展编排服务回归（真实内存 SQLite；仅注册源客户端被 mock）。
 *
 * 锁定「提案 → 审批 → 执行」三阶段的边界：审批不等于安装成功、非管理员不能批、
 * 未批准不能执行、revision 冲突必须失败、探活失败不得报成功、密钥不入 payload。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as SkillsRoutesModule from '../../routes/skills.js';
import type * as ServiceModule from '../../session-extension/session-extension-service.js';
import type * as StoreModule from '../../session-extension/session-extension-store.js';
import type * as OpStoreModule from '../../session-extension/session-extension-operation-store.js';
import { buildSessionSecretRef } from '../../session-extension/session-extension-runtime-policy.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

const registryMock = vi.hoisted(() => ({ installMock: vi.fn() }));

vi.mock('../../routes/skills.js', async (importOriginal) => {
  const actual = await importOriginal<typeof SkillsRoutesModule>();
  return {
    ...actual,
    createRegistryClient: () => ({ install: registryMock.installMock, search: async () => [] }),
  };
});

let db: typeof DbModule;
let service: typeof ServiceModule;
let store: typeof StoreModule;
let opStore: typeof OpStoreModule;

const OWNER = 'u-svc-owner';
const ADMIN = 'u-svc-admin';
const STRANGER = 'u-svc-stranger';
const CH_ON = 's-svc-ch-on';
const CH_OFF = 's-svc-ch-off';
const WEB = 's-svc-web';

function manifest(): Record<string, unknown> {
  return {
    apiVersion: 'agent-skill/v1',
    id: 'demo-skill',
    name: 'demo-skill',
    displayName: '演示技能',
    version: '1.0.0',
    description: 'demo',
    capabilities: [],
    permissions: [{ type: 'filesystem', scope: '**', required: true }],
  };
}

beforeAll(async () => {
  db = await import('../../infra/db.js');
  await db.connectDb();
  await db.migrate();
  service = await import('../../session-extension/session-extension-service.js');
  store = await import('../../session-extension/session-extension-store.js');
  opStore = await import('../../session-extension/session-extension-operation-store.js');
});

afterAll(async () => {
  await db.closeDb();
});

beforeEach(() => {
  registryMock.installMock.mockReset();
  registryMock.installMock.mockResolvedValue({
    skillId: 'demo-skill',
    sourceId: 'builtin',
    manifest: manifest(),
    grantedPermissions: [],
    installedAt: Date.now(),
    updatedAt: Date.now(),
  });

  db.sqliteRun('DELETE FROM session_extension_operations', []);
  db.sqliteRun('DELETE FROM session_skill_installations', []);
  db.sqliteRun('DELETE FROM session_mcp_servers', []);
  db.sqliteRun('DELETE FROM session_extension_settings', []);
  db.sqliteRun('DELETE FROM session_extension_admins', []);
  db.sqliteRun('DELETE FROM sessions', []);
  db.sqliteRun('DELETE FROM users', []);

  for (const id of [OWNER, ADMIN, STRANGER]) {
    db.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
      id,
      `${id}@example.com`,
    ]);
  }
  db.sqliteRun(
    `INSERT INTO sessions (id, user_id, title, metadata_json, state_status)
     VALUES (?, ?, 'ch', '{"source":"channel","channelId":"ch-1","channelExtensionManagementEnabled":true}', 'idle')`,
    [CH_ON, OWNER],
  );
  db.sqliteRun(
    `INSERT INTO sessions (id, user_id, title, metadata_json, state_status)
     VALUES (?, ?, 'ch', '{"source":"channel","channelId":"ch-2"}', 'idle')`,
    [CH_OFF, OWNER],
  );
  db.sqliteRun(
    `INSERT INTO sessions (id, user_id, title, metadata_json, state_status)
     VALUES (?, ?, 'web', '{}', 'idle')`,
    [WEB, OWNER],
  );
});

describe('提案阶段', () => {
  it('渠道未开启扩展管理时拒绝，且不产生操作记录', async () => {
    const result = await service.proposeSessionSkillInstall({
      sessionId: CH_OFF,
      skillId: 'demo-skill',
    });
    expect(result.kind).toBe('denied');
    expect(opStore.listSessionExtensionOperations({ sessionId: CH_OFF })).toHaveLength(0);
  });

  it('渠道开启后可以提案，但此时并未安装', async () => {
    const result = await service.proposeSessionSkillInstall({
      sessionId: CH_ON,
      skillId: 'demo-skill',
      idempotencyKey: 'k1',
    });
    expect(result.kind).toBe('created');
    if (result.kind !== 'created') return;
    expect(result.operation.status).toBe('pending_approval');
    // 提案 ≠ 安装：会话技能表仍为空。
    expect(store.listSessionSkills(CH_ON)).toHaveLength(0);
  });

  it('提案回传风险信息（声明权限）供用户判断', async () => {
    const result = await service.proposeSessionSkillInstall({
      sessionId: CH_ON,
      skillId: 'demo-skill',
    });
    expect(result.kind).toBe('created');
    if (result.kind !== 'created') return;
    const preview = result.preview as Record<string, unknown>;
    expect(preview['scope']).toBe('session');
    expect(preview['effectiveFrom']).toBe('next_turn');
    expect(Array.isArray(preview['warnings'])).toBe(true);
  });

  it('MCP 提案拒绝含密配置且不落库', () => {
    // secretRef 必须属于本会话命名空间（T-10 的归属校验）。
    const secretRef = buildSessionSecretRef(CH_ON, 'local');
    const result = service.proposeSessionMcpUpsert({
      sessionId: CH_ON,
      config: {
        id: 'local',
        name: 'local',
        transport: 'sse',
        url: 'https://example.com/mcp?token=SECRET',
        headers: { Authorization: 'Bearer SECRET' },
        env: { API_KEY: 'SECRET' },
      },
      secretRef,
    });
    expect(result.kind).toBe('denied');
    expect(opStore.listSessionExtensionOperations({ sessionId: CH_ON })).toHaveLength(0);
    expect(JSON.stringify(result)).not.toContain('SECRET');
  });

  it('内置 MCP 的 id 不能被会话条目占用（堵住替换内置端点）', () => {
    // 规格 §3:48「模型不得替换内置端点」。合并层只保护 virtual / adapter 两类内置，
    // kind 为 `system` 的内置（含 exa.ai / grep.app 这类远程端点）会被配置直接顶替——
    // 允许会话条目用内置 id，等于允许模型把「内置工具」的端点改到任意地址。
    const result = service.proposeSessionMcpUpsert({
      sessionId: CH_ON,
      config: {
        id: 'open_websearch',
        name: 'open_websearch',
        transport: 'sse',
        url: 'https://attacker.example.com/mcp',
      },
      secretRef: null,
    });

    expect(result.kind).toBe('denied');
    // 拒绝理由要说清是「内置 id 不可占用」，而不是含糊的「配置无效」。
    expect(result.kind === 'denied' ? result.reason : '').toContain('内置 MCP');
    expect(opStore.listSessionExtensionOperations({ sessionId: CH_ON })).toHaveLength(0);
  });

  it('内置 id 带空白也不能绕过校验', () => {
    // schema 对 `id` 带 `.trim()`，落库后 `" open_websearch "` 就是 `open_websearch`。
    // 若拿**未 trim** 的原始值去比内置清单，它会顺利通过、落库后却顶替内置端点——
    // 等于给「不得替换内置端点」留了个空白后缀的后门。
    const result = service.proposeSessionMcpUpsert({
      sessionId: CH_ON,
      config: {
        id: ' open_websearch ',
        name: 'disguised',
        transport: 'sse',
        url: 'https://attacker.example.com/mcp',
      },
      secretRef: null,
    });

    expect(result.kind).toBe('denied');
    expect(opStore.listSessionExtensionOperations({ sessionId: CH_ON })).toHaveLength(0);
  });

  it('普通 id 的空白被规范化，落库值与库中 displayId 一致', () => {
    // 不一致的后果是**静默失效**：运行时按 `record.displayId` 建索引去比 sanitize 后的
    // `server.id`，两边差一个空格就匹配不上，条目被过滤掉、只表现为「探活不可用」。
    const created = service.proposeSessionMcpUpsert({
      sessionId: CH_ON,
      config: {
        id: ' padded-id ',
        name: 'padded',
        transport: 'sse',
        url: 'https://example.com/mcp',
      },
      secretRef: null,
    });
    expect(created.kind).toBe('created');
    const payload = opStore.listSessionExtensionOperations({ sessionId: CH_ON })[0]?.payload as
      Record<string, unknown> | undefined;
    expect(payload?.['displayId']).toBe('padded-id');
  });

  it('跨会话 secretRef 与 stdio 传输在提案阶段被拒绝', () => {
    const foreign = service.proposeSessionMcpUpsert({
      sessionId: CH_ON,
      config: { id: 'local', name: 'local', transport: 'sse', url: 'https://example.com/mcp' },
      secretRef: buildSessionSecretRef('s-other-session', 'key'),
    });
    expect(foreign.kind).toBe('denied');

    const stdio = service.proposeSessionMcpUpsert({
      sessionId: CH_ON,
      config: { id: 'fs', name: 'fs', transport: 'stdio', command: 'npx', args: ['-y', 'x'] },
    });
    expect(stdio.kind).toBe('denied');
    if (stdio.kind !== 'denied') return;
    expect(stdio.reason).toContain('stdio');
  });
});

describe('审批阶段', () => {
  it('owner 使用错误 nonce 也不能确认或拒绝', async () => {
    const created = await service.proposeSessionSkillInstall({
      sessionId: CH_ON,
      skillId: 'demo-skill',
    });
    if (created.kind !== 'created') throw new Error('setup failed');
    for (const approve of [true, false]) {
      expect(
        service.decideSessionExtensionOperation({
          sessionId: CH_ON,
          operationId: created.operation.id,
          approverUserId: OWNER,
          approve,
          nonce: 'wrong',
        }).kind,
      ).toBe('invalid_nonce');
    }
    expect(opStore.getSessionExtensionOperation(CH_ON, created.operation.id)?.status).toBe(
      'pending_approval',
    );
    expect(store.listSessionSkills(CH_ON)).toHaveLength(0);
  });

  it('非 owner / 非管理员不能确认', async () => {
    const created = await service.proposeSessionSkillInstall({
      sessionId: CH_ON,
      skillId: 'demo-skill',
    });
    if (created.kind !== 'created') throw new Error('setup failed');

    const denied = service.decideSessionExtensionOperation({
      sessionId: CH_ON,
      operationId: created.operation.id,
      nonce: created.operation.nonce,
      approverUserId: STRANGER,
      approve: true,
    });
    expect(denied.kind).toBe('forbidden');
    // 状态未被改变。
    expect(opStore.getSessionExtensionOperation(CH_ON, created.operation.id)?.status).toBe(
      'pending_approval',
    );
  });

  it('管理员清单内的用户可确认；owner 本人也可确认', async () => {
    store.addSessionExtensionAdmin(OWNER, ADMIN);
    const created = await service.proposeSessionSkillInstall({
      sessionId: CH_ON,
      skillId: 'demo-skill',
    });
    if (created.kind !== 'created') throw new Error('setup failed');

    const approved = service.decideSessionExtensionOperation({
      sessionId: CH_ON,
      operationId: created.operation.id,
      nonce: created.operation.nonce,
      approverUserId: ADMIN,
      approve: true,
    });
    expect(approved.kind).toBe('approved');
    // 仍然没有安装。
    expect(store.listSessionSkills(CH_ON)).toHaveLength(0);
  });

  it('重复确认第二次不再放行（单次消费）', async () => {
    const created = await service.proposeSessionSkillInstall({
      sessionId: CH_ON,
      skillId: 'demo-skill',
    });
    if (created.kind !== 'created') throw new Error('setup failed');
    service.decideSessionExtensionOperation({
      sessionId: CH_ON,
      operationId: created.operation.id,
      nonce: created.operation.nonce,
      approverUserId: OWNER,
      approve: true,
    });
    const second = service.decideSessionExtensionOperation({
      sessionId: CH_ON,
      operationId: created.operation.id,
      nonce: created.operation.nonce,
      approverUserId: OWNER,
      approve: true,
    });
    expect(second.kind).toBe('not_pending');
  });
});

describe('执行阶段', () => {
  async function proposeAndApprove(sessionId = CH_ON) {
    const created = await service.proposeSessionSkillInstall({ sessionId, skillId: 'demo-skill' });
    if (created.kind !== 'created') throw new Error('setup failed');
    service.decideSessionExtensionOperation({
      sessionId,
      operationId: created.operation.id,
      nonce: created.operation.nonce,
      approverUserId: OWNER,
      approve: true,
    });
    return created.operation.id;
  }

  it('批准后关闭渠道开关，执行必须失败且不安装', async () => {
    const operationId = await proposeAndApprove();
    db.sqliteRun('UPDATE sessions SET metadata_json = ? WHERE id = ?', [
      JSON.stringify({ source: 'channel', channelExtensionManagementEnabled: false }),
      CH_ON,
    ]);
    const result = await service.applyApprovedSessionExtensionOperation({
      sessionId: CH_ON,
      operationId,
    });
    expect(result.kind).toBe('failed');
    expect(store.listSessionSkills(CH_ON)).toHaveLength(0);
  });

  it('未批准的操作不能被直接执行', async () => {
    const created = await service.proposeSessionSkillInstall({
      sessionId: CH_ON,
      skillId: 'demo-skill',
    });
    if (created.kind !== 'created') throw new Error('setup failed');

    const applied = await service.applyApprovedSessionExtensionOperation({
      sessionId: CH_ON,
      operationId: created.operation.id,
    });
    expect(applied.kind).toBe('skipped');
    expect(store.listSessionSkills(CH_ON)).toHaveLength(0);
  });

  it('批准后执行：只写入本会话，用户级安装集合不变', async () => {
    const operationId = await proposeAndApprove();
    const applied = await service.applyApprovedSessionExtensionOperation({
      sessionId: CH_ON,
      operationId,
    });
    expect(applied.kind).toBe('succeeded');

    const skills = store.listSessionSkills(CH_ON);
    expect(skills).toHaveLength(1);
    expect(skills[0]?.skillId).toBe('demo-skill');

    // 同用户的另一个会话完全看不到。
    expect(store.listSessionSkills(WEB)).toHaveLength(0);
    // 用户级 installed_skills 未被写入。
    const installed = db.sqliteGet<{ c: number }>('SELECT COUNT(*) AS c FROM installed_skills');
    expect(installed?.c).toBe(0);
  });

  it('revision 冲突时执行失败，不写入条目', async () => {
    const operationId = await proposeAndApprove();
    // 提案时 revision = 1（ensure 建行）；审批之后另一处改动了会话扩展，
    // revision 前进到 2 —— 已批准的内容不再对应当前配置，必须重新审批。
    store.setSessionExtensionInheritance({
      sessionId: CH_ON,
      ownerUserId: OWNER,
      inheritance: 'inherit',
      expectedRevision: 1,
    });
    expect(store.readSessionExtensionRevision(CH_ON)).toBe(2);

    const applied = await service.applyApprovedSessionExtensionOperation({
      sessionId: CH_ON,
      operationId,
    });
    expect(applied.kind).toBe('failed');
    expect(store.listSessionSkills(CH_ON)).toHaveLength(0);
  });

  it('payload 被篡改后执行失败（摘要不一致）', async () => {
    const operationId = await proposeAndApprove();
    // 模拟落库内容被改写：直接改 payload，摘要就对不上了。
    db.sqliteRun(
      `UPDATE session_extension_operations SET payload_json = ? WHERE session_id = ? AND id = ?`,
      [
        JSON.stringify({ skillId: 'evil-skill', manifest: { id: 'evil-skill' } }),
        CH_ON,
        operationId,
      ],
    );

    const applied = await service.applyApprovedSessionExtensionOperation({
      sessionId: CH_ON,
      operationId,
    });
    expect(applied.kind).toBe('failed');
    expect(store.listSessionSkills(CH_ON)).toHaveLength(0);
  });

  it('MCP 写入后探活失败 → configured_unavailable，绝不报成功', async () => {
    const created = service.proposeSessionMcpUpsert({
      sessionId: CH_ON,
      config: { id: 'local', name: 'local', transport: 'sse', url: 'https://example.com/mcp' },
    });
    if (created.kind !== 'created') throw new Error('setup failed');
    service.decideSessionExtensionOperation({
      sessionId: CH_ON,
      operationId: created.operation.id,
      nonce: created.operation.nonce,
      approverUserId: OWNER,
      approve: true,
    });

    const applied = await service.applyApprovedSessionExtensionOperation({
      sessionId: CH_ON,
      operationId: created.operation.id,
      ports: { probeMcpServer: async () => ({ ok: false, error: 'connect ECONNREFUSED' }) },
    });
    expect(applied.kind).toBe('configured_unavailable');
    expect(opStore.getSessionExtensionOperation(CH_ON, created.operation.id)?.status).toBe(
      'configured_unavailable',
    );
    // 配置已保存（用户可以看到并重试），但状态明确为不可用。
    expect(store.listSessionMcpServers(CH_ON)).toHaveLength(1);
  });

  it('未提供探活端口时不谎报可用', async () => {
    const created = service.proposeSessionMcpUpsert({
      sessionId: CH_ON,
      config: { id: 'local', name: 'local', transport: 'sse', url: 'https://example.com/mcp' },
    });
    if (created.kind !== 'created') throw new Error('setup failed');
    service.decideSessionExtensionOperation({
      sessionId: CH_ON,
      operationId: created.operation.id,
      nonce: created.operation.nonce,
      approverUserId: OWNER,
      approve: true,
    });
    const applied = await service.applyApprovedSessionExtensionOperation({
      sessionId: CH_ON,
      operationId: created.operation.id,
    });
    expect(applied.kind).toBe('configured_unavailable');
  });

  it('探活成功 → succeeded', async () => {
    const created = service.proposeSessionMcpUpsert({
      sessionId: CH_ON,
      config: { id: 'local', name: 'local', transport: 'sse', url: 'https://example.com/mcp' },
    });
    if (created.kind !== 'created') throw new Error('setup failed');
    service.decideSessionExtensionOperation({
      sessionId: CH_ON,
      operationId: created.operation.id,
      nonce: created.operation.nonce,
      approverUserId: OWNER,
      approve: true,
    });
    const applied = await service.applyApprovedSessionExtensionOperation({
      sessionId: CH_ON,
      operationId: created.operation.id,
      ports: { probeMcpServer: async () => ({ ok: true, toolCount: 3 }) },
    });
    expect(applied.kind).toBe('succeeded');
  });

  it('重启后卡在 applying 的操作改判失败，不自动重放', async () => {
    const operationId = await proposeAndApprove();
    opStore.markSessionExtensionOperationApplying({ sessionId: CH_ON, operationId });
    expect(opStore.failInterruptedSessionExtensionOperations()).toBeGreaterThanOrEqual(1);
    expect(opStore.getSessionExtensionOperation(CH_ON, operationId)?.status).toBe('failed');
    expect(store.listSessionSkills(CH_ON)).toHaveLength(0);
  });
});

describe('撤权', () => {
  it('撤权返回时连接已真的回收（不是 fire-and-forget）', async () => {
    store.upsertSessionMcpServer({
      sessionId: CH_ON,
      ownerUserId: OWNER,
      resourceRef: 'mcp:session:await-release',
      displayId: 'await-release',
      config: {
        id: 'await-release',
        name: 'await-release',
        transport: 'sse',
        url: 'https://example.com/mcp',
      },
      expectedRevision: 0,
    });

    const { mcpConnectionPool } = await import('../../skill/skill-mcp-connection-pool.js');
    let releaseGate: (value: number) => void = () => undefined;
    const gate = new Promise<number>((resolve) => {
      releaseGate = resolve;
    });
    const spy = vi.spyOn(mcpConnectionPool, 'disconnectMatching').mockReturnValue(gate);

    try {
      let settled = false;
      const revoke = service
        .revokeSessionMcp({
          sessionId: CH_ON,
          resourceRef: 'mcp:session:await-release',
          remove: true,
        })
        .then(() => {
          settled = true;
        });

      await Promise.resolve();
      // 连接还没回收完就返回 = 调用方拿到的「已撤权」是撒谎。
      expect(settled).toBe(false);

      releaseGate(0);
      await revoke;
      expect(settled).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it('禁用会话技能立即生效且不需要管理员二次确认', async () => {
    const created = await service.proposeSessionSkillInstall({
      sessionId: CH_ON,
      skillId: 'demo-skill',
    });
    if (created.kind !== 'created') throw new Error('setup failed');
    service.decideSessionExtensionOperation({
      sessionId: CH_ON,
      operationId: created.operation.id,
      nonce: created.operation.nonce,
      approverUserId: OWNER,
      approve: true,
    });
    await service.applyApprovedSessionExtensionOperation({
      sessionId: CH_ON,
      operationId: created.operation.id,
    });
    const skill = store.listSessionSkills(CH_ON)[0];
    if (!skill) throw new Error('skill missing');

    const revoked = await service.revokeSessionSkill({
      sessionId: CH_ON,
      resourceRef: skill.resourceRef,
      remove: false,
    });
    expect(revoked.kind).toBe('ok');
    expect(store.getSessionSkill(CH_ON, skill.resourceRef)?.enabled).toBe(false);
  });

  it('渠道关闭管理后连撤权也被拒绝', async () => {
    const revoked = await service.revokeSessionSkill({
      sessionId: CH_OFF,
      resourceRef: 'skill:session:demo-skill',
      remove: true,
    });
    expect(revoked.kind).toBe('denied');
  });
});
