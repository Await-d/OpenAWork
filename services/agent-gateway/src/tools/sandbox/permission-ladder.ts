/**
 * 权限阶梯域(261009-tool-sandbox 拆分 P1 / T-05)。
 *
 * 由 `tool-sandbox.ts` 原样搬出,行为不变:审批 / 待处理权限行查询、
 * 权限请求上下文构造、deny-first 阶梯判定(`ensurePermissionForTool` /
 * `gatePermissionDecision`)与 `permission.evaluate` 后置 hook。
 *
 * 不变量(deny-first):`auto-edit` / `yolo` 的免审批快捷分支只能在
 * 通配符 allow/deny 与作用域级 allow/deny 之后执行——这两档仅跳过 `ask`、
 * 永不放行被显式 `deny` 的调用。
 *
 * 依赖方向:`tool-sandbox.ts` → 本模块(单向)。
 */

import type { ToolCallRequest } from '@openAwork/agent-core';
import {
  AUTO_EDIT_EXCLUDED_TOOLS,
  AUTO_EDIT_PERMISSION_CATEGORIES,
  resolvePermissionCategory,
  resolveSessionPermissionMode,
} from '@openAwork/agent-core';
import { randomUUID } from 'node:crypto';
import { isBuiltinInstructionName } from '../../handoff/capability/layer-capabilities.js';
import { sqliteAll, sqliteGet, sqliteRun } from '../../infra/db.js';
import type {} from '../../mcp/mcp-server-authorization.js';
import { parseFlatMcpToolName } from '../../mcp/mcp-tool-naming.js';
import {
  approvalCoversScope,
  type PermissionApprovalCandidateRow,
} from '../../permission/permission-approval-match.js';
import { resolvePermissionRequestTimeoutMs } from '../../permission/permission-contract.js';
import { findMatchingPermissionGrant } from '../../permission/permission-grants-store.js';
import {
  evaluatePermissionRules,
  loadWorkspacePermissionRules,
  type PermissionAction,
  type PermissionRule,
} from '../../permission/permission-rules.js';
import { type PermissionRequestContext } from '../../permission/tool-permission-derivers.js';
import {
  dispatchPermissionEvaluate,
  type PermissionEvaluateEvent,
} from '../../runtime/plugin-host.js';
import { createPermissionAskedEvent } from '../../session/session-permission-events.js';
import { createQuestionAskedEvent } from '../../session/session-question-events.js';
import { publishSessionRunEvent } from '../../session/session-run-events.js';
import { shouldAutoApproveToolForSessionMetadata } from '../../session/session-tool-visibility.js';
import {
  getSessionWorkspaceRoot,
  hasWorkspacePermanentPermission,
} from '../../workspace/workspace-safety.js';
import { buildPermissionRequestContext } from './context.js';
import {
  getSessionMetadata,
  getSessionOwnerUserId,
  getSessionRoleContext,
  isBackgroundAutoApprovedTeamSession,
  isReceptionReadOnlyToolAutoApproved,
  isUnattendedSessionDelegationAutoApproved,
  type BlockedToolCallPayload,
  type PermissionApprovalRow,
  type PermissionPendingRow,
  type PermissionRequestPayload,
  type PermissionState,
  type QuestionPendingRow,
  type SandboxExecutionContext,
} from './session-context.js';
import { DEFAULT_PERMISSION_RULES } from './whitelist.js';

