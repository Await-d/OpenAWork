/**
 * 260518 · L1.4 强制点 + L1.2.3 类型层强制
 *
 * Layer Capability Registry：把"五层架构是单向链 + escape hatch"从注释级
 * 约束变成代码级 guard。每层在做事前被代码挡住。
 *
 * 关联文档：
 *   - docs/team-architecture-l1-baseline.md L1.4（跨层调用 + 4 个 escape hatch）
 *   - docs/team-architecture-l1-baseline.md L1.2.3（类型层强制 + audit log 要求）
 *   - docs/team-architecture-spec-kit-borrowing-discussion.md §2B.7（hermes 反对的做法）
 *
 * 强制点（4 处）：
 *   1. createHandoff(): canHandoffTo
 *   2. submitInboundMessage(): canReceiveInboundFrom + allowedInboundTypes
 *   3. setSubstate(): allowedSubstates
 *   4. createArtifact(): canWriteArtifactPhases
 *
 * 违反 → 抛 LayerCapabilityViolationError + 写 audit log。
 */

import type { HandoffRoleLayer } from '../store/handoff-store.js';
import { sqliteRun } from '../../infra/db.js';

// ─── Capability Types ──────────────────────────────────────────────────────

/** Inbound 消息类型（与 inbound-store.ts 中 InboundMessageType 对齐） */
export type InboundMessageType =
  | 'cancel_signal'
  | 'pause_signal'
  | 'resume_signal'
  | 'clarification_answer'
  | 'user_input'
  | 'escalation_request'
  | 'progress_report';

/**
 * 一层的全部 capability。
 *
 * 每个字段：
 *   - canHandoffTo: 该层 createHandoff 可以指定的 toRoleLayer 集合
 *   - canReceiveInboundFrom: 该层作为 to_session 时，allowed source layer
 *   - allowedInboundTypes: 该层作为 to_session 时，allowed message_type
 *   - allowedSubstates: 该层 setSubstate 可以写入的 substate 值
 *   - canWriteArtifactPhases: 该层 createArtifact 可以指定的 phase
 *   - allowedToolsetCategories: 该层在执行时可以看到的 toolset 类别（天花板）
 *   - requiredToolsetCategories: 该层「必备」的 toolset 类别——成员配置不可砍掉，
 *     即使成员 metadata.toolsets 与层白名单的交集不含这些，也会强制并入，
 *     避免成员被错误配置砍光关键能力导致跑不动（如 reception 缺 read 没法读上下文）。
 *   - allowedBuiltinInstructions: 该层 LLM 可以 tool_call 的内置指令名
 */
export interface LayerCapabilities {
  canHandoffTo: ReadonlyArray<HandoffRoleLayer>;
  canReceiveInboundFrom: ReadonlyArray<HandoffRoleLayer | 'system'>;
  allowedInboundTypes: ReadonlyArray<InboundMessageType>;
  allowedSubstates: ReadonlyArray<string>;
  canWriteArtifactPhases: ReadonlyArray<string>;
  allowedToolsetCategories: ReadonlyArray<string>;
  /** 必备工具集（成员配置无法砍掉的底线，必须 ⊆ allowedToolsetCategories）。 */
  requiredToolsetCategories: ReadonlyArray<string>;
  allowedBuiltinInstructions: ReadonlyArray<string>;
}

// ─── L1.4 Capability Matrix ─────────────────────────────────────────────────

/**
 * 五层 capability 矩阵。
 *
 * 矩阵设计基于：
 *   - L1.4 §1.4.1 默认禁止规则（a→b→c→d→e/f/g 单向链）
 *   - L1.4 §1.4.2 4 个 escape hatch（escalation / progress / cancel/pause / 老路径）
 *   - 构思 §3B.2 五层职责矩阵
 *   - 构思 §4.1 hermes-agent → b/c/d 上层编排映射（toolset 分配）
 */
