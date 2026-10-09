/**
 * 会话上下文判定域(261009-tool-sandbox 拆分 P1 / T-04)。
 *
 * 由 `tool-sandbox.ts` 原样搬出,行为不变:会话归属 / 元数据读取、角色上下文、
 * 团队后台判定、无人值守放行、planMode 与工具可观测信息构造。
 *
 * 依赖方向:`tool-sandbox.ts` → 本模块(单向)。跨域辅助 `readTaskRequestedSkills`
 * 复用 `./child-session.js`,公共类型 `SandboxExecutionContext` 以 `import type`
 * 从门面取(类型导入在运行时被擦除,不构成循环)。
 */

import type { BatchSubToolProgress } from '@openAwork/shared';
import { sqliteGet, sqliteRun } from '../../infra/db.js';
import { TOOLSET_TO_TOOL_NAMES } from '../../handoff/capability/toolset-gate.js';
import { type PermissionDecision } from '../../permission/permission-contract.js';
import { parseSessionMetadataJson } from '../../session/session-workspace-metadata.js';
import { type ChildSessionTerminalReason } from './child-session.js';

interface SessionOwnerRow {
  user_id: string;
}

interface SessionMetadataRow {
  metadata_json: string;
}

export interface PermissionApprovalRow {
  id: string;
  decision: PermissionDecision;
}

export interface PermissionPendingRow {
  id: string;
}

export interface QuestionPendingRow {
  id: string;
}

export type PermissionState =
  | { kind: 'approved'; decision: PermissionDecision; requestId: string }
  | { kind: 'denied'; reason: string }
  | { kind: 'pending'; requestId: string; created: boolean }
  | { kind: 'not_needed' };

export type BatchProgressCallback = (
  subTools: BatchSubToolProgress[],
  completedCount: number,
  totalCount: number,
) => void;

export interface SandboxExecutionContext {
  clientRequestId?: string;
  nextRound?: number;
  requestData?: Record<string, unknown>;
  onBatchProgress?: BatchProgressCallback;
  /**
   * Optional partial-output callback that streaming-capable tool dispatchers
   * (currently bash) may invoke as the underlying process emits stdout/stderr.
   * The batch executor injects a per-sub-call wrapper that writes the chunk
   * into `subToolStates[index].partialOutput` and triggers `onBatchProgress`,
   * so the UI can render live terminal output for an in-flight sub-tool
   * without waiting for the whole batch to finish.
   */
  onPartialOutput?: (text: string) => void;
  /**
   * Owning user id, threaded down so terminal-tracked tool dispatchers
   * (bash / run_bash_in_background) can register session_terminals rows
   * with the right user. Falls back to `getSessionOwnerUserId(sessionId)`
   * when not provided.
   */
  userId?: string;
}

/**
 * One tool call that was blocked when the turn paused on a permission request.
 *
 * `blockedToolCalls[0]` is always the call that actually created/owns the
 * pending permission row; the remaining entries are the siblings that were
 * held back because they either needed approval themselves or were withheld
 * behind the pause (non read-only siblings after the first pending call).
 *
 * They are resumed together, in original `tool_use` order, so the next upstream
 * request carries the whole batch's `tool_result`s at once (prompt-cache friendly).
 */
export interface BlockedToolCallPayload {
  toolCallId: string;
  toolName: string;
  rawInput: Record<string, unknown>;
}

export interface PermissionRequestPayload {
  clientRequestId: string;
  nextRound: number;
  requestData: Record<string, unknown>;
  /** First blocked call — kept for backward compatibility with pre-batch payloads. */
  toolCallId: string;
  /** First blocked call input — kept for backward compatibility. */
  rawInput: Record<string, unknown>;
  /** Real (non-category) tool name of the first blocked call. */
  toolName?: string;
  /** All calls blocked by this pause, in `tool_use` order. */
  blockedToolCalls?: BlockedToolCallPayload[];
  observability?: {
    presentedToolName: string;
    canonicalToolName: string;
    adapterVersion: string;
  };
}

export interface TaskBackgroundRunResult {
  pendingInteraction: boolean;
  reason?: ChildSessionTerminalReason;
  errorSummary?: string;
  statusCode: number;
  summary: string;
}
export function getSessionOwnerUserId(sessionId: string): string | null {
  const session = sqliteGet<SessionOwnerRow>('SELECT user_id FROM sessions WHERE id = ? LIMIT 1', [
    sessionId,
  ]);
  return session?.user_id ?? null;
}

