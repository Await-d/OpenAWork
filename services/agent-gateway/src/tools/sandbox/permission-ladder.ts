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
  wildcardMatch,
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
import {
  PERMISSION_DECISION_REASONS,
  recordLadderPermissionDecision,
  type PermissionDecisionReason,
} from '../../session/permission-decision-log-store.js';
import {
  isChannelManagedSession,
  shouldAutoApproveToolForSessionMetadata,
} from '../../session/session-tool-visibility.js';
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

  const visited = new Set<string>([sessionId]);
  let currentSessionId = sessionId;
  while (userId) {
    const lineageRow = sqliteGet<{ parent_id: string | null }>(
      'SELECT parent_id FROM sessions WHERE id = ? AND user_id = ?',
      [currentSessionId, userId],
    );
    const metadata = getSessionMetadata(currentSessionId);
    // task 派生关系实际写在 metadata 中；parent_id 仅兼容旧会话。
    const parentSessionId =
      typeof metadata.parentSessionId === 'string' && metadata.parentSessionId.trim()
        ? metadata.parentSessionId.trim()
        : lineageRow?.parent_id;
    if (
      !parentSessionId ||
      visited.has(parentSessionId) ||
      getSessionOwnerUserId(parentSessionId) !== userId
    ) {
      break;
    }
    visited.add(parentSessionId);
    currentSessionId = parentSessionId;
    const parentCandidates = sqliteAll<PermissionApprovalCandidateRow>(
      `SELECT pr.id, pr.decision, pr.scope, pr.always_json
       FROM permission_requests pr
       WHERE pr.tool_name = ?
         AND pr.session_id = ?
         AND pr.status = 'approved'
         AND pr.decision = 'session'
       ORDER BY pr.updated_at DESC, pr.created_at DESC`,
      [toolName, parentSessionId],
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
 * Merge the batch of calls blocked by an interaction pause into the owning
 * pending request payload, so the resume can run all of them (in
 * `tool_use` order) instead of only the single call that created the request.
 *
 * Idempotent: entries are deduped by `toolCallId`, and the first entry is
 * mirrored onto legacy permission fields. Question fields keep the answered
 * tool's anchor instead of being replaced by a blocked sibling call.
 */
export function recordBlockedToolCallsForPendingRequest(
  requestId: string,
  calls: BlockedToolCallPayload[],
): void {
  if (calls.length === 0) return;
  const permissionRow = sqliteGet<{ request_payload_json: string | null }>(
    `SELECT request_payload_json FROM permission_requests WHERE id = ? AND status = 'pending' LIMIT 1`,
    [requestId],
  );
  const row =
    permissionRow ??
    sqliteGet<{ request_payload_json: string | null }>(
      `SELECT request_payload_json FROM question_requests WHERE id = ? AND status = 'pending' LIMIT 1`,
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

  if (!permissionRow) {
    updatePendingQuestionPayload(requestId, { ...payload, blockedToolCalls });
    return;
  }

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

  /**
   * 权限阶梯的**唯一记账出口**：每个 return 前都经此落一条审计行。
   *
   * 只记录、不裁决——`recordLadderPermissionDecision` 是 best-effort（写失败
   * 内部吞掉），绝不改变返回的权限结论，也不覆盖 session-extension / 渠道 /
   * team 后台 / 派生会话各自的独立授权门。审计的 reason 用可枚举词表，且自动
   * allow 一律不写成 `user_approved`（人工批准只由 `/permissions` 路由记录）。
   */
  const finish = (
    state: PermissionState,
    reason: PermissionDecisionReason,
    scope: string,
  ): PermissionState => {
    recordLadderPermissionDecision({
      sessionId,
      toolName: request.toolName,
      scope,
      outcome:
        state.kind === 'denied'
          ? 'denied'
          : state.kind === 'pending'
            ? 'pending'
            : state.kind === 'approved'
              ? 'approved'
              : 'not_needed',
      reason,
      requestId: state.kind === 'approved' || state.kind === 'pending' ? state.requestId : null,
      workspaceRoot: workspaceRoot ?? null,
    });
    return state;
  };

  // Pre-check with wildcard scope: skip context building for globally allowed tools.
  const toolLevelAction = resolveEffectivePermissionAction(request.toolName, '*', workspaceRules);
  if (toolLevelAction === 'deny') {
    // 已拒绝的早退路径不再调用 hook（插件只能降级，无法改变 deny）。
    return finish(
      {
        kind: 'denied',
        reason: `工具 "${request.toolName}" 被权限规则禁止。`,
      },
      PERMISSION_DECISION_REASONS.RULE_DENIED,
      '*',
    );
  }

  const isMcpCall = request.toolName === 'mcp_call' || !!parseFlatMcpToolName(request.toolName);
  const mcpContext = isMcpCall
    ? buildPermissionRequestContext(sessionId, request, sshManaged)
    : null;
  if (mcpContext?.denialReason) {
    // MCP flat/legacy 派生异常的前置拒绝：在任何 allow / saved approval 之前
    // 拦下，审计 reason 单列，避免被误读成规则拒绝。
    return finish(
      { kind: 'denied', reason: mcpContext.denialReason },
      PERMISSION_DECISION_REASONS.MCP_DENIED,
      '*',
    );
  }
  if (toolLevelAction === 'allow') {
    const state = await gatePermissionDecision(
      { ...evaluationBase, scope: '*', decision: 'allow' },
      { kind: 'not_needed' },
    );
    return finish(state, reasonByState(state, PERMISSION_DECISION_REASONS.RULE_ALLOWED), '*');
  }

  // 'ask' → build permission context for scope-specific evaluation.
  const context = isMcpCall
    ? mcpContext
    : buildPermissionRequestContext(sessionId, request, sshManaged);
  if (context?.denialReason) {
    return finish(
      { kind: 'denied', reason: context.denialReason },
      PERMISSION_DECISION_REASONS.MCP_DENIED,
      '*',
    );
  }
  if (!context) {
    // Reached only when the tool-level rule did NOT allow (that branch returned
    // above), i.e. the wildcard action is `ask`, yet the deriver returned no
    // context. The auto-allow therefore comes from the deriver, NOT from a rule:
    // the rule engine said `ask`. Recording `rule_allowed` here would misstate
    // the audit (e.g. `memory_manage`, whose deriver returns null because it is
    // proposal-only and gated by the proposal-decision route). Use the dedicated
    // reason so the audit reflects the real source of the allow.
    const state = await gatePermissionDecision(
      { ...evaluationBase, scope: '*', decision: 'allow' },
      { kind: 'not_needed' },
    );
    return finish(
      state,
      reasonByState(state, PERMISSION_DECISION_REASONS.DERIVER_NOT_REQUIRED),
      '*',
    );
  }

  // Re-evaluate with the actual scope for fine-grained rules.
  // 新派生器的旧 JSON scope 仅作为规则匹配别名，沿用同一 last-match-wins 顺序。
  const ruleScopes = [context.scope, ...(context.ruleScopeAliases ?? [])];
  const scopedWorkspaceRules = workspaceRules
    .filter((rule) => ruleScopes.some((scope) => wildcardMatch(scope, rule.pattern)))
    .map((rule) => ({ ...rule, pattern: '*' }));
  const scopedAction = resolveEffectivePermissionAction(
    request.toolName,
    context.scope,
    scopedWorkspaceRules,
  );
  if (scopedAction === 'allow') {
    const state = await gatePermissionDecision(
      { ...evaluationBase, scope: context.scope, decision: 'allow' },
      {
        kind: 'approved',
        requestId: 'workspace-rule',
        decision: 'permanent',
      },
    );
    return finish(
      state,
      reasonByState(state, PERMISSION_DECISION_REASONS.RULE_ALLOWED),
      context.scope,
    );
  }
  if (scopedAction === 'deny') {
    return finish(
      {
        kind: 'denied',
        reason: `工具 "${request.toolName}" 在作用域 "${context.scope}" 被权限规则禁止。`,
      },
      PERMISSION_DECISION_REASONS.RULE_DENIED,
      context.scope,
    );
  }

  // 精确动作的低风险默认值，不改变类别（bash/edit/skill/session 等），
  // 因此已有类别级 deny 仍在上面生效。显式工作区 ask 也覆盖此默认值；
  // 不使用 null 免审批，以免跳过真实作用域规则。所有放行仍经过插件否决与审计。
  const hasExplicitScopedRule = scopedWorkspaceRules.some((rule) =>
    wildcardMatch(category, rule.permission),
  );
  if (context.approvalDefault === 'allow' && !hasExplicitScopedRule) {
    const state = await gatePermissionDecision(
      { ...evaluationBase, scope: context.scope, decision: 'allow' },
      { kind: 'not_needed' },
    );
    return finish(
      state,
      reasonByState(state, PERMISSION_DECISION_REASONS.DERIVER_NOT_REQUIRED),
      context.scope,
    );
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
    const state = await gatePermissionDecision(
      { ...evaluationBase, scope: context.scope, decision: 'allow' },
      { kind: 'not_needed' },
    );
    return finish(
      state,
      reasonByState(
        state,
        resolveModeShortcutReason(
          permissionMode,
          sessionRoleContext,
          sessionMetadata,
          category,
          request.toolName,
        ),
      ),
      context.scope,
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
    const state = await gatePermissionDecision(
      { ...evaluationBase, scope: context.scope, decision: 'allow' },
      { kind: 'not_needed' },
    );
    return finish(
      state,
      reasonByState(state, PERMISSION_DECISION_REASONS.MODE_AUTO_EDIT),
      context.scope,
    );
  }

  if (shouldAutoApproveToolForSessionMetadata(request.toolName, sessionMetadata)) {
    const state = await gatePermissionDecision(
      { ...evaluationBase, scope: context.scope, decision: 'allow' },
      {
        kind: 'approved',
        requestId: 'channel-policy',
        decision: 'session',
      },
    );
    return finish(
      state,
      reasonByState(state, PERMISSION_DECISION_REASONS.CHANNEL_POLICY),
      context.scope,
    );
  }

  if (workspaceRoot && hasWorkspacePermanentPermission(sessionId, category, context.scope)) {
    const state = await gatePermissionDecision(
      { ...evaluationBase, scope: context.scope, decision: 'allow' },
      {
        kind: 'approved',
        requestId: 'workspace-policy',
        decision: 'permanent',
      },
    );
    return finish(
      state,
      reasonByState(state, PERMISSION_DECISION_REASONS.WORKSPACE_RULE),
      context.scope,
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
          toolName: request.toolName,
          rawInput: request.rawInput as Record<string, unknown>,
          ...(observability ? { observability } : {}),
        }
      : undefined;

  const approved = findApprovedPermission(sessionId, category, context.scope);
  if (approved) {
    const state = await gatePermissionDecision(
      { ...evaluationBase, scope: context.scope, decision: 'allow' },
      {
        kind: 'approved',
        requestId: approved.id,
        decision: approved.decision,
      },
    );
    return finish(
      state,
      reasonByState(state, PERMISSION_DECISION_REASONS.SAVED_APPROVAL),
      context.scope,
    );
  }

  // ask 阶段的最后一道裁决：必须先过 hook 再落 pending，否则被插件拒绝的调用
  // 会在 permission_requests 里留下一个无人应答的 pending 记录。
  const veto = await runPermissionEvaluateHook({
    ...evaluationBase,
    scope: context.scope,
    decision: 'ask',
  });
  if (veto) {
    return finish(veto, PERMISSION_DECISION_REASONS.PLUGIN_DENIED, context.scope);
  }

  // 渠道会话没有人工审批通道：审批入口只在 Web 端、且限会话所有者，群成员无从回复；
  // 而落一条 pending 会把会话钉在 `paused` 上等一个永远不来的回复（`expires_at`
  // 通常为 null，也不会有超时回收）。渠道可见工具已在前面
  // `shouldAutoApproveToolForSessionMetadata` 分支自动批准，因此能走到这里的调用
  // 本身就是「对本渠道不可见却仍被调用」的异常路径——直接拒绝，让模型拿到明确结果
  // 继续，而不是整轮停摆。
  if (isChannelManagedSession(sessionMetadata)) {
    return finish(
      {
        kind: 'denied',
        reason: `工具 "${request.toolName}" 在当前渠道会话中不可用：渠道没有人工审批通道，无法为它授权。如需使用，请在渠道配置中放开该工具。`,
      },
      PERMISSION_DECISION_REASONS.CHANNEL_NO_APPROVAL,
      context.scope,
    );
  }

  const pendingRequestId = findPendingPermission(sessionId, category, context.scope);
  if (pendingRequestId) {
    if (requestPayload) {
      updatePendingPermissionPayload(pendingRequestId, requestPayload);
    }
    return finish(
      { kind: 'pending', requestId: pendingRequestId, created: false },
      PERMISSION_DECISION_REASONS.AWAITING_USER,
      context.scope,
    );
  }

  return finish(
    {
      kind: 'pending',
      requestId: createPendingPermissionRequest(sessionId, category, context, requestPayload),
      created: true,
    },
    PERMISSION_DECISION_REASONS.AWAITING_USER,
    context.scope,
  );
}

/**
 * 插件 hook 可以把内置 allow 降级为 deny：此时出口 reason 必须是插件拒绝而非
 * 原分支的 allow 理由，否则审计会把「被插件拒绝」误记成「已放行」。
 * 保留原分支理由作为「若非插件否决会是哪个理由」，这里只做最终态纠正。
 */
function reasonByState(
  state: PermissionState,
  fallback: PermissionDecisionReason,
): PermissionDecisionReason {
  return state.kind === 'denied' ? PERMISSION_DECISION_REASONS.PLUGIN_DENIED : fallback;
}

/**
 * 免审批快捷分支的具体理由：四档（yolo / team 后台 / 派生无人值守 / reception 只读）
 * 合并成一个 if，这里按同一优先级回推到底是哪一档命中，保证审计可区分。
 */
function resolveModeShortcutReason(
  permissionMode: string,
  sessionRoleContext: ReturnType<typeof getSessionRoleContext>,
  sessionMetadata: ReturnType<typeof getSessionMetadata>,
  category: string,
  toolName: string,
): PermissionDecisionReason {
  if (permissionMode === 'yolo') {
    return PERMISSION_DECISION_REASONS.MODE_YOLO;
  }
  if (isBackgroundAutoApprovedTeamSession(sessionRoleContext)) {
    return PERMISSION_DECISION_REASONS.TEAM_BACKGROUND;
  }
  if (isUnattendedSessionDelegationAutoApproved(sessionMetadata, category)) {
    return PERMISSION_DECISION_REASONS.DELEGATION_UNATTENDED;
  }
  if (isReceptionReadOnlyToolAutoApproved(sessionRoleContext, toolName)) {
    return PERMISSION_DECISION_REASONS.RECEPTION_READONLY;
  }
  return PERMISSION_DECISION_REASONS.MODE_YOLO;
}