export const LAYER_CAPABILITIES: Readonly<Record<HandoffRoleLayer, LayerCapabilities>> = {
  // ─── a: user ────────────────────────────────────────────────────────────
  // 用户层：只能 handoff 到 reception；其他能力不适用（用户不调系统指令）。
  user: {
    canHandoffTo: ['reception'],
    canReceiveInboundFrom: [],
    allowedInboundTypes: [],
    allowedSubstates: [],
    canWriteArtifactPhases: [],
    allowedToolsetCategories: [],
    requiredToolsetCategories: [],
    allowedBuiltinInstructions: [],
  },

  // ─── b: reception ───────────────────────────────────────────────────────
  // 接待层：可派发到 pm1（c），可接收任何下游层的反向消息（escape hatch #1/#2）。
  reception: {
    canHandoffTo: ['pm1'],
    canReceiveInboundFrom: ['user', 'pm1', 'pm2', 'executor', 'reviewer', 'system'],
    allowedInboundTypes: [
      'user_input',
      'cancel_signal',
      'pause_signal',
      'resume_signal',
      'escalation_request',
      'progress_report',
    ],
    allowedSubstates: [
      'idle',
      'chatting',
      'routing',
      'dispatching',
      'awaiting_downstream',
      'failed',
      'cancelled',
    ],
    canWriteArtifactPhases: [], // reception 不写 artifact
    allowedToolsetCategories: ['read', 'web'],
    // reception 必须能读上下文（否则连用户的话都解析不了）。
    requiredToolsetCategories: ['read'],
    allowedBuiltinInstructions: [
      'route_to_orchestrate',
      'reply_direct',
      'request_user_input',
      'cancel_downstream',
      'push_notification',
    ],
  },

  // ─── c: pm1（任务规划）─────────────────────────────────────────────────
  // PM1 完成后由 watcher 自动 handoff 到 pm2（pm1.canHandoffTo 包含 pm2 是因为
  // createHandoff 调用方传入 fromRoleLayer='pm1'）。c 层 LLM 不主动调用 createHandoff。
  pm1: {
    canHandoffTo: ['pm2'],
    canReceiveInboundFrom: ['reception', 'system'],
    allowedInboundTypes: [
      'clarification_answer',
      'user_input',
      'cancel_signal',
      'pause_signal',
      'resume_signal',
    ],
    allowedSubstates: [
      'idle',
      'drafting_spec',
      'spec_ready',
      'clarifying',
      'drafting_plan',
      'plan_ready',
      'drafting_tasks',
      'tasks_ready',
      'completed',
      'failed',
      'cancelled',
    ],
    canWriteArtifactPhases: ['spec', 'plan', 'tasks'],
    allowedToolsetCategories: ['read', 'write'],
    // pm1 必须能读+写：要把 spec/plan/tasks 写出来给下游消费。
    requiredToolsetCategories: ['read', 'write'],
    allowedBuiltinInstructions: [
      'submit_artifact',
      'request_clarification',
      'mark_completed',
      'mark_failed',
    ],
  },

  // ─── d: pm2（开发管控）─────────────────────────────────────────────────
  // PM2 是双思想桥接节点：可派发到 executor / reviewer。
  pm2: {
    canHandoffTo: ['executor', 'reviewer'],
    canReceiveInboundFrom: ['pm1', 'executor', 'reviewer', 'system'],
    allowedInboundTypes: [
      'progress_report',
      'escalation_request',
      'cancel_signal',
      'pause_signal',
      'resume_signal',
    ],
    allowedSubstates: [
      'idle',
      'constitution_check',
      'architecture_review',
      'dispatching',
      'awaiting_eg',
      'reviewing',
      'escalating',
      'completed',
      'failed',
      'cancelled',
    ],
    canWriteArtifactPhases: ['dispatch', 'review_report'],
    allowedToolsetCategories: ['read', 'write', 'shell', 'lsp', 'review'],
    // pm2 必须能读上下文（派发与审查的最低线）；写/执行/lsp/review 由成员配置决定。
    requiredToolsetCategories: ['read'],
    allowedBuiltinInstructions: [
      'dispatch_package',
      'constitution_check',
      'escalate_to_user',
      'quality_review',
      'mark_completed',
      'mark_failed',
    ],
  },

  // ─── e: executor（终端层）──────────────────────────────────────────────
  // 执行层不能 handoff（终端），只接收 pm2 的派发包 + cancel/pause 信号。
  executor: {
    canHandoffTo: [], // 终端层
    canReceiveInboundFrom: ['pm2', 'system'],
    allowedInboundTypes: ['cancel_signal', 'pause_signal', 'resume_signal'],
    allowedSubstates: ['idle', 'implementing', 'completed', 'failed', 'cancelled'],
    canWriteArtifactPhases: ['implementation', 'patch'],
    allowedToolsetCategories: ['read', 'write', 'shell', 'lsp', 'test', 'web'],
    // executor 必须能读+写+执行 shell：交付代码/补丁的三大件，缺一不可。
    requiredToolsetCategories: ['read', 'write', 'shell'],
    allowedBuiltinInstructions: [
      'report_progress',
      'submit_patch',
      // 完成硬契约：结构化提交 checklist + summary；runner/review 优先消费
      'submit_execution_result',
      'mark_completed',
      'mark_failed',
    ],
  },

  // ─── g: reviewer（终端层）──────────────────────────────────────────────
  // 评审层不能 handoff（终端），只接收 pm2 的评审任务。
  reviewer: {
    canHandoffTo: [], // 终端层
    canReceiveInboundFrom: ['pm2', 'system'],
    allowedInboundTypes: ['cancel_signal', 'pause_signal', 'resume_signal'],
    allowedSubstates: ['idle', 'reviewing', 'completed', 'failed', 'cancelled'],
    canWriteArtifactPhases: ['review_report'],
    allowedToolsetCategories: ['read', 'lsp', 'review', 'shell', 'test'],
    // reviewer 必须能读：评审至少要能看代码。
    requiredToolsetCategories: ['read'],
    allowedBuiltinInstructions: [
      'report_progress',
      'submit_review',
      'mark_completed',
      'mark_failed',
    ],
  },
};