function findApprovedPermission(
  sessionId: string,
  toolName: string,
  scope: string,
): PermissionApprovalRow | null {
  const userId = getSessionOwnerUserId(sessionId);
  // User-scoped durable permanent grants first: these survive the granting
  // session (unlike the session-owned `permission_requests` rows below), so a
  // brand-new session of the same user is still auto-approved.
  if (userId) {
    const grant = findMatchingPermissionGrant(userId, toolName, scope);
    if (grant) {
      return { id: grant.id, decision: 'permanent' };
    }
  }
  // Pull every still-approved row for this category visible to this session.
  // `findApprovedPermission` runs once per tool call; the per-session row
  // count is bounded by user prompts so a full scan + JS-side wildcard
  // matching is cheaper and safer than encoding glob semantics in SQL.
  const candidates = sqliteAll<PermissionApprovalCandidateRow>(
    `SELECT pr.id, pr.decision, pr.scope, pr.always_json
     FROM permission_requests pr
     JOIN sessions s ON s.id = pr.session_id
     WHERE pr.tool_name = ?
       AND pr.status = 'approved'
       AND (
         (pr.session_id = ? AND pr.decision IN ('once', 'session'))
         OR (s.user_id = ? AND pr.decision = 'permanent')
       )
     ORDER BY pr.updated_at DESC, pr.created_at DESC`,
    [toolName, sessionId, userId],
  );
  for (const row of candidates) {
    if (approvalCoversScope(row, scope)) {
      return { id: row.id, decision: row.decision };
    }
  }

  // Session lineage: inherit session-level approvals from parent session.
  // Mirrors opencode's session lineage auto-accept behavior.
  const parentRow = sqliteGet<{ parent_id: string }>(
    `SELECT parent_id FROM sessions WHERE id = ? AND parent_id IS NOT NULL`,
    [sessionId],
  );
  if (parentRow?.parent_id) {
    const parentCandidates = sqliteAll<PermissionApprovalCandidateRow>(
      `SELECT pr.id, pr.decision, pr.scope, pr.always_json
       FROM permission_requests pr
       WHERE pr.tool_name = ?
         AND pr.session_id = ?
         AND pr.status = 'approved'
         AND pr.decision = 'session'
       ORDER BY pr.updated_at DESC, pr.created_at DESC`,
      [toolName, parentRow.parent_id],
    );
    for (const row of parentCandidates) {
      if (approvalCoversScope(row, scope)) {
        return { id: row.id, decision: row.decision };
      }
    }
  }

  return null;
}

function findPendingPermission(sessionId: string, toolName: string, scope: string): string | null {
  const pending = sqliteGet<PermissionPendingRow>(
    `SELECT id
     FROM permission_requests
     WHERE session_id = ? AND tool_name = ? AND scope = ? AND status = 'pending'
     ORDER BY created_at DESC
     LIMIT 1`,
    [sessionId, toolName, scope],
  );
  return pending?.id ?? null;
}

function updatePendingPermissionPayload(
  requestId: string,
  payload: PermissionRequestPayload,
): void {
  sqliteRun(
    `UPDATE permission_requests
     SET request_payload_json = ?, updated_at = datetime('now')
     WHERE id = ? AND status = 'pending'`,
    [JSON.stringify(payload), requestId],
  );
}

/**
 * Merge the batch of calls blocked by a permission pause into the owning
 * pending request payload, so the approval resume can run all of them (in
 * `tool_use` order) instead of only the single call that created the request.
 *
 * Idempotent: entries are deduped by `toolCallId`, and the first entry is
 * mirrored onto the legacy `toolCallId` / `rawInput` / `toolName` fields.
 */
export function recordBlockedToolCallsForPendingRequest(
  requestId: string,
  calls: BlockedToolCallPayload[],
): void {
  if (calls.length === 0) return;
  const row = sqliteGet<{ request_payload_json: string | null }>(
    `SELECT request_payload_json FROM permission_requests WHERE id = ? AND status = 'pending' LIMIT 1`,
    [requestId],
  );
  if (!row?.request_payload_json) return;

  let payload: PermissionRequestPayload;
  try {
    payload = JSON.parse(row.request_payload_json) as PermissionRequestPayload;
  } catch {
    return;
  }

  const merged = new Map<string, BlockedToolCallPayload>();
  for (const call of payload.blockedToolCalls ?? []) merged.set(call.toolCallId, call);
  for (const call of calls) merged.set(call.toolCallId, call);
  const blockedToolCalls = [...merged.values()];
  const first = blockedToolCalls[0];
  if (!first) return;

  updatePendingPermissionPayload(requestId, {
    ...payload,
    toolCallId: first.toolCallId,
    toolName: first.toolName,
    rawInput: first.rawInput,
    blockedToolCalls,
  });
}

