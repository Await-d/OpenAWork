/**
 * 260518 · 五层各自的内置指令实现
 *
 * 每个指令调用 registerInstruction 注册到中央注册表。
 *
 * 设计原则：
 *   - 指令是"代码端能力"的薄包装：handler 调 createHandoff / submitInboundMessage / setSubstate
 *     等已有函数。layer-capabilities guard 自动接管层级强制。
 *   - 指令的 schema 必须与对应数据库 / 函数签名对齐，避免 LLM 输出无法落库。
 *   - 错误返回 { ok: false, errorCode, message } 给 LLM 自我纠正（软拒绝）。
 */

import { z } from 'zod';
import { registerInstruction, type InstructionResult } from './builtin-instructions.js';
import { createHandoff } from '../store/handoff-store.js';
import { submitInboundMessage } from '../store/inbound-store.js';
import { setSubstate } from '../store/substate-store.js';
import { sqliteRun, sqliteGet } from '../../infra/db.js';
import { randomUUID } from 'node:crypto';
import { publishHandoffEvent, publishTeamEvent } from '../bus/team-events-bus.js';
import {
  extractComparablePathsFromText,
  inferTaskProfile,
  TOOLSET_CATEGORIES,
} from './dispatch-package.js';
import {
  findOutOfScopePaths,
  normalizeExecutionResult,
  normalizeReviewVerdict,
  submitExecutionResultSchema,
  submitReviewReportSchema,
  SUBMIT_EXECUTION_RESULT_PROTOCOL,
  SUBMIT_REVIEW_REPORT_PROTOCOL,
} from './completion-protocol-contract.js';

// ─── b: reception 层指令 ────────────────────────────────────────────────────

/**
 * route_to_orchestrate: b 层把用户意图转换为 handoff(reception → pm1)。
 * 取代直接调 createHandoff，让 LLM 通过结构化指令派发。
 */
registerInstruction({
  name: 'route_to_orchestrate',
  ownerLayer: 'reception',
  description:
    '把用户的原始意图转交给 PM1 任务规划层（c）。用于复杂任务（开发/修复/重构等）。' +
    '调用前请确认用户意图清晰；模糊请求应先用 request_user_input 追问。',
  schema: z.object({
    sourceIntent: z.string().min(1).describe('用户原始自然语言意图'),
    rewrittenIntent: z.string().min(1).describe('改写后的结构化意图'),
    recommendedRole: z.enum(['planner', 'researcher', 'executor', 'reviewer']).optional(),
    teamWorkspaceId: z.string().nullable().optional(),
  }),
  handler: async (ctx, args): Promise<InstructionResult> => {
    const handoff = createHandoff({
      userId: ctx.userId,
      fromSessionId: ctx.sessionId,
      fromRoleLayer: 'reception',
      toRoleLayer: 'pm1',
      payload: {
        sourceIntent: args.sourceIntent,
        rewrittenIntent: args.rewrittenIntent,
        recommendedRole: args.recommendedRole ?? 'planner',
        teamWorkspaceId: args.teamWorkspaceId ?? null,
      },
    });
    publishHandoffEvent({
      type: 'handoff.created',
      record: handoff,
      payload: { orchestrator: 'instruction:route_to_orchestrate' },
    });
    return {
      ok: true,
      message: `已派发到 PM1（handoff=${handoff.id.slice(0, 8)}）`,
      data: { handoffId: handoff.id },
    };
  },
});

/**
 * reply_direct: b 层直接回复用户（不派发下游）。LLM 应用于简单问答 / 闲聊。
 */
registerInstruction({
  name: 'reply_direct',
  ownerLayer: 'reception',
  description: '直接回答用户的简单问题，不需要派发给团队下游。仅用于知识查询、闲聊、状态汇报。',
  schema: z.object({
    text: z.string().min(1).max(4000).describe('给用户的回答内容（Markdown）'),
  }),
  handler: async (ctx, args): Promise<InstructionResult> => {
    // 通过普通消息流写回；reception layer 直答模式
    const { appendSessionMessageV2 } = await import('../../message/message-v2-adapter.js');
    appendSessionMessageV2({
      sessionId: ctx.sessionId,
      userId: ctx.userId,
      role: 'assistant',
      agentId: 'interaction-agent',
      content: [{ type: 'text', text: args.text }],
    });
    return {
      ok: true,
      message: '已直接回复用户。',
    };
  },
});

/**
 * request_user_input: b 层向用户追问（意图不清时）。
 */