/**
 * 所有层的内置指令名去重集合（单一来源，从 LAYER_CAPABILITIES 派生）。
 *
 * 用途：tool-sandbox 的 whitelist / clarify-mode 门控放行——这些内置指令
 * （route_to_orchestrate / reply_direct / submit_artifact / dispatch_package ...）
 * 是按层注入的 LLM-facing 工具，名字不在静态 TOOL_WHITELIST 里。它们的「能不能调」
 * 由下游 invokeInstruction → assertInstructionOwnedByLayer 按层校验，所以前置门控
 * 应当像对待 flat MCP 工具那样隐式放行，否则模型拿到工具却在门控处被
 * 「is not allowed / is not enabled」拦下而无法工作。
 */
export const ALL_BUILTIN_INSTRUCTION_NAMES: ReadonlySet<string> = new Set(
  Object.values(LAYER_CAPABILITIES).flatMap((caps) => [...caps.allowedBuiltinInstructions]),
);

/** 判断某工具名是否为任意层的内置指令（门控放行用）。 */
export function isBuiltinInstructionName(toolName: string): boolean {
  return ALL_BUILTIN_INSTRUCTION_NAMES.has(toolName);
}

// ─── Violation Error ────────────────────────────────────────────────────────

export type ViolationKind =
  | 'handoff-target'
  | 'inbound-source'
  | 'inbound-type'
  | 'substate-not-allowed'
  | 'artifact-phase-not-allowed'
  | 'toolset-not-allowed'
  | 'instruction-not-owned';

export class LayerCapabilityViolationError extends Error {
  readonly kind: ViolationKind;
  readonly callerLayer: HandoffRoleLayer | 'system';
  readonly target: string;

  constructor(input: {
    kind: ViolationKind;
    callerLayer: HandoffRoleLayer | 'system';
    target: string;
    detail: string;
  }) {
    super(
      `[layer-capability] ${input.callerLayer} → ${input.kind}=${input.target}: ${input.detail}`,
    );
    this.name = 'LayerCapabilityViolationError';
    this.kind = input.kind;
    this.callerLayer = input.callerLayer;
    this.target = input.target;
  }
}

// ─── Audit Log ──────────────────────────────────────────────────────────────

/**
 * 写入 team_audit_logs（L1.4 §1.4.3 强制要求 audit log）。
 * 失败不抛错——audit log 是观察手段，不能拖累业务。
 */
