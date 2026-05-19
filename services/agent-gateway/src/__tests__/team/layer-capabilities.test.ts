/**
 * Layer Capability Matrix 单元测试
 *
 * 覆盖：
 *   - canHandoffTo：合法/非法 handoff 拓扑
 *   - canReceiveInboundFrom + allowedInboundTypes：跨层 inbound 校验
 *   - allowedSubstates：substate 白名单强制
 *   - canWriteArtifactPhases：artifact phase 白名单
 *   - allowedBuiltinInstructions：内置指令归属层校验
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as DbModule from '../../db.js';
import type * as Caps from '../../handoff/capability/layer-capabilities.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let dbModule: typeof DbModule;
let caps: typeof Caps;

beforeAll(async () => {
  dbModule = await import('../../db.js');
  await dbModule.migrate();
  caps = await import('../../handoff/capability/layer-capabilities.js');
});

beforeEach(() => {
  // 清掉 audit log 让每个测试独立
  dbModule.sqliteRun('DELETE FROM team_audit_logs', []);
  // 种一个用户给 audit log 写入用（FK 约束）
  dbModule.sqliteRun(
    "INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')",
    ['u-test', 'cap-test@example.com'],
  );
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('LAYER_CAPABILITIES matrix shape', () => {
  it('每层都有 6 个 capability 字段', () => {
    const layers: Array<keyof typeof caps.LAYER_CAPABILITIES> = [
      'user',
      'reception',
      'pm1',
      'pm2',
      'executor',
      'reviewer',
    ];
    for (const layer of layers) {
      const c = caps.LAYER_CAPABILITIES[layer];
      expect(c).toBeDefined();
      expect(c.canHandoffTo).toBeDefined();
      expect(c.canReceiveInboundFrom).toBeDefined();
      expect(c.allowedInboundTypes).toBeDefined();
      expect(c.allowedSubstates).toBeDefined();
      expect(c.canWriteArtifactPhases).toBeDefined();
      expect(c.allowedBuiltinInstructions).toBeDefined();
    }
  });

  it('五层链拓扑：user→reception→pm1→pm2→executor/reviewer', () => {
    expect(caps.LAYER_CAPABILITIES.user.canHandoffTo).toContain('reception');
    expect(caps.LAYER_CAPABILITIES.reception.canHandoffTo).toContain('pm1');
    expect(caps.LAYER_CAPABILITIES.pm1.canHandoffTo).toContain('pm2');
    expect(caps.LAYER_CAPABILITIES.pm2.canHandoffTo).toContain('executor');
    expect(caps.LAYER_CAPABILITIES.pm2.canHandoffTo).toContain('reviewer');
    // 终端层：executor / reviewer 不能再 handoff
    expect(caps.LAYER_CAPABILITIES.executor.canHandoffTo).toEqual([]);
    expect(caps.LAYER_CAPABILITIES.reviewer.canHandoffTo).toEqual([]);
  });
});

describe('assertCanHandoffTo', () => {
  it('合法：reception → pm1', () => {
    expect(() =>
      caps.assertCanHandoffTo({ fromRoleLayer: 'reception', toRoleLayer: 'pm1' }),
    ).not.toThrow();
  });

  it('合法：pm2 → executor', () => {
    expect(() =>
      caps.assertCanHandoffTo({ fromRoleLayer: 'pm2', toRoleLayer: 'executor' }),
    ).not.toThrow();
  });

  it('非法：executor → executor（终端层禁止 handoff）', () => {
    expect(() =>
      caps.assertCanHandoffTo({ fromRoleLayer: 'executor', toRoleLayer: 'executor' }),
    ).toThrow(caps.LayerCapabilityViolationError);
  });

  it('非法：reception → executor（跳过 pm1/pm2）', () => {
    expect(() =>
      caps.assertCanHandoffTo({ fromRoleLayer: 'reception', toRoleLayer: 'executor' }),
    ).toThrow(/reception 不能 handoff 到 executor/);
  });

  it('非法：pm2 → reception（反向 handoff，应走 inbound 反向通道）', () => {
    expect(() =>
      caps.assertCanHandoffTo({ fromRoleLayer: 'pm2', toRoleLayer: 'reception' }),
    ).toThrow(caps.LayerCapabilityViolationError);
  });

  it('违反 → 写 audit log（capability_violation）', () => {
    try {
      caps.assertCanHandoffTo({
        fromRoleLayer: 'executor',
        toRoleLayer: 'pm1',
        userId: 'u-test',
        fromSessionId: 's-test',
      });
    } catch {
      // expected
    }
    const rows = dbModule.sqliteAll<{ action: string; entity_id: string; summary: string }>(
      `SELECT action, entity_id, summary FROM team_audit_logs
       WHERE action = 'capability_violation' AND entity_id = 's-test' ORDER BY created_at DESC LIMIT 1`,
    );
    expect(rows.length).toBe(1);
    expect(rows[0]!.summary).toContain('executor');
    expect(rows[0]!.summary).toContain('pm1');
  });
});

describe('assertCanReceiveInbound', () => {
  it('合法：reception 接收 user 的 user_input', () => {
    expect(() =>
      caps.assertCanReceiveInbound({
        fromRoleLayer: 'user',
        toRoleLayer: 'reception',
        messageType: 'user_input',
      }),
    ).not.toThrow();
  });

  it('合法：reception 接收 pm1 的 escalation_request', () => {
    expect(() =>
      caps.assertCanReceiveInbound({
        fromRoleLayer: 'pm1',
        toRoleLayer: 'reception',
        messageType: 'escalation_request',
      }),
    ).not.toThrow();
  });

  it('合法：pm1 接收 reception 的 clarification_answer', () => {
    expect(() =>
      caps.assertCanReceiveInbound({
        fromRoleLayer: 'reception',
        toRoleLayer: 'pm1',
        messageType: 'clarification_answer',
      }),
    ).not.toThrow();
  });

  it('合法：system 给 executor 发 cancel_signal', () => {
    expect(() =>
      caps.assertCanReceiveInbound({
        fromRoleLayer: 'system',
        toRoleLayer: 'executor',
        messageType: 'cancel_signal',
      }),
    ).not.toThrow();
  });

  it('非法：reception 接收 reception（同层不能用 inbound）', () => {
    expect(() =>
      caps.assertCanReceiveInbound({
        fromRoleLayer: 'reception',
        toRoleLayer: 'reception',
        messageType: 'user_input',
      }),
    ).toThrow(/不能从 reception 接收 inbound/);
  });

  it('非法：executor 接收 escalation_request（执行层不消费 escalation）', () => {
    expect(() =>
      caps.assertCanReceiveInbound({
        fromRoleLayer: 'system',
        toRoleLayer: 'executor',
        messageType: 'escalation_request',
      }),
    ).toThrow(/不接受 escalation_request/);
  });

  it('非法：reception 接收 clarification_answer（澄清答案给 pm1，不给 b）', () => {
    expect(() =>
      caps.assertCanReceiveInbound({
        fromRoleLayer: 'user',
        toRoleLayer: 'reception',
        messageType: 'clarification_answer',
      }),
    ).toThrow(/不接受 clarification_answer/);
  });
});

describe('assertSubstateAllowed', () => {
  it('合法：pm1 写 drafting_spec', () => {
    expect(() =>
      caps.assertSubstateAllowed({
        roleLayer: 'pm1',
        substate: 'drafting_spec',
      }),
    ).not.toThrow();
  });

  it('合法：pm2 写 constitution_check', () => {
    expect(() =>
      caps.assertSubstateAllowed({
        roleLayer: 'pm2',
        substate: 'constitution_check',
      }),
    ).not.toThrow();
  });

  it('合法：null 表示清空，任何层都可以', () => {
    expect(() =>
      caps.assertSubstateAllowed({
        roleLayer: 'pm1',
        substate: null,
      }),
    ).not.toThrow();
  });

  it('合法：roleLayer undefined 时跳过校验（向后兼容）', () => {
    expect(() =>
      caps.assertSubstateAllowed({
        roleLayer: undefined,
        substate: 'whatever',
      }),
    ).not.toThrow();
  });

  it('非法：pm1 写 constitution_check（属于 pm2）', () => {
    expect(() =>
      caps.assertSubstateAllowed({
        roleLayer: 'pm1',
        substate: 'constitution_check',
      }),
    ).toThrow(/pm1 不允许进入 substate=constitution_check/);
  });

  it('非法：executor 写 drafting_spec（属于 pm1）', () => {
    expect(() =>
      caps.assertSubstateAllowed({
        roleLayer: 'executor',
        substate: 'drafting_spec',
      }),
    ).toThrow(caps.LayerCapabilityViolationError);
  });
});

describe('assertCanWriteArtifactPhase', () => {
  it('合法：pm1 写 spec / plan / tasks', () => {
    expect(() =>
      caps.assertCanWriteArtifactPhase({ roleLayer: 'pm1', phase: 'spec' }),
    ).not.toThrow();
    expect(() =>
      caps.assertCanWriteArtifactPhase({ roleLayer: 'pm1', phase: 'plan' }),
    ).not.toThrow();
    expect(() =>
      caps.assertCanWriteArtifactPhase({ roleLayer: 'pm1', phase: 'tasks' }),
    ).not.toThrow();
  });

  it('合法：executor 写 implementation / patch', () => {
    expect(() =>
      caps.assertCanWriteArtifactPhase({ roleLayer: 'executor', phase: 'implementation' }),
    ).not.toThrow();
    expect(() =>
      caps.assertCanWriteArtifactPhase({ roleLayer: 'executor', phase: 'patch' }),
    ).not.toThrow();
  });

  it('非法：reception 写任何 artifact', () => {
    expect(() =>
      caps.assertCanWriteArtifactPhase({ roleLayer: 'reception', phase: 'spec' }),
    ).toThrow(/reception 不允许写入 phase=spec/);
  });

  it('非法：executor 写 spec（spec 是 pm1 的 phase）', () => {
    expect(() =>
      caps.assertCanWriteArtifactPhase({ roleLayer: 'executor', phase: 'spec' }),
    ).toThrow(caps.LayerCapabilityViolationError);
  });

  it('非法：pm1 写 implementation（implementation 是 executor 的 phase）', () => {
    expect(() =>
      caps.assertCanWriteArtifactPhase({ roleLayer: 'pm1', phase: 'implementation' }),
    ).toThrow(caps.LayerCapabilityViolationError);
  });
});

describe('assertInstructionOwnedByLayer', () => {
  it('合法：pm1 调用 submit_artifact', () => {
    expect(() =>
      caps.assertInstructionOwnedByLayer({
        callerLayer: 'pm1',
        instructionName: 'submit_artifact',
      }),
    ).not.toThrow();
  });

  it('合法：pm2 调用 dispatch_package', () => {
    expect(() =>
      caps.assertInstructionOwnedByLayer({
        callerLayer: 'pm2',
        instructionName: 'dispatch_package',
      }),
    ).not.toThrow();
  });

  it('非法：reception 调用 submit_artifact（属于 pm1）', () => {
    expect(() =>
      caps.assertInstructionOwnedByLayer({
        callerLayer: 'reception',
        instructionName: 'submit_artifact',
      }),
    ).toThrow(/reception 层不能调用 submit_artifact/);
  });

  it('非法：executor 调用 dispatch_package（属于 pm2）', () => {
    expect(() =>
      caps.assertInstructionOwnedByLayer({
        callerLayer: 'executor',
        instructionName: 'dispatch_package',
      }),
    ).toThrow(caps.LayerCapabilityViolationError);
  });

  it('非法：pm1 调用 quality_review（属于 pm2）', () => {
    expect(() =>
      caps.assertInstructionOwnedByLayer({
        callerLayer: 'pm1',
        instructionName: 'quality_review',
      }),
    ).toThrow(caps.LayerCapabilityViolationError);
  });
});

describe('LayerCapabilityViolationError 字段', () => {
  it('错误对象包含 kind / callerLayer / target', () => {
    let err: Error | null = null;
    try {
      caps.assertCanHandoffTo({ fromRoleLayer: 'executor', toRoleLayer: 'pm1' });
    } catch (e) {
      err = e as Error;
    }
    expect(err).toBeInstanceOf(caps.LayerCapabilityViolationError);
    const violation = err as Caps.LayerCapabilityViolationError;
    expect(violation.kind).toBe('handoff-target');
    expect(violation.callerLayer).toBe('executor');
    expect(violation.target).toBe('pm1');
  });
});