registerInstruction({
  name: 'request_user_input',
  ownerLayer: 'reception',
  description: '当用户意图模糊时向用户追问。用具体问题缩小理解范围。',
  schema: z.object({
    question: z.string().min(1).max(2000).describe('需要用户回答的问题'),
    options: z.array(z.string()).optional().describe('可选项列表（如有）'),
  }),
  handler: async (ctx, args): Promise<InstructionResult> => {
    const { appendSessionMessageV2 } = await import('../../message/message-v2-adapter.js');
    const optionsBlock =
      args.options && args.options.length > 0
        ? `\n\n可选项：\n${args.options.map((o, i) => `${i + 1}. ${o}`).join('\n')}`
        : '';
    appendSessionMessageV2({
      sessionId: ctx.sessionId,
      userId: ctx.userId,
      role: 'assistant',
      agentId: 'interaction-agent',
      content: [{ type: 'text', text: `${args.question}${optionsBlock}` }],
    });
    return { ok: true, message: '已向用户追问。' };
  },
});

/**
 * cancel_downstream: b 层取消某个下游 handoff（并级联取消其整棵下游子树）。
 * 通过 cancelTeamRuntimeTree 取消子树所有未终止 handoff + 注入 cancel_signal，
 * team-stream-control gate 会在下个 round 边界中止正在跑的 LLM 流。
 */