function logCapabilityViolation(input: {
  callerLayer: HandoffRoleLayer | 'system';
  kind: ViolationKind;
  target: string;
  detail: string;
  userId?: string;
  sessionId?: string;
}): void {
  try {
    sqliteRun(
      `INSERT INTO team_audit_logs (
         user_id,
         action,
         entity_type,
         entity_id,
         session_id,
         summary,
         detail,
         created_at
       )
       VALUES (?, 'capability_violation', ?, ?, ?, ?, ?, datetime('now'))`,
      [
        input.userId ?? 'system',
        input.sessionId ? 'session' : 'layer',
        input.sessionId ?? input.callerLayer,
        input.sessionId ?? null,
        `${input.callerLayer} attempted ${input.kind}=${input.target}`,
        JSON.stringify({
          callerLayer: input.callerLayer,
          kind: input.kind,
          target: input.target,
          detail: input.detail,
        }),
      ],
    );
  } catch {
    // audit log 写入失败不阻塞主流程
  }
}

// ─── Guard Functions（4 处强制点）──────────────────────────────────────────

/**
 * Guard #1: createHandoff 时检查 fromRoleLayer → toRoleLayer 是否合法。
 * 违反 → 抛 LayerCapabilityViolationError + audit log。
 */
export function assertCanHandoffTo(input: {
  fromRoleLayer: HandoffRoleLayer;
  toRoleLayer: HandoffRoleLayer;
  userId?: string;
  fromSessionId?: string;
}): void {
  const caps = LAYER_CAPABILITIES[input.fromRoleLayer];
  if (!caps.canHandoffTo.includes(input.toRoleLayer)) {
    const detail = `${input.fromRoleLayer} 不能 handoff 到 ${input.toRoleLayer}（允许：${caps.canHandoffTo.join(', ') || '无'}）`;
    logCapabilityViolation({
      callerLayer: input.fromRoleLayer,
      kind: 'handoff-target',
      target: input.toRoleLayer,
      detail,
      ...(input.userId !== undefined ? { userId: input.userId } : {}),
      ...(input.fromSessionId !== undefined ? { sessionId: input.fromSessionId } : {}),
    });
    throw new LayerCapabilityViolationError({
      kind: 'handoff-target',
      callerLayer: input.fromRoleLayer,
      target: input.toRoleLayer,
      detail,
    });
  }
}

/**
 * Guard #2: submitInboundMessage 时检查 fromRoleLayer 和 messageType 是否被
 * to_session 所属层允许。
 * 注意：to_session 的 roleLayer 由调用方查询并传入；本 guard 不查 DB。
 */
export function assertCanReceiveInbound(input: {
  fromRoleLayer: HandoffRoleLayer | 'system';
  toRoleLayer: HandoffRoleLayer;
  messageType: InboundMessageType;
  userId?: string;
  toSessionId?: string;
}): void {
  const caps = LAYER_CAPABILITIES[input.toRoleLayer];

  if (!caps.canReceiveInboundFrom.includes(input.fromRoleLayer)) {
    const detail = `${input.toRoleLayer} 不能从 ${input.fromRoleLayer} 接收 inbound（允许来源：${caps.canReceiveInboundFrom.join(', ') || '无'}）`;
    logCapabilityViolation({
      callerLayer: input.fromRoleLayer,
      kind: 'inbound-source',
      target: `${input.toRoleLayer}/${input.messageType}`,
      detail,
      ...(input.userId !== undefined ? { userId: input.userId } : {}),
      ...(input.toSessionId !== undefined ? { sessionId: input.toSessionId } : {}),
    });
    throw new LayerCapabilityViolationError({
      kind: 'inbound-source',
      callerLayer: input.fromRoleLayer,
      target: `${input.toRoleLayer}/${input.messageType}`,
      detail,
    });
  }

  if (!caps.allowedInboundTypes.includes(input.messageType)) {
    const detail = `${input.toRoleLayer} 不接受 ${input.messageType} 类型 inbound（允许：${caps.allowedInboundTypes.join(', ') || '无'}）`;
    logCapabilityViolation({
      callerLayer: input.fromRoleLayer,
      kind: 'inbound-type',
      target: `${input.toRoleLayer}/${input.messageType}`,
      detail,
      ...(input.userId !== undefined ? { userId: input.userId } : {}),
      ...(input.toSessionId !== undefined ? { sessionId: input.toSessionId } : {}),
    });
    throw new LayerCapabilityViolationError({
      kind: 'inbound-type',
      callerLayer: input.fromRoleLayer,
      target: `${input.toRoleLayer}/${input.messageType}`,
      detail,
    });
  }
}

