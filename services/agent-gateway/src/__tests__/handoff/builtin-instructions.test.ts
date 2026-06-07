/**
 * Builtin Instructions 单元测试
 *
 * 覆盖：
 *   - registerInstruction：与 layer-capabilities 矩阵一致性校验
 *   - getInstructionsForLayer：每层只看到自己的指令
 *   - invokeInstruction：
 *     * 合法层调合法指令 → 执行 handler
 *     * 错误层调指令 → ok=false / errorCode='instruction-not-owned'（软拒绝）
 *     * 参数 schema 失败 → ok=false / errorCode='invalid-args'
 *     * 不存在指令 → ok=false / errorCode='instruction-not-found'
 *   - 同名指令 (name) 在不同 owner 各自存在（mark_completed 在 4 个层）
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type * as DbModule from '../../infra/db.js';
import type * as Builtin from '../../handoff/capability/builtin-instructions.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let dbModule: typeof DbModule;
let builtin: typeof Builtin;

const USER_ID = 'u-builtin';
const SESSION_ID = 's-builtin';

function seedUser(): void {
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    'builtin@example.com',
  ]);
}

function seedSession(roleLayer: string): void {
  dbModule.sqliteRun(
    `INSERT OR REPLACE INTO sessions (id, user_id, title, metadata_json, role_layer)
     VALUES (?, ?, 'demo', '{}', ?)`,
    [SESSION_ID, USER_ID, roleLayer],
  );
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.migrate();
  builtin = await import('../../handoff/capability/builtin-instructions.js');
  // 加载实现，让 registry 被填充
  await import('../../handoff/capability/builtin-instructions-impl.js');
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM users', []);
  dbModule.sqliteRun('DELETE FROM team_audit_logs', []);
  dbModule.sqliteRun('DELETE FROM artifacts', []);
  dbModule.sqliteRun('DELETE FROM session_inbound_messages', []);
  dbModule.sqliteRun('DELETE FROM handoff_records', []);
  seedUser();
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('registerInstruction 校验', () => {
  it('注册不在 allowedBuiltinInstructions 中的指令 → 抛错', () => {
    expect(() => {
      builtin.registerInstruction({
        name: 'fake_instruction_xyz',
        ownerLayer: 'pm1',
        description: 'fake',
        schema: z.object({}),
        handler: async () => ({ ok: true, message: 'ok' }),
      });
    }).toThrow(/不在 pm1 的 allowedBuiltinInstructions/);
  });
});

describe('getInstructionsForLayer', () => {
  it('reception 层看到自己的 5 个指令', () => {
    const list = builtin.getInstructionsForLayer('reception');
    const names = list.map((i) => i.name).sort();
    expect(names).toEqual([
      'cancel_downstream',
      'push_notification',
      'reply_direct',
      'request_user_input',
      'route_to_orchestrate',
    ]);
  });

  it('pm1 层看到自己的 4 个指令（含 mark_completed/mark_failed）', () => {
    const list = builtin.getInstructionsForLayer('pm1');
    const names = list.map((i) => i.name).sort();
    expect(names).toContain('submit_artifact');
    expect(names).toContain('request_clarification');
    expect(names).toContain('mark_completed');
    expect(names).toContain('mark_failed');
  });

  it('每层都只看到自己的指令；不会越层泄露', () => {
    const receptionInstrs = builtin.getInstructionsForLayer('reception');
    const pm2Instrs = builtin.getInstructionsForLayer('pm2');
    const receptionNames = new Set(receptionInstrs.map((i) => i.name));
    const pm2Names = new Set(pm2Instrs.map((i) => i.name));
    // pm2 独有的 dispatch_package 不应出现在 reception 视图
    expect(receptionNames.has('dispatch_package')).toBe(false);
    expect(pm2Names.has('dispatch_package')).toBe(true);
    // reception 独有的 cancel_downstream 不应出现在 pm2
    expect(receptionNames.has('cancel_downstream')).toBe(true);
    expect(pm2Names.has('cancel_downstream')).toBe(false);
  });

  it('user 层没有指令', () => {
    const list = builtin.getInstructionsForLayer('user');
    expect(list).toEqual([]);
  });
});

describe('invokeInstruction 软拒绝（Q2 决策）', () => {
  it('不存在的指令 → 返回 instruction-not-found 错误', async () => {
    const result = await builtin.invokeInstruction({
      ctx: { callerLayer: 'pm1', sessionId: SESSION_ID, userId: USER_ID },
      instructionName: 'nonexistent_xyz',
      rawArgs: {},
    });
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('instruction-not-found');
  });

  it('错误层调正确名字的指令 → 返回 instruction-not-owned 错误（不抛错）', async () => {
    seedSession('reception');
    // reception 层尝试调 submit_artifact（属于 pm1）
    const result = await builtin.invokeInstruction({
      ctx: { callerLayer: 'reception', sessionId: SESSION_ID, userId: USER_ID },
      instructionName: 'submit_artifact',
      rawArgs: { phase: 'spec', title: 't', content: 'c' },
    });
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('instruction-not-owned');
    expect(result.message).toContain('reception 层不能调用 submit_artifact');
  });

  it('参数 schema 失败 → 返回 invalid-args 错误', async () => {
    seedSession('pm1');
    const result = await builtin.invokeInstruction({
      ctx: { callerLayer: 'pm1', sessionId: SESSION_ID, userId: USER_ID },
      instructionName: 'submit_artifact',
      rawArgs: { phase: 'invalid_phase', title: 't', content: 'c' },
    });
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('invalid-args');
  });

  it('handler 抛错 → 软包装为 handler-error', async () => {
    // 注册一个故意抛错的临时指令
    const restore = builtin.getInstruction('mark_completed', 'pm1');
    builtin.registerInstruction({
      name: 'mark_completed',
      ownerLayer: 'pm1',
      description: 'test override',
      schema: z.object({}),
      handler: async () => {
        throw new Error('boom');
      },
    });
    seedSession('pm1');
    const result = await builtin.invokeInstruction({
      ctx: { callerLayer: 'pm1', sessionId: SESSION_ID, userId: USER_ID },
      instructionName: 'mark_completed',
      rawArgs: {},
    });
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('handler-error');
    expect(result.message).toContain('boom');
    // 还原
    if (restore) builtin.registerInstruction(restore);
  });
});

describe('invokeInstruction 合法路径', () => {
  it('reception 调 reply_direct → 写入消息 + 返回 ok', async () => {
    seedSession('reception');
    const result = await builtin.invokeInstruction({
      ctx: { callerLayer: 'reception', sessionId: SESSION_ID, userId: USER_ID },
      instructionName: 'reply_direct',
      rawArgs: { text: '你好，这是回答。' },
    });
    expect(result.ok).toBe(true);

    // 验证消息被写入
    const msgCount = dbModule.sqliteGet<{ c: number }>(
      `SELECT COUNT(*) AS c FROM message_v2 WHERE session_id = ?`,
      [SESSION_ID],
    );
    expect(msgCount?.c).toBeGreaterThanOrEqual(1);
  });

  it('pm1 调 submit_artifact → 写入 artifacts 表', async () => {
    seedSession('pm1');
    const result = await builtin.invokeInstruction({
      ctx: { callerLayer: 'pm1', sessionId: SESSION_ID, userId: USER_ID },
      instructionName: 'submit_artifact',
      rawArgs: {
        phase: 'spec',
        title: 'My Spec',
        content: '# Spec\n用户故事...',
      },
    });
    expect(result.ok).toBe(true);
    expect((result.data as { phase: string }).phase).toBe('spec');

    const artifactRow = dbModule.sqliteGet<{ phase: string; title: string }>(
      `SELECT phase, title FROM artifacts WHERE session_id = ? ORDER BY created_at DESC LIMIT 1`,
      [SESSION_ID],
    );
    expect(artifactRow?.phase).toBe('spec');
    expect(artifactRow?.title).toBe('My Spec');
  });

  it('reception 调 route_to_orchestrate → 创建 reception→pm1 handoff', async () => {
    seedSession('reception');
    const result = await builtin.invokeInstruction({
      ctx: { callerLayer: 'reception', sessionId: SESSION_ID, userId: USER_ID },
      instructionName: 'route_to_orchestrate',
      rawArgs: {
        sourceIntent: '帮我写代码',
        rewrittenIntent: '生成 OAuth 集成模块',
      },
    });
    expect(result.ok).toBe(true);

    const handoffRow = dbModule.sqliteGet<{ from_role_layer: string; to_role_layer: string }>(
      `SELECT from_role_layer, to_role_layer FROM handoff_records ORDER BY created_at DESC LIMIT 1`,
    );
    expect(handoffRow?.from_role_layer).toBe('reception');
    expect(handoffRow?.to_role_layer).toBe('pm1');
  });

  it('pm2 调 dispatch_package → 创建 pm2→executor handoff', async () => {
    seedSession('pm2');
    const result = await builtin.invokeInstruction({
      ctx: { callerLayer: 'pm2', sessionId: SESSION_ID, userId: USER_ID },
      instructionName: 'dispatch_package',
      rawArgs: {
        goal: '修复前端登录页面样式问题',
        context: '前端页面',
        role: 'executor',
        toolsets: ['read', 'write'],
        taskId: 'T001',
        parallel: false,
      },
    });
    expect(result.ok).toBe(true);

    const handoffRow = dbModule.sqliteGet<{
      from_role_layer: string;
      to_role_layer: string;
      payload_json: string;
    }>(
      `SELECT from_role_layer, to_role_layer, payload_json FROM handoff_records ORDER BY created_at DESC LIMIT 1`,
    );
    expect(handoffRow?.from_role_layer).toBe('pm2');
    expect(handoffRow?.to_role_layer).toBe('executor');
    const payload = handoffRow
      ? (JSON.parse(handoffRow.payload_json) as {
          taskProfile?: { kind?: string; surface?: string };
        })
      : null;
    expect(payload?.taskProfile?.kind).toBe('fix');
    expect(payload?.taskProfile?.surface).toBe('ui');
  });

  it('reception 调 cancel_downstream → 取消下游 handoff + 写审计日志', async () => {
    seedSession('reception');
    // 构造一个 reception→pm1 的 running handoff，to_session 是一个 pm1 子会话。
    dbModule.sqliteRun(
      `INSERT OR REPLACE INTO sessions (id, user_id, title, metadata_json, role_layer, team_parent_session_id)
       VALUES ('s-cd-pm1', ?, 'pm1', '{}', 'pm1', ?)`,
      [USER_ID, SESSION_ID],
    );
    dbModule.sqliteRun(
      `INSERT OR REPLACE INTO handoff_records
         (id, user_id, from_session_id, from_role_layer, to_role_layer, to_session_id, payload_json, state, retry_count)
       VALUES ('h-cd', ?, ?, 'reception', 'pm1', 's-cd-pm1', '{}', 'running', 0)`,
      [USER_ID, SESSION_ID],
    );

    const result = await builtin.invokeInstruction({
      ctx: { callerLayer: 'reception', sessionId: SESSION_ID, userId: USER_ID },
      instructionName: 'cancel_downstream',
      rawArgs: { handoffId: 'h-cd', reason: '用户要求取消' },
    });
    expect(result.ok).toBe(true);

    // handoff 被取消
    const handoffRow = dbModule.sqliteGet<{ state: string }>(
      `SELECT state FROM handoff_records WHERE id = 'h-cd'`,
    );
    expect(handoffRow?.state).toBe('cancelled');

    // 审计日志被写入（action=handoff_control, entity=handoff）
    const auditRow = dbModule.sqliteGet<{
      action: string;
      entity_type: string;
      detail: string;
      session_id: string | null;
    }>(
      `SELECT action, entity_type, detail, session_id FROM team_audit_logs
       WHERE entity_id = 'h-cd' ORDER BY id DESC LIMIT 1`,
    );
    expect(auditRow?.action).toBe('handoff_control');
    expect(auditRow?.entity_type).toBe('handoff');
    expect(auditRow?.session_id).toBe(SESSION_ID);
    const detail = auditRow
      ? (JSON.parse(auditRow.detail) as { action?: string; reason?: string })
      : null;
    expect(detail?.action).toBe('cancel');
    expect(detail?.reason).toBe('用户要求取消');
  });

  it('pm2 调 constitution_check → 写入带 sessionId 的审计日志', async () => {
    seedSession('pm2');
    const result = await builtin.invokeInstruction({
      ctx: { callerLayer: 'pm2', sessionId: SESSION_ID, userId: USER_ID },
      instructionName: 'constitution_check',
      rawArgs: {
        pass: false,
        violations: ['缺少回滚方案'],
        planArtifactId: 'artifact-plan-1',
      },
    });
    expect(result.ok).toBe(true);

    const auditRow = dbModule.sqliteGet<{
      action: string;
      entity_type: string;
      entity_id: string;
      session_id: string | null;
      detail: string | null;
    }>(
      `SELECT action, entity_type, entity_id, session_id, detail
         FROM team_audit_logs
        WHERE action = 'constitution_check'
        ORDER BY id DESC
        LIMIT 1`,
    );
    expect(auditRow).toMatchObject({
      action: 'constitution_check',
      entity_type: 'artifact',
      entity_id: 'artifact-plan-1',
      session_id: SESSION_ID,
    });
    expect(auditRow?.detail ?? '').toContain('缺少回滚方案');
  });

  it('pm2 调 quality_review → 写入带 sessionId 的审计日志', async () => {
    seedSession('pm2');
    const result = await builtin.invokeInstruction({
      ctx: { callerLayer: 'pm2', sessionId: SESSION_ID, userId: USER_ID },
      instructionName: 'quality_review',
      rawArgs: {
        passCount: 3,
        failCount: 1,
        summary: '还有 1 项用例未通过',
        decision: 'request_retry',
      },
    });
    expect(result.ok).toBe(true);

    const auditRow = dbModule.sqliteGet<{
      action: string;
      entity_type: string;
      entity_id: string;
      session_id: string | null;
      detail: string | null;
    }>(
      `SELECT action, entity_type, entity_id, session_id, detail
         FROM team_audit_logs
        WHERE action = 'quality_review'
        ORDER BY id DESC
        LIMIT 1`,
    );
    expect(auditRow).toMatchObject({
      action: 'quality_review',
      entity_type: 'session',
      entity_id: SESSION_ID,
      session_id: SESSION_ID,
    });
    expect(auditRow?.detail ?? '').toContain('request_retry');
  });
});

describe('多层共享指令（mark_completed / mark_failed / report_progress）', () => {
  it('mark_completed 在 pm1 / pm2 / executor / reviewer 各自存在', () => {
    expect(builtin.getInstruction('mark_completed', 'pm1')).toBeDefined();
    expect(builtin.getInstruction('mark_completed', 'pm2')).toBeDefined();
    expect(builtin.getInstruction('mark_completed', 'executor')).toBeDefined();
    expect(builtin.getInstruction('mark_completed', 'reviewer')).toBeDefined();
    // reception 没有 mark_completed
    expect(builtin.getInstruction('mark_completed', 'reception')).toBeUndefined();
  });

  it('pm1 调 mark_completed → 写 substate=completed', async () => {
    seedSession('pm1');
    const result = await builtin.invokeInstruction({
      ctx: { callerLayer: 'pm1', sessionId: SESSION_ID, userId: USER_ID },
      instructionName: 'mark_completed',
      rawArgs: { summary: '完成 spec/plan/tasks' },
    });
    expect(result.ok).toBe(true);

    const sessionRow = dbModule.sqliteGet<{ substate: string | null }>(
      `SELECT substate FROM sessions WHERE id = ?`,
      [SESSION_ID],
    );
    expect(sessionRow?.substate).toBe('completed');
  });

  it('reviewer 调 report_progress → 写入 inbound 到 reception session', async () => {
    seedSession('reviewer');
    // 创建一个 reception session 作为目标
    dbModule.sqliteRun(
      `INSERT OR IGNORE INTO sessions (id, user_id, title, metadata_json, role_layer)
       VALUES ('s-reception-pr', ?, 'Reception', '{}', 'reception')`,
      [USER_ID],
    );

    const result = await builtin.invokeInstruction({
      ctx: { callerLayer: 'reviewer', sessionId: SESSION_ID, userId: USER_ID },
      instructionName: 'report_progress',
      rawArgs: {
        receptionSessionId: 's-reception-pr',
        progressText: '已完成评审',
        percent: 100,
      },
    });
    expect(result.ok).toBe(true);

    const inboundRow = dbModule.sqliteGet<{ message_type: string; from_role_layer: string }>(
      `SELECT message_type, from_role_layer FROM session_inbound_messages
       WHERE to_session_id = 's-reception-pr' ORDER BY created_at DESC LIMIT 1`,
    );
    expect(inboundRow?.message_type).toBe('progress_report');
    expect(inboundRow?.from_role_layer).toBe('reviewer');
  });
});