registerInstruction({
  name: 'cancel_downstream',
  ownerLayer: 'reception',
  description: '取消某个正在跑的下游任务（含其派生的所有子任务）。LLM 在用户明确要求取消时调用。',
  schema: z.object({
    handoffId: z.string().min(1).describe('要取消的 handoff id'),
    reason: z.string().min(1).max(500).describe('取消原因（写入 audit log）'),
  }),
  handler: async (ctx, args): Promise<InstructionResult> => {
    // 找到 handoff 的 to_session
    const handoff = sqliteGet<{ to_session_id: string | null; user_id: string }>(
      `SELECT to_session_id, user_id FROM handoff_records WHERE id = ? LIMIT 1`,
      [args.handoffId],
    );
    if (!handoff || handoff.user_id !== ctx.userId) {
      return {
        ok: false,
        errorCode: 'handoff-not-found',
        message: 'handoff 不存在或不属于当前用户。',
      };
    }
    if (!handoff.to_session_id) {
      return {
        ok: false,
        errorCode: 'no-target-session',
        message: 'handoff 尚未 claim，没有目标 session。',
      };
    }

    const { cancelHandoff } = await import('../store/handoff-store.js');
    const { cancelTeamRuntimeTree } = await import('../../team/team-runtime-control-store.js');

    // 1. 取消目标 handoff 本身（状态翻到 cancelled）。
    cancelHandoff({ userId: ctx.userId, handoffId: args.handoffId });

    // 2. 级联取消下游子树（rooted at 目标 handoff 的 to_session）的所有未终止 handoff。
    let cancelledCount = 0;
    const tree = cancelTeamRuntimeTree({
      rootSessionId: handoff.to_session_id,
      userId: ctx.userId,
    });
    if (tree) {
      cancelledCount = tree.cancelledHandoffIds.length;
      // 3. 给子树每个 session 注入 cancel_signal + 停流 + 置 substate。
      const { stopAllInFlightStreamRequestsForSession } =
        await import('../../routes/stream-cancellation.js');
      for (const sessionId of tree.treeSessionIds) {
        try {
          submitInboundMessage({
            userId: ctx.userId,
            toSessionId: sessionId,
            fromRoleLayer: 'system',
            messageType: 'cancel_signal',
            payload: { reason: args.reason, handoffId: args.handoffId, requestedBy: 'reception' },
          });
        } catch (err) {
          console.warn(
            `[cancel_downstream] cancel_signal 注入失败（${sessionId}）：${err instanceof Error ? err.message : String(err)}`,
          );
        }
        try {
          await stopAllInFlightStreamRequestsForSession({ sessionId, userId: ctx.userId });
        } catch (err) {
          console.warn(
            `[cancel_downstream] 停流失败（${sessionId}）：${err instanceof Error ? err.message : String(err)}`,
          );
        }
        try {
          setSubstate({ sessionId, substate: 'cancelled', userId: ctx.userId });
        } catch (err) {
          console.warn(
            `[cancel_downstream] setSubstate('cancelled') 失败（${sessionId}）：${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    } else {
      // 子树解析失败（极少见）：至少给直接目标 session 发 cancel_signal 兜底。
      submitInboundMessage({
        userId: ctx.userId,
        toSessionId: handoff.to_session_id,
        fromRoleLayer: 'system',
        messageType: 'cancel_signal',
        payload: { reason: args.reason, handoffId: args.handoffId, requestedBy: 'reception' },
      });
    }

    // 审计：取消是跨层的重要写操作，记录到 team_audit_logs 以便回溯（谁、取消了
    // 哪个 handoff、级联了多少、为什么）。走规范的 logTeamAudit（含保留裁剪 +
    // actor 字段），不直接拼 SQL，避免列漂移与表无界膨胀。失败不阻塞主流程。
    try {
      const { logTeamAudit } = await import('../../team/team-audit-store.js');
      logTeamAudit({
        action: 'handoff_control',
        actorUserId: ctx.userId,
        entityType: 'handoff',
        entityId: args.handoffId,
        sessionId: ctx.sessionId,
        summary: `cancel_downstream: ${args.handoffId.slice(0, 8)} 及下游 ${cancelledCount} 个`,
        detail: JSON.stringify({
          action: 'cancel',
          handoffId: args.handoffId,
          cascadeCancelledCount: cancelledCount,
          reason: args.reason,
          requestedBy: 'reception',
          callerSessionId: ctx.sessionId,
        }),
        userId: ctx.userId,
      });
    } catch (err) {
      console.warn(
        `[cancel_downstream] 审计日志写入失败（不阻塞）：${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return {
      ok: true,
      message: `已取消 handoff ${args.handoffId.slice(0, 8)} 及其下游子任务（共 ${cancelledCount} 个）。`,
      data: { cancelledCount },
    };
  },
});

/**
 * push_notification: b 层向用户推送任务进度通知（构思 §3B.3 推送模式）。
 */
registerInstruction({
  name: 'push_notification',
  ownerLayer: 'reception',
  description:
    '主动向用户推送任务进度（如"plan 已就绪"、"e/f/g 全部完成"）。仅用于汇报，不阻塞用户。',
  schema: z.object({
    text: z.string().min(1).max(2000).describe('推送内容（Markdown）'),
    priority: z.enum(['blocking', 'info', 'silent']).default('info'),
  }),
  handler: async (ctx, args): Promise<InstructionResult> => {
    const { appendSessionMessageV2 } = await import('../../message/message-v2-adapter.js');
    const prefix = args.priority === 'blocking' ? '🔴 ' : args.priority === 'info' ? '🟡 ' : '🟢 ';
    appendSessionMessageV2({
      sessionId: ctx.sessionId,
      userId: ctx.userId,
      role: 'assistant',
      agentId: 'interaction-agent',
      content: [{ type: 'text', text: `${prefix}${args.text}` }],
    });
    return { ok: true, message: '已推送通知。' };
  },
});

// ─── c: pm1 层指令 ─────────────────────────────────────────────────────────

/**
 * submit_artifact: c 层提交 spec/plan/tasks 产物。
 */
registerInstruction({
  name: 'submit_artifact',
  ownerLayer: 'pm1',
  description:
    '提交 spec / plan / tasks 产物到 artifacts 表。phase 必须是 spec / plan / tasks 之一。',
  schema: z.object({
    phase: z.enum(['spec', 'plan', 'tasks']).describe('产物阶段'),
    title: z.string().min(1).max(200),
    content: z.string().min(1).max(64000).describe('Markdown 内容'),
    parentArtifactId: z
      .string()
      .nullable()
      .optional()
      .describe('父 artifact id（plan 依赖 spec、tasks 依赖 plan）'),
    teamWorkspaceId: z.string().nullable().optional(),
  }),
  handler: async (ctx, args): Promise<InstructionResult> => {
    const id = randomUUID();
    sqliteRun(
      `INSERT INTO artifacts (
         id, session_id, user_id, type, title, content, version,
         phase, team_workspace_id, parent_artifact_id
       ) VALUES (?, ?, ?, 'markdown', ?, ?, 1, ?, ?, ?)`,
      [
        id,
        ctx.sessionId,
        ctx.userId,
        args.title,
        args.content,
        args.phase,
        args.teamWorkspaceId ?? null,
        args.parentArtifactId ?? null,
      ],
    );
    return {
      ok: true,
      message: `已提交 ${args.phase} artifact (id=${id.slice(0, 8)})`,
      data: { artifactId: id, phase: args.phase },
    };
  },
});

/**
 * request_clarification: c 层向用户请求澄清。注入 escalation_request 到 reception。
 */
registerInstruction({
  name: 'request_clarification',
  ownerLayer: 'pm1',
  description: '当 spec 中存在模糊需求时，向用户请求澄清。问题列表会被推到 b 接待层。',
  schema: z.object({
    questions: z
      .array(
        z.object({
          id: z.string().describe('问题唯一 id'),
          question: z.string().min(1).describe('问题正文'),
          context: z.string().optional().describe('问题相关的上下文'),
        }),
      )
      .min(1)
      .max(20),
    fromSessionId: z.string().describe('当前 c session 的 from_session_id（reception session）'),
  }),
  handler: async (ctx, args): Promise<InstructionResult> => {
    submitInboundMessage({
      userId: ctx.userId,
      toSessionId: args.fromSessionId,
      fromRoleLayer: 'pm1',
      messageType: 'escalation_request',
      payload: {
        fromLayer: 'pm1',
        fromSessionId: ctx.sessionId,
        ...(ctx.handoffId ? { handoffId: ctx.handoffId } : {}),
        reason: 'needs_clarification',
        questions: args.questions,
      },
    });
    return {
      ok: true,
      message: `已向接待层推送 ${args.questions.length} 个澄清问题。`,
    };
  },
});

// ─── d: pm2 层指令 ─────────────────────────────────────────────────────────

/**
 * dispatch_package: d 层为单个任务创建 d→executor / d→reviewer handoff。
 */
registerInstruction({
  name: 'dispatch_package',
  ownerLayer: 'pm2',
  description:
    '为单个任务创建派发包，指定 goal / context / 工具集 / 目标角色（executor 或 reviewer）。' +
    '调用前应已通过 constitution_check。',
  schema: z.object({
    goal: z.string().min(1).max(2000),
    context: z.string().max(8000).default(''),
    role: z.enum(['executor', 'reviewer']),
    toolsets: z.array(z.enum(TOOLSET_CATEGORIES)).min(1),
    taskId: z.string().describe('tasks.md 中的任务 id（如 T001）'),
    parallel: z.boolean().default(false),
    ownedPaths: z
      .array(z.string().min(1).max(400))
      .max(20)
      .optional()
      .describe('该任务明确负责的文件 / 模块路径；不传则从 goal 自动提取'),
    artifactRefs: z
      .object({
        specId: z.string().optional(),
        planId: z.string().optional(),
        tasksId: z.string().optional(),
      })
      .optional(),
  }),
  handler: async (ctx, args): Promise<InstructionResult> => {
    const handoff = createHandoff({
      userId: ctx.userId,
      fromSessionId: ctx.sessionId,
      fromRoleLayer: 'pm2',
      toRoleLayer: args.role,
      payload: {
        goal: args.goal,
        context: args.context,
        toolsets: args.toolsets,
        role: args.role,
        artifactRefs: args.artifactRefs ?? {},
        ownedPaths: args.ownedPaths ?? extractComparablePathsFromText(args.goal),
        taskProfile: inferTaskProfile({ title: args.goal, context: args.context }),
        taskMarkers: { taskId: args.taskId, parallel: args.parallel },
      },
    });
    publishHandoffEvent({
      type: 'handoff.created',
      record: handoff,
      payload: { orchestrator: 'instruction:dispatch_package', taskId: args.taskId },
    });
    return {
      ok: true,
      message: `已派发任务 ${args.taskId} 给 ${args.role}（handoff=${handoff.id.slice(0, 8)}）`,
      data: { handoffId: handoff.id, taskId: args.taskId },
    };
  },
});

/**
 * constitution_check: d 层结果记录（实际 LLM 调用在 pm2-runner 内部已处理）。
 * 这个指令让 LLM 主动声明检查结果并写入 audit log。
 */
registerInstruction({
  name: 'constitution_check',
  ownerLayer: 'pm2',
  description:
    '声明 Constitution Check 的结果（pass / fail）并附违反条款列表。失败应触发 escalate_to_user。',
  schema: z.object({
    pass: z.boolean(),
    violations: z.array(z.string()).default([]),
    planArtifactId: z.string().describe('被检查的 plan artifact id'),
  }),
  handler: async (ctx, args): Promise<InstructionResult> => {
    const violations = args.violations ?? [];
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
       VALUES (?, 'constitution_check', 'artifact', ?, ?, ?, ?, datetime('now'))`,
      [
        ctx.userId,
        args.planArtifactId,
        ctx.sessionId,
        `Constitution Check: ${args.pass ? 'PASS' : 'FAIL'} (${violations.length} 违反)`,
        JSON.stringify({ pass: args.pass, violations, sessionId: ctx.sessionId }),
      ],
    );
    return {
      ok: true,
      message: args.pass
        ? '已记录 Constitution Check 通过。'
        : `已记录 Constitution Check 失败：${violations.length} 项违反。`,
      data: { pass: args.pass, violationCount: violations.length },
    };
  },
});

/**
 * escalate_to_user: d 层升级到用户（escape hatch #1，跨层送 escalation_request 到 reception）。
 */
registerInstruction({
  name: 'escalate_to_user',
  ownerLayer: 'pm2',
  description: '当 Constitution Check 失败、review 反复失败、或遇到无法决策的情况时，升级到用户。',
  schema: z.object({
    reason: z.string().min(1).max(500),
    context: z.string().max(4000).optional(),
    fromSessionId: z.string().describe('当前 d session 的 from_session_id（pm1 session）'),
    receptionSessionId: z.string().describe('最终目标 reception session id（用户对话所在）'),
    suggestedActions: z.array(z.object({ label: z.string(), action: z.string() })).default([]),
  }),
  handler: async (ctx, args): Promise<InstructionResult> => {
    submitInboundMessage({
      userId: ctx.userId,
      toSessionId: args.receptionSessionId,
      fromRoleLayer: 'pm2',
      messageType: 'escalation_request',
      payload: {
        fromLayer: 'pm2',
        fromSessionId: ctx.sessionId,
        ...(ctx.handoffId ? { handoffId: ctx.handoffId } : {}),
        pm1SessionId: args.fromSessionId,
        reason: args.reason,
        context: args.context ?? '',
        suggestedActions: args.suggestedActions,
      },
    });
    return { ok: true, message: '已升级到用户。' };
  },
});

/**
 * quality_review: d 层在 e/f/g 全部完成后做综合质量评审（声明结果）。
 */
registerInstruction({
  name: 'quality_review',
  ownerLayer: 'pm2',
  description: '所有 executor/reviewer 完成后，声明综合质量评审结果。',
  schema: z.object({
    passCount: z.number().int().nonnegative(),
    failCount: z.number().int().nonnegative(),
    summary: z.string().min(1).max(4000),
    decision: z.enum(['accept', 'request_retry', 'escalate']),
  }),
  handler: async (ctx, args): Promise<InstructionResult> => {
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
       VALUES (?, 'quality_review', 'session', ?, ?, ?, ?, datetime('now'))`,
      [
        ctx.userId,
        ctx.sessionId,
        ctx.sessionId,
        `Quality review: ${args.decision} (${args.passCount} pass / ${args.failCount} fail)`,
        JSON.stringify(args),
      ],
    );
    return {
      ok: true,
      message: `已记录质量评审：${args.decision}`,
      data: { decision: args.decision },
    };
  },
});

// ─── e/f/g: executor / reviewer 共享指令 ────────────────────────────────────

/**
 * report_progress: 执行层向 b 层推送进度（escape hatch #2）。
 */
function makeReportProgress(ownerLayer: 'executor' | 'reviewer'): void {
  registerInstruction({
    name: 'report_progress',
    ownerLayer,
    description:
      '向 b 接待层推送进度更新（仅 substate + 简短描述，不携带业务上下文）。' +
      '用于"3/8 task 完成"这类汇报。',
    schema: z.object({
      receptionSessionId: z.string().describe('最终接待 session id'),
      progressText: z.string().min(1).max(500),
      percent: z.number().min(0).max(100).optional(),
    }),
    handler: async (ctx, args): Promise<InstructionResult> => {
      submitInboundMessage({
        userId: ctx.userId,
        toSessionId: args.receptionSessionId,
        fromRoleLayer: ownerLayer,
        messageType: 'progress_report',
        payload: {
          fromLayer: ownerLayer,
          fromSessionId: ctx.sessionId,
          ...(ctx.handoffId ? { handoffId: ctx.handoffId } : {}),
          progressText: args.progressText,
          ...(args.percent !== undefined ? { percent: args.percent } : {}),
        },
      });
      return { ok: true, message: '已推送进度。' };
    },
  });
}

/**
 * mark_completed: 执行层 / 评审层 / pm1 / pm2 自我标记完成。
 * 实际 completeHandoff 由 watcher 兜底；这里写 substate + 自报进度。
 */
function makeMarkCompleted(ownerLayer: 'pm1' | 'pm2' | 'executor' | 'reviewer'): void {
  registerInstruction({
    name: 'mark_completed',
    ownerLayer,
    description:
      '声明本次工作已完成。layer 终态 substate=completed。watcher 会自动 completeHandoff。',
    schema: z.object({
      summary: z.string().max(2000).optional().describe('完成摘要'),
    }),
    handler: async (ctx, args): Promise<InstructionResult> => {
      setSubstate({
        sessionId: ctx.sessionId,
        substate: 'completed',
        userId: ctx.userId,
        roleLayer: ownerLayer,
      });
      if (args.summary && args.summary.length > 0) {
        publishTeamEvent({
          type: 'session.substate.changed',
          sessionId: ctx.sessionId,
          taskId: ctx.handoffId ?? ctx.sessionId,
          layer: ownerLayer,
          timestamp: Date.now(),
          userId: ctx.userId,
          payload: { substate: 'completed', summary: args.summary },
        });
      }
      return { ok: true, message: '已标记完成。' };
    },
  });
}

/**
 * mark_failed: 执行层 / 评审层 / pm1 / pm2 自我标记失败。
 */
function makeMarkFailed(ownerLayer: 'pm1' | 'pm2' | 'executor' | 'reviewer'): void {
  registerInstruction({
    name: 'mark_failed',
    ownerLayer,
    description: '声明本次工作失败。watcher catch 会自动 failHandoff + 写 audit log。',
    schema: z.object({
      reason: z.string().min(1).max(2000),
    }),
    handler: async (ctx, args): Promise<InstructionResult> => {
      setSubstate({
        sessionId: ctx.sessionId,
        substate: 'failed',
        userId: ctx.userId,
        roleLayer: ownerLayer,
      });
      // 抛错让上游 watcher catch 接管 failHandoff；这里只更新 substate
      // 不直接 throw 因为这会破坏 instruction 的"软拒绝"语义；返回 ok=true 让 LLM 知道已记录
      return {
        ok: true,
        message: `已标记失败：${args.reason}`,
        data: { reason: args.reason },
      };
    },
  });
}

/**
 * submit_patch: executor 提交代码 patch artifact（过程产物，不单独构成完成证据）。
 */
registerInstruction({
  name: 'submit_patch',
  ownerLayer: 'executor',
  description:
    'executor 提交一份代码 patch（结构化输出）作为 artifact。phase=patch 或 implementation。' +
    '注意：这只是过程产物；任务完成必须再调用 submit_execution_result。',
  schema: z.object({
    phase: z.enum(['patch', 'implementation']).default('patch'),
    title: z.string().min(1).max(200),
    content: z.string().min(1).max(128000),
    teamWorkspaceId: z.string().nullable().optional(),
  }),
  handler: async (ctx, args): Promise<InstructionResult> => {
    const id = randomUUID();
    sqliteRun(
      `INSERT INTO artifacts (
         id, session_id, user_id, type, title, content, version,
         phase, team_workspace_id, parent_artifact_id
       ) VALUES (?, ?, ?, 'markdown', ?, ?, 1, ?, ?, NULL)`,
      [
        id,
        ctx.sessionId,
        ctx.userId,
        args.title,
        args.content,
        args.phase,
        args.teamWorkspaceId ?? null,
      ],
    );
    return {
      ok: true,
      message: `已提交 ${args.phase} artifact (id=${id.slice(0, 8)})。完成任务请继续调用 submit_execution_result。`,
      data: { artifactId: id, phase: args.phase },
    };
  },
});

/**
 * submit_execution_result: executor 完成硬契约。
 * 写入 handoff result_json（protocol=submit_execution_result）+ implementation artifact。
 */
registerInstruction({
  name: 'submit_execution_result',
  ownerLayer: 'executor',
  description:
    '【必须】executor 提交结构化执行结果。没有调用本工具，runner 不会把任务视为合法完成。' +
    '优先提交 taskId、status、changedFiles、checklist（逐项 pass/fail/blocked + evidence）、summary、verification；' +
    '至少提供 summary 或 content 的简要总结，缺失的任务字段会从当前 handoff 归一化。',
  schema: submitExecutionResultSchema,
  handler: async (ctx, args): Promise<InstructionResult> => {
    const handoff = resolveActiveHandoffForSession(ctx.sessionId, ctx.userId, ctx.handoffId);
    if (!handoff) {
      return {
        ok: false,
        errorCode: 'handoff-not-found',
        message: '找不到当前 session 对应的运行中 handoff，无法写入执行结果。',
      };
    }

    const payload = parseJsonObject(handoff.payload_json);
    const expectedTaskId = readTaskIdFromPayload(payload);
    if (args.taskId && expectedTaskId && expectedTaskId !== args.taskId) {
      return {
        ok: false,
        errorCode: 'task-id-mismatch',
        message: `taskId 不匹配：期望 ${expectedTaskId}，实际 ${args.taskId}`,
      };
    }

    const normalized = normalizeExecutionResult(args, expectedTaskId ?? undefined);
    const { changedFiles, verification, checklist, status, summary, taskId, blockedReason } =
      normalized;
    const ownedPaths = readOwnedPathsFromPayload(payload);
    const outOfScope = findOutOfScopePaths({
      changedFiles,
      ownedPaths,
    });
    if (outOfScope.length > 0) {
      return {
        ok: false,
        errorCode: 'owned-paths-violation',
        message: `changedFiles 超出 ownedPaths：${outOfScope.slice(0, 5).join(', ')}`,
        data: { outOfScope },
      };
    }

    if (status === 'completed') {
      const failed = checklist.filter((item) => item.status !== 'pass');
      if (failed.length > 0) {
        return {
          ok: false,
          errorCode: 'checklist-not-all-pass',
          message: `status=completed 时 checklist 不得含 fail/blocked：${failed
            .map((item) => item.id)
            .join(', ')}`,
        };
      }
    }

    if (status === 'blocked' && !blockedReason) {
      return {
        ok: false,
        errorCode: 'blocked-reason-required',
        message: 'status=blocked 时必须提供 blockedReason。',
      };
    }

    const failedItems = checklist
      .filter((item) => item.status === 'fail' || item.status === 'blocked')
      .map((item) => item.id);

    const artifactId = randomUUID();
    const artifactBody = [
      `# Execution Result`,
      '',
      `**taskId**: ${taskId}`,
      `**status**: ${status}`,
      '',
      '## Summary',
      summary,
      '',
      '## Changed Files',
      ...(changedFiles.length > 0 ? changedFiles.map((file) => `- ${file}`) : ['- (none)']),
      '',
      '## Checklist',
      ...checklist.map((item) => `- [${item.status}] ${item.id}: ${item.evidence}`),
      '',
      '## Verification',
      ...(verification.length > 0 ? verification.map((step) => `- ${step}`) : ['- (none)']),
      ...(blockedReason ? ['', `## Blocked Reason`, blockedReason] : []),
    ].join('\n');

    sqliteRun(
      `INSERT INTO artifacts (
         id, session_id, user_id, type, title, content, version,
         phase, team_workspace_id, parent_artifact_id
       ) VALUES (?, ?, ?, 'markdown', ?, ?, 1, 'implementation', ?, NULL)`,
      [
        artifactId,
        ctx.sessionId,
        ctx.userId,
        `execution-result:${taskId}`,
        artifactBody,
        typeof payload?.['teamWorkspaceId'] === 'string' ? payload['teamWorkspaceId'] : null,
      ],
    );

    const resultJson = {
      protocol: SUBMIT_EXECUTION_RESULT_PROTOCOL,
      role: 'executor',
      taskId,
      status,
      changedFiles,
      checklist,
      failedItems,
      summary,
      verification,
      blockedReason: blockedReason ?? null,
      artifactId,
      submittedAt: new Date().toISOString(),
    };
    sqliteRun(
      `UPDATE handoff_records
          SET result_json = ?,
              updated_at = datetime('now')
        WHERE id = ?`,
      [JSON.stringify(resultJson), handoff.id],
    );

    setSubstate({
      sessionId: ctx.sessionId,
      substate: status === 'completed' ? 'completed' : 'failed',
      userId: ctx.userId,
      roleLayer: 'executor',
    });

    return {
      ok: true,
      message: `已提交执行结果 protocol=${SUBMIT_EXECUTION_RESULT_PROTOCOL} status=${status} failedItems=${failedItems.length}`,
      data: {
        handoffId: handoff.id,
        artifactId,
        protocol: SUBMIT_EXECUTION_RESULT_PROTOCOL,
        failedItems,
      },
    };
  },
});

/**
 * submit_review: reviewer 提交结构化评审报告（硬契约）。
 * 兼容旧 decision/title/content；推荐提供 verdict + items。
 */
registerInstruction({
  name: 'submit_review',
  ownerLayer: 'reviewer',
  description:
    '【必须】reviewer 提交评审结果。优先提供 verdict + items（checklist 级 pass/fail）；' +
    '若无法完整填写，至少提供 overallReason 或 content 的简要结论，系统会归一化后交给校验层检查。',
  schema: submitReviewReportSchema,
  handler: async (ctx, args): Promise<InstructionResult> => {
    const handoff = resolveActiveHandoffForSession(ctx.sessionId, ctx.userId, ctx.handoffId);
    if (!handoff) {
      return {
        ok: false,
        errorCode: 'handoff-not-found',
        message: '找不到当前 session 对应的运行中 handoff，无法写入评审结果。',
      };
    }

    const payload = parseJsonObject(handoff.payload_json);
    const expectedTaskId = readTaskIdFromPayload(payload);
    const taskId = args.taskId ?? expectedTaskId ?? 'unknown';
    if (args.taskId && expectedTaskId && args.taskId !== expectedTaskId) {
      return {
        ok: false,
        errorCode: 'task-id-mismatch',
        message: `taskId 不匹配：期望 ${expectedTaskId}，实际 ${args.taskId}`,
      };
    }

    const verdict = normalizeReviewVerdict(args);
    const items =
      args.items && args.items.length > 0
        ? args.items
        : [
            {
              id: taskId,
              status: verdict === 'pass' ? ('pass' as const) : ('fail' as const),
              reason: args.overallReason ?? args.content?.slice(0, 500),
            },
          ];
    const failedItems = items.filter((item) => item.status === 'fail').map((item) => item.id);

    if (verdict === 'pass' && failedItems.length > 0) {
      return {
        ok: false,
        errorCode: 'verdict-items-mismatch',
        message: `verdict/decision=pass 时 items 不得含 fail：${failedItems.join(', ')}`,
      };
    }

    const title = args.title ?? `review-report:${taskId}`;
    const content =
      args.content ??
      [
        `# Review Report`,
        '',
        `**taskId**: ${taskId}`,
        `**verdict**: ${verdict}`,
        '',
        '## Items',
        ...items.map(
          (item) =>
            `- [${item.status}] ${item.id}${item.reason ? `: ${item.reason}` : ''}${
              item.fileRefs?.length ? ` (${item.fileRefs.join(', ')})` : ''
            }`,
        ),
        ...(args.overallReason ? ['', '## Overall', args.overallReason] : []),
      ].join('\n');

    const artifactId = randomUUID();
    const teamWorkspaceId =
      args.teamWorkspaceId ??
      (typeof payload?.['teamWorkspaceId'] === 'string' ? payload['teamWorkspaceId'] : null);
    sqliteRun(
      `INSERT INTO artifacts (
         id, session_id, user_id, type, title, content, version,
         phase, team_workspace_id, parent_artifact_id
       ) VALUES (?, ?, ?, 'markdown', ?, ?, 1, 'review_report', ?, NULL)`,
      [artifactId, ctx.sessionId, ctx.userId, title, content, teamWorkspaceId],
    );

    const resultJson = {
      protocol: SUBMIT_REVIEW_REPORT_PROTOCOL,
      role: 'reviewer',
      taskId,
      verdict,
      decision: verdict,
      items,
      failedItems,
      overallReason: args.overallReason ?? null,
      summary: args.overallReason ?? content.slice(0, 500),
      artifactId,
      submittedAt: new Date().toISOString(),
    };
    sqliteRun(
      `UPDATE handoff_records
          SET result_json = ?,
              updated_at = datetime('now')
        WHERE id = ?`,
      [JSON.stringify(resultJson), handoff.id],
    );

    setSubstate({
      sessionId: ctx.sessionId,
      substate: 'completed',
      userId: ctx.userId,
      roleLayer: 'reviewer',
    });

    return {
      ok: true,
      message: `已提交评审报告 protocol=${SUBMIT_REVIEW_REPORT_PROTOCOL} verdict=${verdict} failedItems=${failedItems.length}`,
      data: {
        handoffId: handoff.id,
        artifactId,
        protocol: SUBMIT_REVIEW_REPORT_PROTOCOL,
        verdict,
        failedItems,
      },
    };
  },
});

// ─── helpers ────────────────────────────────────────────────────────────────

function resolveActiveHandoffForSession(
  sessionId: string,
  userId: string,
  handoffId?: string,
): { id: string; payload_json: string | null } | null {
  if (handoffId) {
    const byId = sqliteGet<{ id: string; payload_json: string | null }>(
      `SELECT id, payload_json FROM handoff_records
        WHERE id = ? AND user_id = ?
        LIMIT 1`,
      [handoffId, userId],
    );
    if (byId) return byId;
  }
  return (
    sqliteGet<{ id: string; payload_json: string | null }>(
      `SELECT id, payload_json FROM handoff_records
        WHERE to_session_id = ? AND user_id = ?
          AND state IN ('running', 'claimed')
        ORDER BY updated_at DESC
        LIMIT 1`,
      [sessionId, userId],
    ) ?? null
  );
}

function parseJsonObject(value: string | null | undefined): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function readTaskIdFromPayload(payload: Record<string, unknown> | null): string | null {
  if (!payload) return null;
  const markers = payload['taskMarkers'];
  if (typeof markers === 'object' && markers !== null && !Array.isArray(markers)) {
    const taskId = (markers as Record<string, unknown>)['taskId'];
    if (typeof taskId === 'string' && taskId.trim()) return taskId.trim();
  }
  if (typeof payload['taskId'] === 'string' && payload['taskId'].trim()) {
    return payload['taskId'].trim();
  }
  return null;
}

function readOwnedPathsFromPayload(payload: Record<string, unknown> | null): string[] {
  if (!payload) return [];
  const raw = payload['ownedPaths'];
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

// ─── 注册多层共享指令 ───────────────────────────────────────────────────────

makeReportProgress('executor');
makeReportProgress('reviewer');

makeMarkCompleted('pm1');
makeMarkCompleted('pm2');
makeMarkCompleted('executor');
makeMarkCompleted('reviewer');

makeMarkFailed('pm1');
makeMarkFailed('pm2');
makeMarkFailed('executor');
makeMarkFailed('reviewer');