/**
 * Guard #3: setSubstate 时检查 substate 是否在 roleLayer 白名单中。
 * roleLayer 可选——不传时跳过校验（向后兼容某些不知道层级的调用）。
 */
export function assertSubstateAllowed(input: {
  roleLayer: HandoffRoleLayer | undefined;
  substate: string | null;
  userId?: string;
  sessionId?: string;
}): void {
  // null 表示清空，任何层都可清空
  if (input.substate === null) return;
  // 不知道层级时跳过（兼容现有 setSubstate 调用）
  if (!input.roleLayer) return;

  const caps = LAYER_CAPABILITIES[input.roleLayer];
  if (caps.allowedSubstates.length === 0) {
    // 该层没有定义 substate 白名单（如 user 层），允许任何（不强制）
    return;
  }

  if (!caps.allowedSubstates.includes(input.substate)) {
    const detail = `${input.roleLayer} 不允许进入 substate=${input.substate}（允许：${caps.allowedSubstates.join(', ')}）`;
    logCapabilityViolation({
      callerLayer: input.roleLayer,
      kind: 'substate-not-allowed',
      target: input.substate,
      detail,
      ...(input.userId !== undefined ? { userId: input.userId } : {}),
      ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
    });
    throw new LayerCapabilityViolationError({
      kind: 'substate-not-allowed',
      callerLayer: input.roleLayer,
      target: input.substate,
      detail,
    });
  }
}

/**
 * Guard #4: createArtifact 时检查 phase 是否在 roleLayer 白名单中。
 */
export function assertCanWriteArtifactPhase(input: {
  roleLayer: HandoffRoleLayer;
  phase: string;
  userId?: string;
  sessionId?: string;
}): void {
  const caps = LAYER_CAPABILITIES[input.roleLayer];
  if (!caps.canWriteArtifactPhases.includes(input.phase)) {
    const detail = `${input.roleLayer} 不允许写入 phase=${input.phase} 的 artifact（允许：${caps.canWriteArtifactPhases.join(', ') || '无'}）`;
    logCapabilityViolation({
      callerLayer: input.roleLayer,
      kind: 'artifact-phase-not-allowed',
      target: input.phase,
      detail,
      ...(input.userId !== undefined ? { userId: input.userId } : {}),
      ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
    });
    throw new LayerCapabilityViolationError({
      kind: 'artifact-phase-not-allowed',
      callerLayer: input.roleLayer,
      target: input.phase,
      detail,
    });
  }
}

/**
 * Guard #5（辅助）: 检查内置指令是否归属当前层。
 * 用于 builtin-instructions dispatcher。
 */
export function assertInstructionOwnedByLayer(input: {
  callerLayer: HandoffRoleLayer;
  instructionName: string;
  userId?: string;
  sessionId?: string;
}): void {
  const caps = LAYER_CAPABILITIES[input.callerLayer];
  if (!caps.allowedBuiltinInstructions.includes(input.instructionName)) {
    const detail = `${input.callerLayer} 层不能调用 ${input.instructionName} 指令（允许：${caps.allowedBuiltinInstructions.join(', ') || '无'}）`;
    logCapabilityViolation({
      callerLayer: input.callerLayer,
      kind: 'instruction-not-owned',
      target: input.instructionName,
      detail,
      ...(input.userId !== undefined ? { userId: input.userId } : {}),
      ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
    });
    throw new LayerCapabilityViolationError({
      kind: 'instruction-not-owned',
      callerLayer: input.callerLayer,
      target: input.instructionName,
      detail,
    });
  }
}

// ─── 编译期/启动期不变量校验 ─────────────────────────────────────────────────

/**
 * 不变量：每层的 requiredToolsetCategories 必须是 allowedToolsetCategories 的子集。
 * 若违反就在模块加载时直接抛错（fail-fast），避免错误配置在运行时被悄悄忽略。
 */
for (const [layer, caps] of Object.entries(LAYER_CAPABILITIES)) {
  const allowed = new Set(caps.allowedToolsetCategories);
  for (const required of caps.requiredToolsetCategories) {
    if (!allowed.has(required)) {
      throw new Error(
        `[layer-capabilities] ${layer} 层的 requiredToolsetCategories 包含 "${required}"，` +
          `但它不在 allowedToolsetCategories 里——必备集必须是允许集的子集，否则会被层天花板砍掉。`,
      );
    }
  }
}