function createPendingPermissionRequest(
  sessionId: string,
  toolName: string,
  context: PermissionRequestContext,
  payload?: PermissionRequestPayload,
): string {
  const requestId = randomUUID();
  const expiresAt = (() => {
    const timeoutMs = resolvePermissionRequestTimeoutMs();
    return typeof timeoutMs === 'number' ? Date.now() + timeoutMs : null;
  })();
  sqliteRun(
    `INSERT INTO permission_requests
     (id, session_id, tool_name, scope, reason, risk_level, preview_action, request_payload_json, expires_at, always_json, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
    [
      requestId,
      sessionId,
      toolName,
      context.scope,
      context.reason,
      context.riskLevel,
      context.previewAction,
      payload ? JSON.stringify(payload) : null,
      expiresAt,
      JSON.stringify(context.always),
    ],
  );
  publishSessionRunEvent(
    sessionId,
    createPermissionAskedEvent({
      requestId,
      toolName,
      scope: context.scope,
      reason: context.reason,
      riskLevel: context.riskLevel,
      previewAction: context.previewAction,
      ...(context.always && context.always.length > 0 ? { always: context.always } : {}),
    }),
    payload ? { clientRequestId: payload.clientRequestId } : undefined,
  );
  return requestId;
}

export function findPendingQuestionRequest(sessionId: string, title: string): string | null {
  const pending = sqliteGet<QuestionPendingRow>(
    `SELECT id
     FROM question_requests
     WHERE session_id = ? AND title = ? AND status = 'pending'
     ORDER BY created_at DESC
     LIMIT 1`,
    [sessionId, title],
  );
  return pending?.id ?? null;
}

export function updatePendingQuestionPayload(
  requestId: string,
  payload: PermissionRequestPayload,
): void {
  sqliteRun(
    `UPDATE question_requests
     SET request_payload_json = ?, updated_at = datetime('now')
     WHERE id = ? AND status = 'pending'`,
    [JSON.stringify(payload), requestId],
  );
}

export function createPendingQuestionRequest(input: {
  sessionId: string;
  userId: string;
  toolName?: string;
  title: string;
  questionsJson: string;
  payload?: PermissionRequestPayload;
}): string {
  const requestId = randomUUID();
  const toolName = input.toolName ?? 'question';
  sqliteRun(
    `INSERT INTO question_requests
      (id, session_id, user_id, tool_name, title, questions_json, request_payload_json, expires_at, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
    [
      requestId,
      input.sessionId,
      input.userId,
      toolName,
      input.title,
      input.questionsJson,
      input.payload ? JSON.stringify(input.payload) : null,
      null,
    ],
  );
  publishSessionRunEvent(
    input.sessionId,
    createQuestionAskedEvent({
      requestId,
      title: input.title,
      toolName,
    }),
    input.payload ? { clientRequestId: input.payload.clientRequestId } : undefined,
  );
  return requestId;
}

export function consumeOncePermission(requestId: string): void {
  sqliteRun(
    `UPDATE permission_requests
     SET status = 'consumed', updated_at = datetime('now')
     WHERE id = ? AND status = 'approved' AND decision = 'once'`,
    [requestId],
  );
}

function resolveEffectivePermissionCategory(toolName: string): string {
  // 内置团队指令（reply_direct / route_to_orchestrate / dispatch_package ...）不是
  // 普通工具：它们由 apply-team-layer-tools 按层注入，真正的「能不能调」由下游
  // invokeInstruction → assertInstructionOwnedByLayer 按层把关（与本文件 whitelist /
  // session-enabled 门控处的同款豁免一致）。这里返回原始工具名，使其命中
  // DEFAULT_PERMISSION_RULES 的通配符 allow，保持 fail-closed 改造前的语义；
  // 否则未登记的指令会落到 custom(ask)，后台 team 会话无人可审批而被卡死。
  if (isBuiltinInstructionName(toolName)) return toolName;
  // Map raw tool name to permission category (e.g. 'multi_edit' → 'edit').
  return parseFlatMcpToolName(toolName) ? 'mcp_call' : resolvePermissionCategory(toolName);
}

function resolveEffectivePermissionAction(
  toolName: string,
  scope: string,
  workspaceRules: PermissionRule[],
): PermissionAction {
  // Evaluate default rules first, then workspace rules on top (last-match-wins).
  const category = resolveEffectivePermissionCategory(toolName);
  return evaluatePermissionRules(category, scope, DEFAULT_PERMISSION_RULES, workspaceRules).action;
}

/**
 * `permission.evaluate`（deny-only 后置裁决）的输入：内置权限阶梯最终结论的描述。
 *
 * `scope` 取与本次裁决最相关的资源——工具级通配符分支用 `'*'`，其余分支用派生的
 * 真实作用域（bash 命令串、工作区相对路径等）；`decision` 是进入 hook 时的内置
 * 结论：`allow` = 放行 / 免审批，`ask` = 将进入人工审批。
 */
interface PermissionEvaluationInput {
  sessionId: string;
  toolName: string;
  category: string;
  scope: string;
  decision: 'allow' | 'ask';
}

/**
 * 运行 `permission.evaluate` 后置裁决；返回非 null 表示本次调用被插件拒绝。
 *
 * 只有把 `effect` 设为 `'deny'` 才会被采纳，其它取值（包括试图改成 allow 的）
 * 一律忽略——插件只能把内置结论降级为拒绝，永远无法授权，deny-first 不变量
 * （显式 deny 优先于 yolo / auto-edit 等档位快捷分支）因此仍然成立。
 * 插件抛错由 `dispatchHook` 记录 warn 后继续，不会破坏本次请求。
 */
async function runPermissionEvaluateHook(
  input: PermissionEvaluationInput,
): Promise<{ kind: 'denied'; reason: string } | null> {
  const event: PermissionEvaluateEvent = {
    sessionID: input.sessionId,
    toolName: input.toolName,
    permission: input.category,
    scope: input.scope,
    decision: input.decision,
  };
  await dispatchPermissionEvaluate(event);
  if (event.effect !== 'deny') return null;
  const message = typeof event.message === 'string' ? event.message.trim() : '';
  return {
    kind: 'denied',
    reason: message || `工具 "${input.toolName}" 被插件权限策略（permission.evaluate）拒绝。`,
  };
}

/**
 * 先跑 deny-only 后置裁决，未被否决时保留内置结论。
 *
 * 所有「放行 / 免审批」分支都必须经过这里：hook 在规则、档位快捷分支
 * （yolo / auto-edit / 后台 team / reception）、渠道策略、workspace 永久规则、
 * saved approvals（含会话批准与父会话继承）全部判定之后运行，因此插件可以否决
 * 这些分支，但无法放行任何已被拒绝或未获批的调用。
 */
async function gatePermissionDecision(
  input: PermissionEvaluationInput,
  state: PermissionState,
): Promise<PermissionState> {
  return (await runPermissionEvaluateHook(input)) ?? state;
}

export async function ensurePermissionForTool(
  sessionId: string,
  request: ToolCallRequest,
  observability: PermissionRequestPayload['observability'] | undefined,
  executionContext?: SandboxExecutionContext,
  sshManaged = false,
): Promise<PermissionState> {
  // Rule engine: evaluate default rules + workspace rules (last-match-wins).
  // Users override defaults via .openawork.permissions.json.
  const sessionMetadata = getSessionMetadata(sessionId);
  const isTaskCreatedSession = sessionMetadata.createdByTool === 'task';
  const explicitWorkingDirectory =
    typeof sessionMetadata.workingDirectory === 'string'
      ? String(sessionMetadata.workingDirectory)
      : null;
  const workspaceRoot = explicitWorkingDirectory
    ? getSessionWorkspaceRoot(sessionId)
    : isTaskCreatedSession
      ? null
      : getSessionWorkspaceRoot(sessionId);
  const workspaceRules = workspaceRoot ? loadWorkspacePermissionRules(workspaceRoot) : [];

  // Use category ID for all permission lookup/storage so that tools in the
  // same category (e.g. edit, patch, workspace_review_revert → 'edit')
  // share a single approval and don't prompt the user repeatedly.
  const category = resolveEffectivePermissionCategory(request.toolName);

  // deny-only 后置裁决（permission.evaluate）的公共输入；各分支只补 scope / decision。
  const evaluationBase = {
    sessionId,
    toolName: request.toolName,
    category,
  };

  // Pre-check with wildcard scope: skip context building for globally allowed tools.
  const toolLevelAction = resolveEffectivePermissionAction(request.toolName, '*', workspaceRules);
  if (toolLevelAction === 'allow') {
    return gatePermissionDecision(
      { ...evaluationBase, scope: '*', decision: 'allow' },
      { kind: 'not_needed' },
    );
  }
  if (toolLevelAction === 'deny') {
    // 已拒绝的早退路径不再调用 hook（插件只能降级，无法改变 deny）。
    return {
      kind: 'denied',
      reason: `工具 "${request.toolName}" 被权限规则禁止。`,
    };
  }

  // 'ask' → build permission context for scope-specific evaluation.
  const context = buildPermissionRequestContext(sessionId, request, sshManaged);
  if (!context) {
    return gatePermissionDecision(
      { ...evaluationBase, scope: '*', decision: 'allow' },
      { kind: 'not_needed' },
    );
  }

  // Re-evaluate with the actual scope for fine-grained rules.
  const scopedAction = resolveEffectivePermissionAction(
    request.toolName,
    context.scope,
    workspaceRules,
  );
  if (scopedAction === 'allow') {
    return gatePermissionDecision(
      { ...evaluationBase, scope: context.scope, decision: 'allow' },
      {
        kind: 'approved',
        requestId: 'workspace-rule',
        decision: 'permanent',
      },
    );
  }
  if (scopedAction === 'deny') {
    return {
      kind: 'denied',
      reason: `工具 "${request.toolName}" 在作用域 "${context.scope}" 被权限规则禁止。`,
    };
  }

  // Team session 自动批准修改类工具：
  // 后台运行的 team 成员（pm1/pm2/executor/reviewer）无法与用户交互审批，
  // 且父 session 已通过权限检查——子 session 继承信任链。
  // 同样适用于 yolo 档位的 session（用户已显式授权免审批）。
  //
  // 权限阶梯不变量：此免审批快捷分支只会在通配符 allow/deny 与作用域级
  // allow/deny 评估之后执行——显式 deny 已在上面两个分支提前返回，
  // 因此 auto-edit / yolo 只能跳过 ask，永远无法放行被 deny 的调用。
  const permissionMode = resolveSessionPermissionMode(sessionMetadata);
  const sessionRoleContext = getSessionRoleContext(sessionId);
  if (
    permissionMode === 'yolo' ||
    isBackgroundAutoApprovedTeamSession(sessionRoleContext) ||
    isUnattendedSessionDelegationAutoApproved(sessionMetadata, category) ||
    isReceptionReadOnlyToolAutoApproved(sessionRoleContext, request.toolName)
  ) {
    return gatePermissionDecision(
      { ...evaluationBase, scope: context.scope, decision: 'allow' },
      { kind: 'not_needed' },
    );
  }

  // auto-edit 档位：仅自动放行文件编辑 / 写入类别（edit、write）。
  // bash、MCP、浏览器、桌面控制等其余类别仍走 ask；
  // 回滚类工具（AUTO_EDIT_EXCLUDED_TOOLS）保持人工确认。
  if (
    permissionMode === 'auto-edit' &&
    AUTO_EDIT_PERMISSION_CATEGORIES.has(category) &&
    !AUTO_EDIT_EXCLUDED_TOOLS.has(request.toolName)
  ) {
    return gatePermissionDecision(
      { ...evaluationBase, scope: context.scope, decision: 'allow' },
      { kind: 'not_needed' },
    );
  }

  if (shouldAutoApproveToolForSessionMetadata(request.toolName, sessionMetadata)) {
    return gatePermissionDecision(
      { ...evaluationBase, scope: context.scope, decision: 'allow' },
      {
        kind: 'approved',
        requestId: 'channel-policy',
        decision: 'session',
      },
    );
  }

  if (workspaceRoot && hasWorkspacePermanentPermission(sessionId, category, context.scope)) {
    return gatePermissionDecision(
      { ...evaluationBase, scope: context.scope, decision: 'allow' },
      {
        kind: 'approved',
        requestId: 'workspace-policy',
        decision: 'permanent',
      },
    );
  }

  const requestPayload =
    executionContext?.clientRequestId &&
    executionContext.requestData &&
    typeof executionContext.nextRound === 'number'
      ? {
          clientRequestId: executionContext.clientRequestId,
          nextRound: executionContext.nextRound,
          requestData: executionContext.requestData,
          toolCallId: request.toolCallId,
          rawInput: request.rawInput as Record<string, unknown>,
          ...(observability ? { observability } : {}),
        }
      : undefined;

  const approved = findApprovedPermission(sessionId, category, context.scope);
  if (approved) {
    return gatePermissionDecision(
      { ...evaluationBase, scope: context.scope, decision: 'allow' },
      {
        kind: 'approved',
        requestId: approved.id,
        decision: approved.decision,
      },
    );
  }

  // ask 阶段的最后一道裁决：必须先过 hook 再落 pending，否则被插件拒绝的调用
  // 会在 permission_requests 里留下一个无人应答的 pending 记录。
  const veto = await runPermissionEvaluateHook({
    ...evaluationBase,
    scope: context.scope,
    decision: 'ask',
  });
  if (veto) return veto;

  const pendingRequestId = findPendingPermission(sessionId, category, context.scope);
  if (pendingRequestId) {
    if (requestPayload) {
      updatePendingPermissionPayload(pendingRequestId, requestPayload);
    }
    return { kind: 'pending', requestId: pendingRequestId, created: false };
  }

  return {
    kind: 'pending',
    requestId: createPendingPermissionRequest(sessionId, category, context, requestPayload),
    created: true,
  };
}