export function getSessionMetadata(sessionId: string): Record<string, unknown> {
  const row = sqliteGet<SessionMetadataRow>(
    'SELECT metadata_json FROM sessions WHERE id = ? LIMIT 1',
    [sessionId],
  );
  return parseSessionMetadataJson(row?.metadata_json ?? '{}');
}

interface SessionRoleContextRow {
  handoff_state: string | null;
  role_layer: string | null;
  team_parent_session_id: string | null;
}

export function getSessionRoleContext(sessionId: string): SessionRoleContextRow | null {
  return (
    sqliteGet<SessionRoleContextRow>(
      'SELECT role_layer, team_parent_session_id, handoff_state FROM sessions WHERE id = ? LIMIT 1',
      [sessionId],
    ) ?? null
  );
}

function hasTeamParentSessionId(row: SessionRoleContextRow): boolean {
  return (
    typeof row.team_parent_session_id === 'string' && row.team_parent_session_id.trim().length > 0
  );
}

function hasBackgroundTeamContext(row: SessionRoleContextRow): boolean {
  return (
    hasTeamParentSessionId(row) &&
    typeof row.handoff_state === 'string' &&
    row.handoff_state.trim().length > 0
  );
}

export function isBackgroundAutoApprovedTeamSession(row: SessionRoleContextRow | null): boolean {
  if (!row) {
    return false;
  }

  const isTeamRole =
    row.role_layer === 'pm1' ||
    row.role_layer === 'pm2' ||
    row.role_layer === 'executor' ||
    row.role_layer === 'reviewer';

  return isTeamRole && hasBackgroundTeamContext(row);
}

const RECEPTION_READ_ONLY_TOOL_NAMES: ReadonlySet<string> = new Set([
  ...TOOLSET_TO_TOOL_NAMES.read,
  ...TOOLSET_TO_TOOL_NAMES.web,
]);

// reception 只读白名单免审批：仅放行 read/web 类别工具，写入、Shell、LSP 改名等修改类
// 工具仍走 ask；显式 deny 在本分支之前求值（权限阶梯不变量），白名单只能跳过 ask，
// 永远无法放行被拒绝的调用。
export function isReceptionReadOnlyToolAutoApproved(
  row: SessionRoleContextRow | null,
  toolName: string,
): boolean {
  if (!row) {
    return false;
  }

  return (
    row.role_layer === 'reception' &&
    hasTeamParentSessionId(row) &&
    RECEPTION_READ_ONLY_TOOL_NAMES.has(toolName)
  );
}

/**
 * 无人来源会话（cron 定时任务）的**委派**免审批。
 *
 * cron 会话由定时器驱动、用户不在场：若委派需要审批，任务会一直挂到用户下次
 * 打开 Web UI，定时任务静默停摆。委派子代理（`task_run` 类别）是定时任务的
 * 常规能力，故在此放行——与 `isBackgroundAutoApprovedTeamSession` 同类。
 *
 * 安全边界：
 *   - 免审批分支在**通配符 / 作用域级 deny 之后**执行，显式 `deny` 仍然优先；
 *   - 只放行**委派类别**（`task` / `call_omo_agent` → `task_run`）：cron 会话内的
 *     写操作（edit/write/bash）保持 `ask`，沿用既有语义（用户可在 Web UI 批准）；
 *   - `source` 只在服务端写入（`cron/agent-handler.ts`），会话 metadata PATCH 是
 *     strict 白名单（`session-workspace-metadata.ts`，不含 `source`），客户端无法伪造。
 *
 * 渠道会话不在此列：其已启用工具走既有 `channel-policy` 豁免
 * （`shouldAutoApproveToolForSessionMetadata`）。
 */
export function isUnattendedSessionDelegationAutoApproved(
  metadata: Record<string, unknown>,
  permissionCategory: string,
): boolean {
  if (metadata['source'] !== 'cron') {
    return false;
  }

  return permissionCategory === 'task_run';
}

export function updateSessionMetadata(sessionId: string, metadata: Record<string, unknown>): void {
  sqliteRun("UPDATE sessions SET metadata_json = ?, updated_at = datetime('now') WHERE id = ?", [
    JSON.stringify(metadata),
    sessionId,
  ]);
}

export function isPlanModeEnabled(metadata: Record<string, unknown>): boolean {
  return metadata.planMode === true;
}

export function buildToolObservability(input: {
  canonicalToolName: string;
  metadata: Record<string, unknown>;
  presentedToolName: string;
}): NonNullable<PermissionRequestPayload['observability']> {
  return {
    presentedToolName: input.presentedToolName,
    canonicalToolName: input.canonicalToolName,
    adapterVersion: '1.0.0',
  };
}
