import { randomUUID } from 'crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  DEFAULT_FIXED_TEAM_MEMBER_SLOTS,
  FIXED_TEAM_CORE_ROLE_BINDINGS,
  FIXED_TEAM_CORE_ROLE_ORDER,
  TEAM_RUNTIME_LAYER_ORDER,
} from '@openAwork/shared';
import type { TeamMemberSpecialty } from '@openAwork/shared';
import { listManagedAgentsForUser } from '../agent/agent-catalog.js';
import type { JwtPayload } from '../infra/auth.js';
import { parseBody, parseQuery } from '../infra/parse-request.js';
import { requireAuth } from '../infra/auth.js';
import { sqliteAll, sqliteGet, sqliteRun } from '../infra/db.js';
import { startRequestWorkflow } from '../runtime/request-workflow.js';
import {
  normalizeIncomingSessionMetadata,
  parseSessionMetadataJson,
  validateSessionMetadataPatch,
} from '../session/session-workspace-metadata.js';
import { resolveSessionWorkspacePath } from '../session/session-workspace-resolution.js';
import {
  cloneDefaultTeamRoster,
  normalizeTeamWorkspaceDefaultRoster,
  parseTeamWorkspaceDefaultRosterJson,
} from '../team/team-default-roster-store.js';
import { getAllLatencyStats } from '../handoff/bus/latency-monitor.js';
import { getTeamEventsBusStats } from '../handoff/bus/team-events-bus.js';
import { mergeRuntimeTaskGroups } from '../team/team-runtime-task-groups.js';
import { listSharedSessionsForRecipient } from '../session/session-shared-access.js';
import { listTeamAuditLogs, logTeamAudit } from '../team/team-audit-store.js';
import { listTeamToolCallRecords, listTeamUsageRecords } from '../team/team-usage-records-store.js';
import {
  SESSION_RUNTIME_THREAD_HEARTBEAT_MS,
  SESSION_RUNTIME_THREAD_STALE_AFTER_MS,
} from '../session/session-runtime-thread-store.js';
import {
  getTeamRuntimeIncidentSummary,
  listTeamRuntimeIncidents,
} from '../team/team-runtime-diagnostics-store.js';
import { reconcileTeamRuntimeAlerts } from '../team/team-runtime-alert-store.js';
import {
  consumeExpiredSuppressedAlertControls,
  clearTeamRuntimeAlertControl,
  listTeamRuntimeAlertControls,
  upsertTeamRuntimeAlertControl,
} from '../team/team-runtime-alert-control-store.js';
import {
  getTeamRuntimeRemediationSummary,
  isTeamRuntimeRemediationCode,
  runTeamRuntimeRemediation,
  type TeamRuntimeRemediationCode,
} from '../team/team-runtime-remediation-policy.js';
import { listPm2HandoffsPendingQualityReview } from '../handoff/runner/pm2-quality-review-reconciler.js';
import { deriveTeamRuntimeAlerts, deriveTeamRuntimeHealth } from '../team/team-failure-policy.js';
import {
  isTeamRuntimeTelemetryEnabled,
  trackTeamRuntimeHealth,
} from '../team/team-runtime-telemetry.js';
import {
  buildMergedSessionTaskProjection,
  extractParentSessionIdFromMetadata,
  normalizeImportedMessages,
  type SessionRow,
  validateParentSessionBinding,
} from './sessions.js';
import { validateImportedMessagesPayload } from './session-route-helpers.js';
import { createTeamSession } from '../handoff/bus/team-session-create.js';
import { getChatProvider } from '../provider/provider-catalog.js';
import {
  getEffectiveReviewDispositionFromPayloadJson,
  isHandledReviewFailurePayloadJson,
  isRecoverableFailedHandoff,
} from '../handoff/store/handoff-store.js';
import { teamCrudRoutes } from './team-crud.js';

const TEAM_MEMBER_SPECIALTY_VALUES = Array.from(
  new Set<TeamMemberSpecialty>([
    ...DEFAULT_FIXED_TEAM_MEMBER_SLOTS.map((slot) => slot.specialty),
    'custom',
  ]),
) as [TeamMemberSpecialty, ...TeamMemberSpecialty[]];

const teamMemberSlotSchema = z.object({
  id: z.string().min(1).max(120),
  layer: z.enum(TEAM_RUNTIME_LAYER_ORDER),
  specialty: z.enum(TEAM_MEMBER_SPECIALTY_VALUES),
  displayName: z.string().min(1).max(200),
  personaKey: z.string().min(1).max(160),
  toolsets: z.array(z.string().min(1).max(80)).max(20),
  required: z.boolean(),
  // 可选 per-member 模型绑定（智能分配模型功能；老数据无此字段，向后兼容）。
  providerId: z.string().min(1).max(200).optional(),
  modelId: z.string().min(1).max(200).optional(),
  variant: z.string().min(1).max(80).optional(),
  // 自定义角色字段（specialty === 'custom'）。
  custom: z.boolean().optional(),
  systemPrompt: z.string().max(8000).optional(),
  // 模板初始能力绑定（skills / mcp）。
  skillIds: z.array(z.string().min(1).max(160)).max(50).optional(),
  mcpServerIds: z.array(z.string().min(1).max(160)).max(50).optional(),
  // 路由关键词（上游派发动态识别成员擅长领域；自定义角色尤其需要）。
  routingKeywords: z.array(z.string().min(1).max(160)).max(50).optional(),
  // 派发优先级（同分排序权重）。
  dispatchPriority: z.enum(['high', 'normal', 'low']).optional(),
});

type TeamMemberSlotInput = z.infer<typeof teamMemberSlotSchema>;

interface TeamSessionModelSnapshot {
  modelId: string;
  providerId: string;
  variant?: string;
}

function resolveLayerModelSnapshot(
  memberSlots: TeamMemberSlotInput[],
  layer: TeamMemberSlotInput['layer'],
): TeamSessionModelSnapshot | null {
  const slot = memberSlots.find(
    (item) =>
      item.layer === layer &&
      typeof item.providerId === 'string' &&
      item.providerId.trim().length > 0 &&
      typeof item.modelId === 'string' &&
      item.modelId.trim().length > 0,
  );
  if (!slot?.providerId || !slot.modelId) return null;
  return {
    providerId: slot.providerId.trim(),
    modelId: slot.modelId.trim(),
    ...(slot.variant && slot.variant.trim().length > 0 ? { variant: slot.variant.trim() } : {}),
  };
}

async function resolveReceptionModelSnapshot(input: {
  memberSlots: TeamMemberSlotInput[];
  userId: string;
}): Promise<TeamSessionModelSnapshot | null> {
  const explicitReceptionModel = resolveLayerModelSnapshot(input.memberSlots, 'reception');
  if (explicitReceptionModel) return explicitReceptionModel;
  const chatProvider = await getChatProvider(input.userId);
  return {
    providerId: chatProvider.provider.id,
    modelId: chatProvider.modelId,
  };
}

const createWorkspaceSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  visibility: z.enum(['open', 'closed', 'private']).default('private'),
  defaultWorkingRoot: z.string().min(1).nullable().optional(),
  defaultTeamRoster: z.array(teamMemberSlotSchema).max(40).optional(),
});

const updateWorkspaceSchema = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    visibility: z.enum(['open', 'closed', 'private']).optional(),
    defaultWorkingRoot: z.string().min(1).nullable().optional(),
    defaultTeamRoster: z.array(teamMemberSlotSchema).max(40).optional(),
  })
  .refine(
    (input) =>
      input.name !== undefined ||
      input.description !== undefined ||
      input.visibility !== undefined ||
      input.defaultWorkingRoot !== undefined ||
      input.defaultTeamRoster !== undefined,
    {
      message: '至少需要提供一个可更新字段。',
    },
  );

const createThreadSchema = z.object({
  metadata: z.record(z.unknown()).optional().default({}),
  memberSlots: z.array(teamMemberSlotSchema).max(40).optional(),
  title: z.string().min(1).max(200).optional(),
});

const createTeamSessionSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    source: z
      .object({
        kind: z.enum(['blank', 'builtin-template', 'saved-template']),
        templateId: z.string().min(1).optional(),
      })
      .optional(),
    memberSlots: z.array(teamMemberSlotSchema).max(40).optional(),
    optionalAgentIds: z.array(z.string().min(1)).default([]),
    defaultProvider: z.string().nullable().optional(),
    workingDirectory: z.string().trim().min(1).nullable().optional(),
  })
  .superRefine((input, ctx) => {
    if (input.source && input.source.kind !== 'blank' && !input.source.templateId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '当 source.kind 不是 blank 时，必须提供 templateId。',
        path: ['source', 'templateId'],
      });
    }
  });

const importWorkspaceSessionSchema = z.object({
  id: z.string().optional(),
  messages: z.array(z.unknown()).default([]),
  exportedAt: z.string().optional(),
});

const teamRuntimeQuerySchema = z.object({
  handoffId: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
  teamWorkspaceId: z.string().min(1).optional(),
});

const booleanQueryParamSchema = z.preprocess((value) => {
  if (typeof value !== 'string') {
    return value;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1') {
    return true;
  }
  if (normalized === 'false' || normalized === '0') {
    return false;
  }
  return value;
}, z.boolean().optional());

const teamRuntimeRemediationQuerySchema = teamRuntimeQuerySchema.extend({
  force: booleanQueryParamSchema,
});

const TEAM_RUNTIME_ALERT_CODE_VALUES = [
  'architecture-review-blocked',
  'handoff-failure',
  'latency-violation',
  'pending-decisions',
  'quality-review-pending',
  'quality-review-escalate-to-user',
  'quality-review-redispatch',
  'quality-review-return-to-c',
  'stale-decisions',
  'stale-runtime-threads',
  'team-events-connection',
  'telemetry-disabled',
] as const;

const teamRuntimeAlertCodeSchema = z.enum(TEAM_RUNTIME_ALERT_CODE_VALUES);

const acknowledgeAlertSchema = z.object({
  note: z.string().trim().min(1).max(500).optional(),
});

const suppressAlertSchema = z.object({
  minutes: z
    .preprocess(
      (value) => {
        if (typeof value === 'string' && value.trim().length > 0) {
          return Number(value);
        }
        return value;
      },
      z
        .number()
        .int()
        .min(1)
        .max(24 * 60)
        .optional(),
    )
    .default(60),
  note: z.string().trim().min(1).max(500).optional(),
});

type TeamRouteErrorCode =
  | 'team_session_not_found'
  | 'team_workspace_not_found'
  | 'team_template_not_found'
  | 'team_template_metadata_invalid'
  | 'team_session_metadata_invalid'
  | 'team_workspace_path_forbidden'
  | 'team_required_agent_not_found'
  | 'team_optional_agent_not_found'
  | 'team_optional_agent_duplicates_required'
  | 'team_import_payload_too_large'
  | 'team_runtime_alert_no_remediation'
  | 'team_runtime_alert_not_active'
  | 'team_runtime_alert_control_not_found'
  | 'team_parent_session_not_found'
  | 'team_parent_session_immutable'
  | 'team_parent_session_invalid';

const TEAM_ROUTE_ERROR_MESSAGES: Record<TeamRouteErrorCode, string> = {
  team_session_not_found: '目标团队会话不存在。',
  team_workspace_not_found: '目标团队工作区不存在。',
  team_template_not_found: '目标模板不存在。',
  team_template_metadata_invalid: '模板元数据不是合法的 JSON。',
  team_session_metadata_invalid: '会话元数据无效。',
  team_workspace_path_forbidden: '当前工作区路径不允许访问。',
  team_required_agent_not_found: '必需团队代理不存在或未启用。',
  team_optional_agent_not_found: '可选团队代理不存在或未启用。',
  team_optional_agent_duplicates_required: '可选团队代理与必需绑定重复。',
  team_import_payload_too_large: '导入内容超出允许范围。',
  team_runtime_alert_no_remediation: '该告警不支持自动修复。',
  team_runtime_alert_not_active: '目标告警当前未激活。',
  team_runtime_alert_control_not_found: '目标告警控制记录不存在。',
  team_parent_session_not_found: '父会话不存在。',
  team_parent_session_immutable: '父会话绑定后不可修改。',
  team_parent_session_invalid: '父会话绑定无效。',
};

function teamRouteErrorPayload(
  code: TeamRouteErrorCode,
  extra?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    code,
    error: TEAM_ROUTE_ERROR_MESSAGES[code],
    ...(extra ?? {}),
  };
}

function mapTeamParentBindingError(error: {
  error: string;
  reason: string;
  statusCode: number;
}): Record<string, unknown> {
  if (error.reason === 'parent not found') {
    return teamRouteErrorPayload('team_parent_session_not_found');
  }
  if (error.reason === 'parent immutable') {
    return teamRouteErrorPayload('team_parent_session_immutable');
  }
  if (error.reason === 'invalid parent') {
    return teamRouteErrorPayload('team_parent_session_invalid');
  }
  return {
    error: error.error,
  };
}

interface SessionShareRow {
  created_at: string;
  id: string;
  label: string | null;
  member_email: string;
  member_id: string;
  member_name: string;
  permission: 'view' | 'comment' | 'operate';
  session_id: string;
  session_metadata_json: string;
  updated_at: string;
}

interface MemberRow {
  id: string;
  name: string;
  email: string;
  role: string;
  avatar_url: string | null;
  status: string;
  created_at: string;
}

interface TeamWorkspaceRow {
  created_at: string;
  default_working_root: string | null;
  default_team_roster_json: string | null;
  description: string | null;
  id: string;
  name: string;
  updated_at: string;
  user_id: string;
  visibility: 'open' | 'closed' | 'private';
}

interface TaskRow {
  id: string;
  title: string;
  assignee_id: string | null;
  status: string;
  priority: string;
  result: string | null;
  created_at: string;
  updated_at: string;
}

interface MessageRow {
  id: string;
  session_id: string | null;
  sender_id: string | null;
  recipient_member_id: string | null;
  reply_to_message_id: string | null;
  content: string;
  type: string;
  created_at: string;
}

type TeamRuntimeTaskRecord = Awaited<
  ReturnType<typeof buildMergedSessionTaskProjection>
>['tasks'][number];

interface TeamRuntimeTaskGroupRecord {
  sessionIds: string[];
  tasks: TeamRuntimeTaskRecord[];
  updatedAt: number;
  workspacePath: string | null;
}

interface RuntimeDispatchTaskHandoffRow {
  completed_at: string | null;
  created_at: string;
  failure_reason: string | null;
  from_session_id: string;
  id: string;
  payload_json: string;
  started_at: string | null;
  state: string;
  to_session_id: string | null;
  updated_at: string;
}

interface RuntimeHandoffRow {
  claimed_at: string | null;
  claim_token: string | null;
  completed_at: string | null;
  created_at: string;
  failure_reason: string | null;
  from_role_layer: string;
  from_session_id: string;
  id: string;
  paused: number;
  paused_at: string | null;
  paused_by_user_id: string | null;
  pause_reason: string | null;
  payload_json: string;
  retry_count: number;
  started_at: string | null;
  state: string;
  to_role_layer: string;
  to_session_id: string | null;
  updated_at: string;
  user_id: string;
}

interface RuntimeClarificationRow {
  created_at: string;
  id: string;
  payload_json: string;
  state: string;
  to_session_id: string;
  user_id: string;
}

interface RuntimeNotificationRow {
  created_at: string;
  id: string;
  payload_json: string;
  to_session_id: string;
  user_id: string;
}

interface WorkflowTemplateLookupRow {
  id: string;
  metadata_json: string;
  name: string;
}

const roleBindingSchema = z.object({
  agentId: z.string().min(1),
  modelId: z.string().min(1).optional(),
  providerId: z.string().min(1).optional(),
  variant: z.string().min(1).max(80).optional(),
});

const workflowTeamTemplateSchema = z.object({
  defaultBindings: z
    .object({
      leader: z.union([z.string().min(1), roleBindingSchema]).optional(),
      planner: z.union([z.string().min(1), roleBindingSchema]).optional(),
      researcher: z.union([z.string().min(1), roleBindingSchema]).optional(),
      executor: z.union([z.string().min(1), roleBindingSchema]).optional(),
      reviewer: z.union([z.string().min(1), roleBindingSchema]).optional(),
    })
    .optional(),
  defaultProvider: z.string().nullable().optional(),
  optionalAgentIds: z.array(z.string().min(1)).optional(),
  requiredRoles: z
    .array(z.enum(['leader', 'planner', 'researcher', 'executor', 'reviewer']))
    .optional(),
  /**
   * 模板内置的快捷起始建议，前端 ReceptionStarterCard 渲染为 chip。
   * 用户点击 chip → 填入 composer（不直接发送，由用户确认后再发出）。
   * 与 D31 对齐：starter 仍要被视作"用户主动给出的意图"，不允许自动派发。
   */
  starterSuggestions: z.array(z.string().min(1).max(200)).max(8).optional(),
});

// ─── Phase B T-09/T-10 helpers ──────────────────────────────────────────────
//
// 旧路径 helper（findOrCreateReceptionSession / mapDispatchRoleToHandoffLayer）
// 已与 /team/interaction-agent/rewrite + /team/leader/dispatch 路由一并移除。
// 新路径走 reception-orchestrator → watcher 自动链。

export async function teamRoutes(app: FastifyInstance): Promise<void> {
  const SESSION_TEAM_WORKSPACE_ID_SQL =
    "json_extract(CASE WHEN json_valid(metadata_json) THEN metadata_json ELSE '{}' END, '$.teamWorkspaceId')";
  const JOINED_SESSION_TEAM_WORKSPACE_ID_SQL =
    "json_extract(CASE WHEN json_valid(sess.metadata_json) THEN sess.metadata_json ELSE '{}' END, '$.teamWorkspaceId')";

  const normalizeMemberStatus = (status: string): 'idle' | 'working' | 'done' | 'error' => {
    if (status === 'working' || status === 'done' || status === 'error') return status;
    return 'idle';
  };

  const getWorkspacePathFromMetadataJson = (input: {
    metadataJson: string;
    sessionId: string;
    userId: string;
  }): string | null =>
    resolveSessionWorkspacePath({
      metadataJson: input.metadataJson,
      sessionId: input.sessionId,
      userId: input.userId,
    });

  const mapSessionShareRow = (userId: string, row: SessionShareRow) => ({
    id: row.id,
    sessionId: row.session_id,
    memberId: row.member_id,
    memberName: row.member_name,
    memberEmail: row.member_email,
    permission: row.permission,
    sessionLabel: row.label ?? row.session_id,
    workspacePath: getWorkspacePathFromMetadataJson({
      metadataJson: row.session_metadata_json,
      sessionId: row.session_id,
      userId,
    }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });

  const getTeamWorkspaceForUser = (
    userId: string,
    teamWorkspaceId: string,
  ): TeamWorkspaceRow | null =>
    sqliteGet<TeamWorkspaceRow>(
      `SELECT id, user_id, name, description, visibility, default_working_root, default_team_roster_json, created_at, updated_at
       FROM team_workspaces
       WHERE user_id = ? AND id = ?
       LIMIT 1`,
      [userId, teamWorkspaceId],
    ) ?? null;

  const listTeamRuntimeSessionRows = (input: {
    teamWorkspaceId?: string;
    userId: string;
  }): SessionRow[] => {
    // 查询所有属于该用户的 team session：
    // 1. metadata_json 中包含 teamWorkspaceId 的 session（reception 根 session）
    // 2. 有 role_layer 的 session（team 子 session —— pm1/pm2/executor/reviewer）
    // 3. 有 team_parent_session_id 的 session（通过 team 父子链关联的 session）
    // 第 2、3 条是兜底：旧数据中子 session 的 metadata 可能没有 teamWorkspaceId
    // （watcher 修复前创建的），但只要它们有 role_layer 或 team_parent_session_id
    // 就应该出现在 team runtime 列表中。
    const baseColumns =
      'id, user_id, messages_json, state_status, paused, metadata_json, title, created_at, updated_at, team_parent_session_id, role_layer';
    const hasTeamWorkspaceFilter =
      typeof input.teamWorkspaceId === 'string' && input.teamWorkspaceId.length > 0;

    const query = hasTeamWorkspaceFilter
      ? `SELECT ${baseColumns}
         FROM sessions
         WHERE user_id = ? AND (
           ${SESSION_TEAM_WORKSPACE_ID_SQL} = ?
           OR role_layer IS NOT NULL
           OR team_parent_session_id IS NOT NULL
         )
         ORDER BY updated_at DESC`
      : `SELECT ${baseColumns}
         FROM sessions
         WHERE user_id = ? AND (
           ${SESSION_TEAM_WORKSPACE_ID_SQL} IS NOT NULL
           OR role_layer IS NOT NULL
           OR team_parent_session_id IS NOT NULL
         )
         ORDER BY updated_at DESC`;

    const params = hasTeamWorkspaceFilter ? [input.userId, input.teamWorkspaceId] : [input.userId];

    const rows = sqliteAll<SessionRow>(query, params);

    // 如果指定了 teamWorkspaceId，需要进一步过滤：
    // - metadata 中有匹配的 teamWorkspaceId 的 session 直接保留
    // - 没有 teamWorkspaceId 但有 role_layer/team_parent_session_id 的 session，
    //   通过 team_parent_session_id 递归向上查找根 session 是否属于该 workspace
    if (!hasTeamWorkspaceFilter) {
      return rows;
    }

    // 构建所有 session 的 id → metadata.teamWorkspaceId 映射，用于递归查找
    const workspaceIdBySessionId = new Map<string, string | null>();
    const parentBySessionId = new Map<string, string | null>();
    for (const row of rows) {
      const metadata = parseSessionMetadataJson(row.metadata_json);
      const twId = typeof metadata['teamWorkspaceId'] === 'string' ? metadata['teamWorkspaceId'] : null;
      workspaceIdBySessionId.set(row.id, twId);
      const rawRow = row as unknown as Record<string, unknown>;
      const teamParent = typeof rawRow['team_parent_session_id'] === 'string' ? rawRow['team_parent_session_id'] : null;
      parentBySessionId.set(row.id, teamParent);
    }

    // 递归查找 session 的 teamWorkspaceId（向上遍历 parent 链）
    const resolveWorkspaceId = (sessionId: string, visited: Set<string>): string | null => {
      if (visited.has(sessionId)) return null;
      visited.add(sessionId);
      const direct = workspaceIdBySessionId.get(sessionId);
      if (direct) return direct;
      const parent = parentBySessionId.get(sessionId);
      if (!parent) return null;
      // parent 可能不在当前 rows 中（不在查询结果里），尝试从 map 查
      return resolveWorkspaceId(parent, visited);
    };

    return rows.filter((row) => {
      const metadata = parseSessionMetadataJson(row.metadata_json);
      const directWorkspaceId = typeof metadata['teamWorkspaceId'] === 'string' ? metadata['teamWorkspaceId'] : null;
      if (directWorkspaceId === input.teamWorkspaceId) return true;
      // 没有直接的 teamWorkspaceId，通过 parent 链递归查找
      if (!directWorkspaceId) {
        const resolved = resolveWorkspaceId(row.id, new Set());
        return resolved === input.teamWorkspaceId;
      }
      return false;
    });
  };

  const readRuntimeSessionParentSessionId = (row: SessionRow): string | null => {
    const rawRow = row as unknown as Record<string, unknown>;
    const teamParentSessionId =
      typeof rawRow['team_parent_session_id'] === 'string' && rawRow['team_parent_session_id']
        ? rawRow['team_parent_session_id']
        : null;
    const metadataParentSessionId =
      typeof parseSessionMetadataJson(row.metadata_json)['parentSessionId'] === 'string'
        ? (parseSessionMetadataJson(row.metadata_json)['parentSessionId'] as string) || null
        : null;
    return teamParentSessionId ?? metadataParentSessionId;
  };

  const collectRuntimeSessionScopeIds = (
    rootSessionId: string,
    sessionRows: SessionRow[],
  ): string[] => {
    const scope = new Set<string>([rootSessionId]);
    let changed = true;

    while (changed) {
      changed = false;
      for (const row of sessionRows) {
        if (scope.has(row.id)) {
          continue;
        }
        const parentSessionId = readRuntimeSessionParentSessionId(row);
        if (parentSessionId && scope.has(parentSessionId)) {
          scope.add(row.id);
          changed = true;
        }
      }
    }

    return sessionRows.filter((row) => scope.has(row.id)).map((row) => row.id);
  };

  const resolveRuntimeSessionScope = (input: {
    sessionId?: string;
    teamWorkspaceId?: string;
    userId: string;
  }): { sessionIds: string[]; sessionRows: SessionRow[] } | null => {
    const sessionRows = listTeamRuntimeSessionRows({
      userId: input.userId,
      teamWorkspaceId: input.teamWorkspaceId,
    });

    if (!input.sessionId) {
      return {
        sessionIds: sessionRows.map((row) => row.id),
        sessionRows,
      };
    }

    if (!sessionRows.some((row) => row.id === input.sessionId)) {
      return null;
    }

    return {
      sessionIds: collectRuntimeSessionScopeIds(input.sessionId, sessionRows),
      sessionRows,
    };
  };

  const listTeamSessionShareRows = (input: {
    teamWorkspaceId?: string;
    userId: string;
  }): SessionShareRow[] => {
    const query =
      typeof input.teamWorkspaceId === 'string' && input.teamWorkspaceId.length > 0
        ? `SELECT
             ss.id,
             ss.session_id,
             ss.member_id,
             ss.permission,
             ss.created_at,
             ss.updated_at,
             tm.name AS member_name,
             tm.email AS member_email,
             sess.title AS label,
             sess.metadata_json AS session_metadata_json
           FROM session_shares ss
           JOIN team_members tm ON tm.id = ss.member_id
           JOIN sessions sess ON sess.id = ss.session_id
           WHERE ss.user_id = ? AND ${JOINED_SESSION_TEAM_WORKSPACE_ID_SQL} = ?
           ORDER BY ss.created_at DESC`
        : `SELECT
             ss.id,
             ss.session_id,
             ss.member_id,
             ss.permission,
             ss.created_at,
             ss.updated_at,
             tm.name AS member_name,
             tm.email AS member_email,
             sess.title AS label,
             sess.metadata_json AS session_metadata_json
           FROM session_shares ss
           JOIN team_members tm ON tm.id = ss.member_id
           JOIN sessions sess ON sess.id = ss.session_id
           WHERE ss.user_id = ? AND ${JOINED_SESSION_TEAM_WORKSPACE_ID_SQL} IS NOT NULL
           ORDER BY ss.created_at DESC`;

    const params =
      typeof input.teamWorkspaceId === 'string' && input.teamWorkspaceId.length > 0
        ? [input.userId, input.teamWorkspaceId]
        : [input.userId];

    return sqliteAll<SessionShareRow>(query, params).filter((row) => {
      const metadata = parseSessionMetadataJson(row.session_metadata_json);
      return typeof input.teamWorkspaceId === 'string' && input.teamWorkspaceId.length > 0
        ? metadata['teamWorkspaceId'] === input.teamWorkspaceId
        : metadata['teamWorkspaceId'] != null;
    });
  };

  const mapWorkspaceRow = (row: TeamWorkspaceRow) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    visibility: row.visibility,
    defaultWorkingRoot: row.default_working_root,
    defaultTeamRoster: parseTeamWorkspaceDefaultRosterJson(row.default_team_roster_json),
    createdByUserId: row.user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });

  const readRuntimeSessionRoleInstance = (metadataJson: string) => {
    const metadata = parseSessionMetadataJson(metadataJson);
    const rawRoleInstance = metadata['teamRoleInstance'];
    if (
      typeof rawRoleInstance !== 'object' ||
      rawRoleInstance === null ||
      Array.isArray(rawRoleInstance)
    ) {
      return null;
    }
    const roleInstance = rawRoleInstance as Record<string, unknown>;
    const rootSessionId =
      typeof roleInstance['rootSessionId'] === 'string' &&
      roleInstance['rootSessionId'].trim().length > 0
        ? roleInstance['rootSessionId'].trim()
        : null;
    const roleLayer =
      typeof roleInstance['roleLayer'] === 'string' && roleInstance['roleLayer'].trim().length > 0
        ? roleInstance['roleLayer'].trim()
        : null;
    if (!rootSessionId || !roleLayer) {
      return null;
    }
    const personaKey =
      typeof roleInstance['personaKey'] === 'string' && roleInstance['personaKey'].trim().length > 0
        ? roleInstance['personaKey'].trim()
        : null;
    const displayName =
      typeof roleInstance['displayName'] === 'string' &&
      roleInstance['displayName'].trim().length > 0
        ? roleInstance['displayName'].trim()
        : null;
    return {
      rootSessionId,
      roleLayer,
      personaKey,
      displayName,
    };
  };

  const mapRuntimeSessionRow = (userId: string, row: SessionRow) => {
    const rawRow = row as unknown as Record<string, unknown>;
    const paused = typeof rawRow['paused'] === 'number' ? rawRow['paused'] === 1 : false;
    const roleInstance = readRuntimeSessionRoleInstance(row.metadata_json);
    return {
      id: row.id,
      metadataJson: row.metadata_json,
      parentSessionId: readRuntimeSessionParentSessionId(row),
      paused,
      roleLayer:
        typeof rawRow['role_layer'] === 'string' && rawRow['role_layer']
          ? rawRow['role_layer']
          : null,
      stateStatus: row.state_status ?? 'idle',
      title: row.title ?? null,
      updatedAt: row.updated_at,
      workspacePath: getWorkspacePathFromMetadataJson({
        metadataJson: row.metadata_json,
        sessionId: row.id,
        userId,
      }),
      ...(roleInstance ? { roleInstance } : {}),
    };
  };

  const listRuntimeHandoffs = (input: { sessionIds: string[]; userId: string }) => {
    if (input.sessionIds.length === 0) {
      return [];
    }

    const placeholders = input.sessionIds.map(() => '?').join(', ');
    const rows = sqliteAll<RuntimeHandoffRow>(
      `SELECT
         id,
         user_id,
         from_session_id,
         from_role_layer,
         to_role_layer,
         to_session_id,
         payload_json,
         paused,
         paused_at,
         paused_by_user_id,
         pause_reason,
         state,
         claim_token,
         claimed_at,
         started_at,
         completed_at,
         failure_reason,
         retry_count,
         created_at,
         updated_at
       FROM handoff_records
      WHERE user_id = ?
        AND (from_session_id IN (${placeholders}) OR to_session_id IN (${placeholders}))
      ORDER BY updated_at DESC, created_at DESC
        LIMIT 200`,
      [input.userId, ...input.sessionIds, ...input.sessionIds],
    );

    return rows.map((row) => ({
      claimToken: row.claim_token,
      claimedAt: row.claimed_at,
      completedAt: row.completed_at,
      createdAt: row.created_at,
      failureReason: row.failure_reason,
      fromRoleLayer: row.from_role_layer,
      fromSessionId: row.from_session_id,
      id: row.id,
      payload: (() => {
        try {
          return JSON.parse(row.payload_json) as unknown;
        } catch {
          return null;
        }
      })(),
      paused: row.paused === 1,
      pausedAt: row.paused_at,
      pausedByUserId: row.paused_by_user_id,
      pauseReason: row.pause_reason,
      recoverableFailure:
        row.state === 'failed'
          ? isRecoverableFailedHandoff({
              failureReason: row.failure_reason,
              payloadJson: row.payload_json,
              toRoleLayer: row.to_role_layer,
            })
          : undefined,
      retryCount: row.retry_count,
      startedAt: row.started_at,
      state: row.state,
      toRoleLayer: row.to_role_layer,
      toSessionId: row.to_session_id,
      updatedAt: row.updated_at,
      userId: row.user_id,
    }));
  };

  const parseRecordPayload = (payloadJson: string): Record<string, unknown> | null => {
    try {
      const parsed = JSON.parse(payloadJson) as unknown;
      return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  };

  const readDispatchTaskPriority = (value: unknown): 'low' | 'medium' | 'high' => {
    return value === 'low' || value === 'medium' || value === 'high' ? value : 'medium';
  };

  const mapDispatchHandoffStateToTaskStatus = (
    state: string,
  ): 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' => {
    if (state === 'running') {
      return 'running';
    }
    if (state === 'completed') {
      return 'completed';
    }
    if (state === 'failed') {
      return 'failed';
    }
    if (state === 'cancelled') {
      return 'cancelled';
    }
    return 'pending';
  };

  const buildRuntimeDispatchTasksFromHandoffs = (input: {
    sessionRows: SessionRow[];
    userId: string;
  }): TeamRuntimeTaskGroupRecord[] => {
    if (input.sessionRows.length === 0) {
      return [];
    }

    const sessionIds = input.sessionRows.map((row) => row.id);
    const sessionIdSet = new Set(sessionIds);
    const placeholders = sessionIds.map(() => '?').join(', ');
    const rows = sqliteAll<RuntimeDispatchTaskHandoffRow>(
      `SELECT
         id,
         from_session_id,
         to_session_id,
         payload_json,
         state,
         started_at,
         completed_at,
         failure_reason,
         created_at,
         updated_at
       FROM handoff_records
      WHERE user_id = ?
        AND from_role_layer = 'pm2'
        AND to_role_layer = 'executor'
        AND (from_session_id IN (${placeholders}) OR to_session_id IN (${placeholders}))
      ORDER BY updated_at ASC, created_at ASC`,
      [input.userId, ...sessionIds, ...sessionIds],
    );

    const sessionById = new Map(input.sessionRows.map((row) => [row.id, row]));
    const groupsByWorkspace = new Map<
      string,
      {
        sessionIds: Set<string>;
        tasksById: Map<string, TeamRuntimeTaskRecord>;
        updatedAt: number;
        workspacePath: string | null;
      }
    >();
    const projectedTaskIdByLegacyTaskId = new Map<string, string>();

    for (const row of rows) {
      const payload = parseRecordPayload(row.payload_json);
      if (!payload) {
        continue;
      }
      const taskMarkers =
        typeof payload['taskMarkers'] === 'object' &&
        payload['taskMarkers'] !== null &&
        !Array.isArray(payload['taskMarkers'])
          ? (payload['taskMarkers'] as Record<string, unknown>)
          : null;
      const rawTaskId = taskMarkers?.['taskId'];
      const taskMarkerId =
        typeof rawTaskId === 'string' && rawTaskId.trim().length > 0 ? rawTaskId.trim() : row.id;
      projectedTaskIdByLegacyTaskId.set(
        `handoff:${row.from_session_id}:${taskMarkerId}`,
        `handoff:${row.id}:${taskMarkerId}`,
      );
    }

    for (const row of rows) {
      const payload = parseRecordPayload(row.payload_json);
      if (!payload) {
        continue;
      }

      const taskMarkers =
        typeof payload['taskMarkers'] === 'object' &&
        payload['taskMarkers'] !== null &&
        !Array.isArray(payload['taskMarkers'])
          ? (payload['taskMarkers'] as Record<string, unknown>)
          : null;
      const rawTaskId = taskMarkers?.['taskId'];
      const taskMarkerId =
        typeof rawTaskId === 'string' && rawTaskId.trim().length > 0 ? rawTaskId.trim() : row.id;
      const taskSessionId =
        typeof row.to_session_id === 'string' && sessionIdSet.has(row.to_session_id)
          ? row.to_session_id
          : row.from_session_id;
      const taskSessionRow = sessionById.get(taskSessionId) ?? sessionById.get(row.from_session_id);
      const workspacePath = taskSessionRow
        ? getWorkspacePathFromMetadataJson({
            metadataJson: taskSessionRow.metadata_json,
            sessionId: taskSessionRow.id,
            userId: input.userId,
          })
        : null;
      const workspaceKey = workspacePath ?? '__unbound_workspace__';
      const group = groupsByWorkspace.get(workspaceKey) ?? {
        sessionIds: new Set<string>(),
        tasksById: new Map<string, TeamRuntimeTaskRecord>(),
        updatedAt: 0,
        workspacePath,
      };
      sessionIds.forEach((sessionId) => {
        const sessionRow = sessionById.get(sessionId);
        const sessionWorkspacePath = sessionRow
          ? getWorkspacePathFromMetadataJson({
              metadataJson: sessionRow.metadata_json,
              sessionId: sessionRow.id,
              userId: input.userId,
            })
          : null;
        if ((sessionWorkspacePath ?? '__unbound_workspace__') === workspaceKey) {
          group.sessionIds.add(sessionId);
        }
      });
      const title =
        typeof payload['goal'] === 'string' && payload['goal'].trim().length > 0
          ? payload['goal'].trim()
          : `执行任务 ${taskMarkerId}`;
      const updatedAt = Date.parse(row.updated_at) || Date.parse(row.created_at) || Date.now();
      const createdAt = Date.parse(row.created_at) || updatedAt;
      const startedAt =
        row.started_at && Date.parse(row.started_at) ? Date.parse(row.started_at) : undefined;
      const completedAt =
        row.completed_at && Date.parse(row.completed_at) ? Date.parse(row.completed_at) : undefined;
      const dependsOn = Array.isArray(payload['dependsOn'])
        ? payload['dependsOn'].filter(
            (dependency): dependency is string =>
              typeof dependency === 'string' && dependency.trim().length > 0,
          )
        : [];
      const assignedMember =
        typeof payload['assignedMember'] === 'object' &&
        payload['assignedMember'] !== null &&
        !Array.isArray(payload['assignedMember'])
          ? (payload['assignedMember'] as Record<string, unknown>)
          : null;
      const assignedAgent =
        typeof assignedMember?.['displayName'] === 'string'
          ? assignedMember['displayName']
          : typeof assignedMember?.['id'] === 'string'
            ? assignedMember['id']
            : undefined;
      const tags = [
        taskMarkerId,
        typeof payload['role'] === 'string' ? payload['role'] : null,
        typeof assignedMember?.['specialty'] === 'string' ? assignedMember['specialty'] : null,
      ].filter((tag): tag is string => typeof tag === 'string' && tag.length > 0);
      const taskThreadId = `handoff:${row.id}`;
      const taskId = `${taskThreadId}:${taskMarkerId}`;
      const nextTask: TeamRuntimeTaskRecord = {
        id: taskId,
        title,
        status: mapDispatchHandoffStateToTaskStatus(row.state),
        blockedBy: dependsOn.map((dependencyId) => {
          const legacyDependencyId = `handoff:${row.from_session_id}:${dependencyId}`;
          return projectedTaskIdByLegacyTaskId.get(legacyDependencyId) ?? legacyDependencyId;
        }),
        completedSubtaskCount: 0,
        readySubtaskCount: 0,
        sessionId: taskSessionId,
        ...(assignedAgent ? { assignedAgent } : {}),
        taskThreadId,
        priority: readDispatchTaskPriority(taskMarkers?.['priority']),
        tags,
        createdAt,
        updatedAt,
        ...(startedAt ? { startedAt } : {}),
        ...(completedAt ? { completedAt } : {}),
        depth: 0,
        subtaskCount: 0,
        unmetDependencyCount: dependsOn.length,
        ...(row.state === 'completed' ? { result: `handoff ${row.id} 已完成` } : {}),
        ...(row.failure_reason ? { errorMessage: row.failure_reason } : {}),
      };

      const current = group.tasksById.get(taskId);
      if (!current || nextTask.updatedAt > current.updatedAt) {
        group.tasksById.set(taskId, nextTask);
      }
      group.updatedAt = Math.max(group.updatedAt, nextTask.updatedAt);
      groupsByWorkspace.set(workspaceKey, group);
    }

    return Array.from(groupsByWorkspace.values()).map((group) => ({
      sessionIds: [...group.sessionIds],
      tasks: Array.from(group.tasksById.values()),
      updatedAt: group.updatedAt,
      workspacePath: group.workspacePath,
    }));
  };

  const mergeRuntimeTaskGroupsWithDispatchTasks = (input: {
    runtimeTaskGroups: TeamRuntimeTaskGroupRecord[];
    sessionRows: SessionRow[];
    userId: string;
  }): TeamRuntimeTaskGroupRecord[] =>
    mergeRuntimeTaskGroups([
      ...input.runtimeTaskGroups,
      ...buildRuntimeDispatchTasksFromHandoffs({
        sessionRows: input.sessionRows,
        userId: input.userId,
      }),
    ]);

  const listRuntimeClarifications = (input: { sessionIds: string[]; userId: string }) => {
    if (input.sessionIds.length === 0) {
      return [];
    }

    const placeholders = input.sessionIds.map(() => '?').join(', ');
    const rows = sqliteAll<RuntimeClarificationRow>(
      `SELECT id, user_id, to_session_id, payload_json, state, created_at
         FROM session_inbound_messages
        WHERE user_id = ?
          AND message_type = 'escalation_request'
          AND state IN ('pending', 'consumed')
          AND (expires_at IS NULL OR expires_at >= datetime('now'))
          AND to_session_id IN (${placeholders})
        ORDER BY created_at DESC
        LIMIT 200`,
      [input.userId, ...input.sessionIds],
    );

    const clarifications: Array<{
      answer?: string;
      answeredAt?: number;
      context: string;
      createdAt: number;
      fromSessionId: string;
      id: string;
      question: string;
      sessionId: string;
      status: 'answered' | 'dismissed' | 'pending';
    }> = [];

    for (const row of rows) {
      let payload: Record<string, unknown> | null = null;
      try {
        const parsed = JSON.parse(row.payload_json) as unknown;
        payload =
          typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : null;
      } catch {
        payload = null;
      }
      if (!payload || payload['reason'] !== 'needs_clarification') {
        continue;
      }
      const fromSessionId =
        typeof payload['fromSessionId'] === 'string' ? payload['fromSessionId'] : row.to_session_id;
      if (!input.sessionIds.includes(fromSessionId)) {
        continue;
      }
      const questions = Array.isArray(payload['questions']) ? payload['questions'] : [];
      for (const question of questions) {
        if (typeof question !== 'object' || question === null || Array.isArray(question)) {
          continue;
        }
        const record = question as Record<string, unknown>;
        if (typeof record['id'] !== 'string' || typeof record['question'] !== 'string') {
          continue;
        }
        const status =
          record['status'] === 'answered' || record['status'] === 'dismissed'
            ? record['status']
            : 'pending';
        clarifications.push({
          ...(typeof record['answer'] === 'string' ? { answer: record['answer'] } : {}),
          ...(typeof record['answeredAt'] === 'number' ? { answeredAt: record['answeredAt'] } : {}),
          context: typeof record['context'] === 'string' ? record['context'] : '',
          createdAt: Date.parse(row.created_at) || Date.now(),
          fromSessionId,
          id: record['id'],
          question: record['question'],
          sessionId: fromSessionId,
          status,
        });
      }
    }

    return clarifications;
  };

  const listRuntimeNotifications = (input: { sessionIds: string[]; userId: string }) => {
    if (input.sessionIds.length === 0) {
      return [];
    }

    const placeholders = input.sessionIds.map(() => '?').join(', ');
    const rows = sqliteAll<RuntimeNotificationRow>(
      `SELECT id, user_id, to_session_id, payload_json, created_at
         FROM session_inbound_messages
        WHERE user_id = ?
          AND message_type IN ('escalation_request', 'progress_report')
          AND state IN ('pending', 'consumed')
          AND (expires_at IS NULL OR expires_at >= datetime('now'))
          AND to_session_id IN (${placeholders})
        ORDER BY created_at DESC
        LIMIT 50`,
      [input.userId, ...input.sessionIds],
    );

    const notifications: Array<{
      layer?: string;
      payload: Record<string, unknown>;
      sessionId?: string;
      taskId?: string;
      timestamp: number;
      type: string;
    }> = [];

    for (const row of rows) {
      let payload: Record<string, unknown> | null = null;
      try {
        const parsed = JSON.parse(row.payload_json) as unknown;
        payload =
          typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : null;
      } catch {
        payload = null;
      }
      if (!payload) {
        continue;
      }

      const fromSessionId =
        typeof payload['fromSessionId'] === 'string' ? payload['fromSessionId'] : row.to_session_id;
      if (!input.sessionIds.includes(fromSessionId)) {
        continue;
      }

      if (payload['reason'] === 'needs_clarification') {
        continue;
      }

      if (typeof payload['progressText'] === 'string') {
        notifications.push({
          layer: typeof payload['fromLayer'] === 'string' ? payload['fromLayer'] : undefined,
          payload: {
            blocking: false,
            messageId: row.id,
            ...(typeof payload['fromSessionId'] === 'string'
              ? { fromSessionId: payload['fromSessionId'] }
              : {}),
            ...(typeof payload['handoffId'] === 'string'
              ? { handoffId: payload['handoffId'] }
              : typeof payload['pm2HandoffId'] === 'string'
                ? { handoffId: payload['pm2HandoffId'] }
                : {}),
            summary: payload['progressText'],
            ...(typeof payload['percent'] === 'number' ? { percent: payload['percent'] } : {}),
          },
          sessionId: fromSessionId,
          taskId: row.id,
          timestamp: Date.parse(row.created_at) || Date.now(),
          type: 'progress_report',
        });
        continue;
      }

      notifications.push({
        layer: typeof payload['fromLayer'] === 'string' ? payload['fromLayer'] : undefined,
        payload: {
          blocking: true,
          messageId: row.id,
          ...(typeof payload['fromSessionId'] === 'string'
            ? { fromSessionId: payload['fromSessionId'] }
            : {}),
          ...(typeof payload['handoffId'] === 'string'
            ? { handoffId: payload['handoffId'] }
            : typeof payload['pm2HandoffId'] === 'string'
              ? { handoffId: payload['pm2HandoffId'] }
              : {}),
          summary:
            typeof payload['context'] === 'string' ? payload['context'] : '需要用户处理的升级通知',
          ...(typeof payload['reason'] === 'string' ? { reason: payload['reason'] } : {}),
          ...(Array.isArray(payload['suggestedActions'])
            ? { suggestedActions: payload['suggestedActions'] }
            : {}),
        },
        sessionId: fromSessionId,
        taskId: row.id,
        timestamp: Date.parse(row.created_at) || Date.now(),
        type: 'escalation_request',
      });
    }

    return notifications.reverse();
  };

  const buildWorkspaceRuntimeTaskGroups = async (input: {
    sessionRows: SessionRow[];
    userId: string;
  }): Promise<TeamRuntimeTaskGroupRecord[]> => {
    return mergeRuntimeTaskGroups(
      await Promise.all(
        input.sessionRows.map(async (row) => {
          const workspacePath = getWorkspacePathFromMetadataJson({
            metadataJson: row.metadata_json,
            sessionId: row.id,
            userId: input.userId,
          });
          const includedSessionIds = new Set(input.sessionRows.map((sessionRow) => sessionRow.id));

          // Per-session resilience: buildMergedSessionTaskProjection loads task
          // graphs from disk and can throw on hard I/O. This runs inside
          // Promise.all over every workspace session, so one failing session
          // must not reject the whole team runtime dashboard. Degrade the bad
          // session to an empty task group + warn instead.
          try {
            const { tasks, updatedAt } = await buildMergedSessionTaskProjection({
              includedSessionIds,
              sessions: input.sessionRows,
              sessionId: row.id,
            });

            return {
              sessionIds: [row.id],
              tasks: tasks.filter((task) => task.status !== 'cancelled'),
              updatedAt,
              workspacePath,
            };
          } catch (error) {
            console.warn(
              `[team] 会话 ${row.id} 任务投影构建失败，降级为空任务组：${
                error instanceof Error ? error.message : String(error)
              }`,
            );
            return { sessionIds: [row.id], tasks: [], updatedAt: 0, workspacePath };
          }
        }),
      ),
    );
  };

  const countRowsForSessionIds = (input: {
    extraWhere?: string;
    sessionIds: string[];
    table: 'permission_requests' | 'question_requests' | 'session_runtime_threads';
  }): number => {
    if (input.sessionIds.length === 0) {
      return 0;
    }
    const placeholders = input.sessionIds.map(() => '?').join(', ');
    const row = sqliteGet<{ count: number }>(
      `SELECT COUNT(1) AS count
         FROM ${input.table}
        WHERE session_id IN (${placeholders})${input.extraWhere ? ` AND ${input.extraWhere}` : ''}`,
      input.sessionIds,
    );
    return row?.count ?? 0;
  };

  const countAffectedInteractionSessions = (sessionIds: string[]): number => {
    if (sessionIds.length === 0) {
      return 0;
    }
    const placeholders = sessionIds.map(() => '?').join(', ');
    const row = sqliteGet<{ count: number }>(
      `SELECT COUNT(DISTINCT session_id) AS count
         FROM (
           SELECT session_id
             FROM permission_requests
            WHERE session_id IN (${placeholders}) AND status IN ('pending', 'deciding')
           UNION ALL
           SELECT session_id
             FROM question_requests
            WHERE session_id IN (${placeholders}) AND status IN ('pending', 'deciding')
         ) interactions`,
      [...sessionIds, ...sessionIds],
    );
    return row?.count ?? 0;
  };

  const countStaleDecidingSessions = (sessionIds: string[]): number => {
    if (sessionIds.length === 0) {
      return 0;
    }
    const placeholders = sessionIds.map(() => '?').join(', ');
    const row = sqliteGet<{ count: number }>(
      `SELECT COUNT(DISTINCT session_id) AS count
         FROM (
           SELECT session_id
             FROM permission_requests
            WHERE session_id IN (${placeholders}) AND status = 'deciding' AND updated_at < datetime('now', '-10 minutes')
           UNION ALL
           SELECT session_id
             FROM question_requests
            WHERE session_id IN (${placeholders}) AND status = 'deciding' AND updated_at < datetime('now', '-10 minutes')
         ) interactions`,
      [...sessionIds, ...sessionIds],
    );
    return row?.count ?? 0;
  };

  const countFailedHandoffsForSessionIds = (sessionIds: string[]): number => {
    if (sessionIds.length === 0) {
      return 0;
    }
    const placeholders = sessionIds.map(() => '?').join(', ');
    const rows = sqliteAll<{ payload_json: string | null; to_role_layer: string }>(
      `SELECT payload_json, to_role_layer
         FROM handoff_records
        WHERE state = 'failed'
          AND (from_session_id IN (${placeholders}) OR to_session_id IN (${placeholders}))`,
      [...sessionIds, ...sessionIds],
    );
    return rows.filter(
      (row) =>
        !(row.to_role_layer === 'pm2' && isHandledReviewFailurePayloadJson(row.payload_json)),
    ).length;
  };

  const countRecoverableFailedHandoffsForSessionIds = (
    sessionIds: string[],
    userId: string,
  ): number => {
    if (sessionIds.length === 0) {
      return 0;
    }
    const placeholders = sessionIds.map(() => '?').join(', ');
    const rows = sqliteAll<{
      failure_reason: string | null;
      payload_json: string | null;
      to_role_layer: string;
    }>(
      `SELECT failure_reason, payload_json, to_role_layer
         FROM handoff_records
        WHERE user_id = ?
          AND state = 'failed'
          AND (from_session_id IN (${placeholders}) OR to_session_id IN (${placeholders}))`,
      [userId, ...sessionIds, ...sessionIds],
    );
    return rows.filter(
      (row) =>
        !(row.to_role_layer === 'pm2' && isHandledReviewFailurePayloadJson(row.payload_json)) &&
        isRecoverableFailedHandoff({
          failureReason: row.failure_reason,
          payloadJson: row.payload_json,
          toRoleLayer: row.to_role_layer,
        }),
    ).length;
  };

  const countArchitectureReviewBlockedForSessionIds = (sessionIds: string[]): number => {
    if (sessionIds.length === 0) {
      return 0;
    }
    const placeholders = sessionIds.map(() => '?').join(', ');
    const row = sqliteGet<{ count: number }>(
      `SELECT COUNT(1) AS count
         FROM handoff_records
        WHERE state = 'failed'
          AND json_extract(
            CASE WHEN json_valid(result_json) THEN result_json ELSE '{}' END,
            '$.architectureReview.passed'
          ) = 0
          AND (from_session_id IN (${placeholders}) OR to_session_id IN (${placeholders}))`,
      [...sessionIds, ...sessionIds],
    );
    return row?.count ?? 0;
  };

  const countUnhandledPm2ReviewFailuresForSessionIds = (input: {
    matchReviewDispositionAction: 'return-to-c' | 'escalate-to-user';
    sessionIds: string[];
    userId: string;
  }): number => {
    if (input.sessionIds.length === 0) {
      return 0;
    }
    const placeholders = input.sessionIds.map(() => '?').join(', ');
    const rows = sqliteAll<{
      failure_reason: string | null;
      payload_json: string | null;
    }>(
      `SELECT failure_reason, payload_json
         FROM handoff_records
        WHERE user_id = ?
          AND state = 'failed'
          AND to_role_layer = 'pm2'
          AND (from_session_id IN (${placeholders}) OR to_session_id IN (${placeholders}))`,
      [input.userId, ...input.sessionIds, ...input.sessionIds],
    );
    return rows.filter((row) => {
      if (isHandledReviewFailurePayloadJson(row.payload_json)) {
        return false;
      }
      const reviewDisposition = getEffectiveReviewDispositionFromPayloadJson(
        row.payload_json,
        row.failure_reason,
      );
      return reviewDisposition?.action === input.matchReviewDispositionAction;
    }).length;
  };

  const applyAlertControls = (input: {
    alerts: Array<{
      code: (typeof TEAM_RUNTIME_ALERT_CODE_VALUES)[number];
      firstDetectedAt: number;
      lastDetectedAt: number;
      message: string;
      note?: string | null;
      occurrenceCount: number;
      remediable?: boolean;
      resolvedAt: number | null;
      severity: 'critical' | 'warning' | 'info';
      status: 'ongoing' | 'open' | 'reopened' | 'resolved';
      suggestedAction: string;
      suppressedUntilMs?: number | null;
      controlUpdatedAt?: string;
    }>;
    userId: string;
  }) => {
    const nowMs = Date.now();
    const expiredSuppressedCodes = new Set(
      consumeExpiredSuppressedAlertControls({
        userId: input.userId,
        alertCodes: input.alerts.map((alert) => alert.code),
        nowMs,
      }),
    );
    const controls = new Map(
      listTeamRuntimeAlertControls({
        userId: input.userId,
        alertCodes: input.alerts.map((alert) => alert.code),
        nowMs,
      }).map((control) => [control.alertCode, control]),
    );

    return input.alerts.map((alert) => {
      if (expiredSuppressedCodes.has(alert.code)) {
        return {
          ...alert,
          note: null,
          suppressedUntilMs: null,
          controlUpdatedAt: undefined,
          status: 'reopened' as const,
        };
      }
      const control = controls.get(alert.code);
      if (!control) {
        return alert;
      }
      if (
        control.state === 'suppressed' &&
        control.suppressedUntilMs &&
        control.suppressedUntilMs > nowMs
      ) {
        return {
          ...alert,
          note: control.note,
          suppressedUntilMs: control.suppressedUntilMs,
          controlUpdatedAt: control.updatedAt,
          status: 'suppressed' as const,
        };
      }
      if (control.state === 'acknowledged') {
        return {
          ...alert,
          note: control.note,
          suppressedUntilMs: null,
          controlUpdatedAt: control.updatedAt,
          status: 'acknowledged' as const,
        };
      }
      return alert;
    });
  };

  const logRuntimeAlertControl = (input: {
    action: 'acknowledge' | 'clear' | 'suppress';
    actorEmail: string;
    actorUserId: string;
    alertCode: string;
    detail: Record<string, unknown>;
    sessionId?: string | null;
    userId: string;
  }) => {
    logTeamAudit({
      action: 'runtime_alert_control',
      actorEmail: input.actorEmail,
      actorUserId: input.actorUserId,
      detail: JSON.stringify(input.detail),
      entityId: input.alertCode,
      entityType: 'runtime_alert',
      sessionId: input.sessionId ?? null,
      summary: `runtime alert ${input.action}: ${input.alertCode}`,
      userId: input.userId,
    });
  };

  const executeRuntimeRemediation = async (input: {
    actorEmail: string;
    actorUserId: string;
    code: TeamRuntimeRemediationCode;
    force?: boolean;
    handoffId?: string;
    sessionId?: string;
    teamWorkspaceId?: string;
    workflowName: string;
  }) => {
    const scope = resolveRuntimeSessionScope({
      userId: input.actorUserId,
      teamWorkspaceId: input.teamWorkspaceId,
      sessionId: input.sessionId,
    });
    if (!scope) {
      throw new Error('team session not found');
    }
    const sessionIds = scope.sessionIds;
    const result = await runTeamRuntimeRemediation({
      code: input.code,
      ...(input.force ? { force: input.force } : {}),
      ...(input.handoffId ? { handoffId: input.handoffId } : {}),
      sessionIds,
      userId: input.actorUserId,
    });

    logTeamAudit({
      action: 'runtime_remediation',
      actorEmail: input.actorEmail,
      actorUserId: input.actorUserId,
      detail: JSON.stringify({
        failedSessionIds: result.failedSessionIds,
        force: input.force ?? false,
        handoffId: input.handoffId ?? null,
        pausedCount: result.pausedCount,
        resetCount: result.resetCount,
        sessionId: input.sessionId ?? null,
        staleCandidateCount: result.staleCandidateCount,
        teamWorkspaceId: input.teamWorkspaceId ?? null,
      }),
      entityId: input.code,
      entityType: 'runtime_alert',
      sessionId: input.sessionId ?? sessionIds[0] ?? null,
      summary: getTeamRuntimeRemediationSummary(input.code, result.staleCandidateCount),
      userId: input.actorUserId,
    });

    return {
      ...result,
      runtime: buildRuntimePreview({
        sessionIds,
        teamWorkspaceId: input.teamWorkspaceId,
        userId: input.actorUserId,
      }),
    };
  };

  const buildRuntimeDiagnostics = (input: {
    scopeMode?: 'session' | 'workspace';
    sessionIds: string[];
    userId: string;
  }) => {
    const staleBeforeMs = Date.now() - SESSION_RUNTIME_THREAD_STALE_AFTER_MS;
    const recentCutoffMs = Date.now() - 10 * 60 * 1000;
    const sessionIdSet = new Set(input.sessionIds);
    const isIncidentInScope = (incident: {
      context: Record<string, boolean | number | string | null>;
    }): boolean => {
      const candidateKeys = [
        'sessionId',
        'receptionSessionId',
        'fromSessionId',
        'toSessionId',
        'childSessionId',
      ] as const;
      return candidateKeys.some((key) => {
        const value = incident.context[key];
        return typeof value === 'string' && sessionIdSet.has(value);
      });
    };
    const shouldFilterIncidents = input.scopeMode === 'session';
    const recentIncidents = listTeamRuntimeIncidents({ limit: 100, userId: input.userId }).filter(
      (incident) =>
        incident.timestamp >= recentCutoffMs &&
        (!shouldFilterIncidents || isIncidentInScope(incident)),
    );
    const recentIncidentSummary = recentIncidents.reduce<
      Record<
        'architecture_review' | 'handoff_failure' | 'latency_violation' | 'team_events_connection' | 'team_events_listener',
        number
      >
    >(
      (acc, incident) => {
        acc[incident.category] += 1;
        return acc;
      },
      {
        architecture_review: 0,
        handoff_failure: 0,
        latency_violation: 0,
        team_events_connection: 0,
        team_events_listener: 0,
      },
    );
    const handledPm2ReviewCache = new Map<string, boolean>();
    const isHandledPm2ReviewIncident = (handoffId: string): boolean => {
      const cached = handledPm2ReviewCache.get(handoffId);
      if (cached !== undefined) {
        return cached;
      }
      const row = sqliteGet<{ payload_json: string | null; to_role_layer: string }>(
        `SELECT payload_json, to_role_layer FROM handoff_records WHERE id = ? LIMIT 1`,
        [handoffId],
      );
      const handled = Boolean(
        row?.to_role_layer === 'pm2' && isHandledReviewFailurePayloadJson(row.payload_json),
      );
      handledPm2ReviewCache.set(handoffId, handled);
      return handled;
    };
    const countRecentIncidentCode = (code: string): number =>
      recentIncidents.filter((incident) => {
        if (incident.code !== code) {
          return false;
        }
        const handoffId = incident.context['handoffId'];
        if (typeof handoffId !== 'string' || handoffId.length === 0) {
          return true;
        }
        if (
          code === 'handoff-quality-review-return-to-c' ||
          code === 'handoff-quality-review-escalate-to-user'
        ) {
          return !isHandledPm2ReviewIncident(handoffId);
        }
        return true;
      }).length;
    const pendingPermissionCount = countRowsForSessionIds({
      sessionIds: input.sessionIds,
      table: 'permission_requests',
      extraWhere: "status = 'pending'",
    });
    const decidingPermissionCount = countRowsForSessionIds({
      sessionIds: input.sessionIds,
      table: 'permission_requests',
      extraWhere: "status = 'deciding'",
    });
    const staleDecidingPermissionCount = countRowsForSessionIds({
      sessionIds: input.sessionIds,
      table: 'permission_requests',
      extraWhere: "status = 'deciding' AND updated_at < datetime('now', '-10 minutes')",
    });
    const pendingQuestionCount = countRowsForSessionIds({
      sessionIds: input.sessionIds,
      table: 'question_requests',
      extraWhere: "status = 'pending'",
    });
    const decidingQuestionCount = countRowsForSessionIds({
      sessionIds: input.sessionIds,
      table: 'question_requests',
      extraWhere: "status = 'deciding'",
    });
    const staleDecidingQuestionCount = countRowsForSessionIds({
      sessionIds: input.sessionIds,
      table: 'question_requests',
      extraWhere: "status = 'deciding' AND updated_at < datetime('now', '-10 minutes')",
    });
    const totalRuntimeThreadCount = countRowsForSessionIds({
      sessionIds: input.sessionIds,
      table: 'session_runtime_threads',
    });
    const activeRuntimeThreadCount = countRowsForSessionIds({
      sessionIds: input.sessionIds,
      table: 'session_runtime_threads',
      extraWhere: `heartbeat_at_ms >= ${staleBeforeMs}`,
    });
    const staleRuntimeThreadCount = countRowsForSessionIds({
      sessionIds: input.sessionIds,
      table: 'session_runtime_threads',
      extraWhere: `heartbeat_at_ms < ${staleBeforeMs}`,
    });
    const incidentSummary = listTeamRuntimeIncidents({ limit: 400, userId: input.userId })
      .filter((incident) => !shouldFilterIncidents || isIncidentInScope(incident))
      .reduce<
        Record<
          'architecture_review' | 'handoff_failure' | 'latency_violation' | 'team_events_connection' | 'team_events_listener',
          number
        >
      >(
        (acc, incident) => {
          acc[incident.category] += 1;
          return acc;
        },
        {
          architecture_review: 0,
          handoff_failure: 0,
          latency_violation: 0,
          team_events_connection: 0,
          team_events_listener: 0,
        },
      );
    const latency = getAllLatencyStats();
    const latencyViolationCount =
      latency.a_to_b_ack.violationCount +
      latency.a_to_b_direct.violationCount +
      latency.progress_interval.violationCount +
      latency.substate_push.violationCount;
    const currentFailedHandoffCount = countFailedHandoffsForSessionIds(input.sessionIds);
    const recoverableFailedHandoffCount = countRecoverableFailedHandoffsForSessionIds(
      input.sessionIds,
      input.userId,
    );
    const architectureReviewBlockedCount = countArchitectureReviewBlockedForSessionIds(
      input.sessionIds,
    );
    const telemetryEnabled = isTeamRuntimeTelemetryEnabled();
    const qualityReviewPendingRows = listPm2HandoffsPendingQualityReview({
      sessionIds: input.sessionIds,
      userId: input.userId,
    });
    const qualityReviewPendingCount = qualityReviewPendingRows.length;
    const qualityReviewRetryableErrorCount = qualityReviewPendingRows.filter(
      (row) => typeof row.lastError === 'string' && row.lastError.length > 0,
    ).length;
    const qualityReviewRedispatchCount = countRecentIncidentCode(
      'handoff-quality-review-redispatch',
    );
    const qualityReviewReturnToCCount = countUnhandledPm2ReviewFailuresForSessionIds({
      matchReviewDispositionAction: 'return-to-c',
      sessionIds: input.sessionIds,
      userId: input.userId,
    });
    const qualityReviewEscalateToUserCount = countUnhandledPm2ReviewFailuresForSessionIds({
      matchReviewDispositionAction: 'escalate-to-user',
      sessionIds: input.sessionIds,
      userId: input.userId,
    });
    const health = deriveTeamRuntimeHealth({
      architectureReviewBlockedCount,
      currentFailedHandoffCount,
      recoverableFailedHandoffCount,
      decidingInteractionCount: decidingPermissionCount + decidingQuestionCount,
      latencyViolationCount,
      pendingInteractionCount: pendingPermissionCount + pendingQuestionCount,
      qualityReviewPendingCount,
      qualityReviewRetryableErrorCount,
      qualityReviewEscalateToUserCount,
      qualityReviewRedispatchCount,
      qualityReviewReturnToCCount,
      recentTeamEventsConnectionCount: recentIncidentSummary.team_events_connection,
      recentTeamEventsListenerCount: recentIncidentSummary.team_events_listener,
      staleDecidingInteractionCount: staleDecidingPermissionCount + staleDecidingQuestionCount,
      staleRuntimeThreadCount,
    });
    const alerts = deriveTeamRuntimeAlerts({
      architectureReviewBlockedCount,
      currentFailedHandoffCount,
      recoverableFailedHandoffCount,
      health,
      latencyViolationCount,
      pendingInteractionCount: pendingPermissionCount + pendingQuestionCount,
      qualityReviewPendingCount,
      qualityReviewRetryableErrorCount,
      qualityReviewEscalateToUserCount,
      qualityReviewRedispatchCount,
      qualityReviewReturnToCCount,
      recentTeamEventsConnectionCount: recentIncidentSummary.team_events_connection,
      staleDecidingInteractionCount: staleDecidingPermissionCount + staleDecidingQuestionCount,
      staleRuntimeThreadCount,
      telemetryEnabled,
    });

    trackTeamRuntimeHealth({
      activeRuntimeThreadCount,
      health,
      incidentSummary: {
        architecture_review: architectureReviewBlockedCount,
        handoff_failure: currentFailedHandoffCount,
        latency_violation: latencyViolationCount,
        team_events_connection: recentIncidentSummary.team_events_connection,
        team_events_listener: recentIncidentSummary.team_events_listener,
      },
      pendingInteractionCount: pendingPermissionCount + pendingQuestionCount,
      staleRuntimeThreadCount,
      userId: input.userId,
    });
    const alertLifecycle = reconcileTeamRuntimeAlerts({
      alerts,
      capturedAtMs: Date.now(),
      userId: input.userId,
    });
    const activeAlerts = applyAlertControls({
      alerts: alertLifecycle.activeAlerts,
      userId: input.userId,
    });

    return {
      capturedAt: new Date().toISOString(),
      activeAlerts,
      incidents: listTeamRuntimeIncidents({ limit: 100, userId: input.userId })
        .filter((incident) => !shouldFilterIncidents || isIncidentInScope(incident))
        .slice(0, 20),
      incidentSummary,
      health,
      alerts,
      qualityReview: {
        escalateToUserCount: qualityReviewEscalateToUserCount,
        pendingCount: qualityReviewPendingCount,
        pendingHandoffs: qualityReviewPendingRows.map((row) => ({
          handoffId: row.handoffId,
          lastError: row.lastError,
          lastAttemptAtMs: row.lastAttemptAtMs,
          nextAttemptAtMs: row.nextAttemptAtMs,
          readyNow: row.readyNow,
          sessionId: row.sessionId,
        })),
        redispatchCount: qualityReviewRedispatchCount,
        retryableErrorCount: qualityReviewRetryableErrorCount,
        returnToCCount: qualityReviewReturnToCCount,
      },
      recentResolvedAlerts: alertLifecycle.recentResolvedAlerts,
      telemetry: {
        enabled: telemetryEnabled,
      },
      latency,
      pendingInteractions: {
        affectedSessionCount: countAffectedInteractionSessions(input.sessionIds),
        decidingPermissionCount,
        decidingQuestionCount,
        pendingPermissionCount,
        pendingQuestionCount,
        staleDecidingPermissionCount,
        staleDecidingQuestionCount,
        staleDecidingSessionCount: countStaleDecidingSessions(input.sessionIds),
      },
      runtimeThreads: {
        activeCount: activeRuntimeThreadCount,
        heartbeatIntervalMs: SESSION_RUNTIME_THREAD_HEARTBEAT_MS,
        staleAfterMs: SESSION_RUNTIME_THREAD_STALE_AFTER_MS,
        staleCount: staleRuntimeThreadCount,
        totalCount: totalRuntimeThreadCount,
      },
      teamEvents: getTeamEventsBusStats(),
    };
  };

  const buildRuntimePreview = (input: {
    sessionIds?: string[];
    teamWorkspaceId?: string;
    userId: string;
  }) => {
    const sessionIds =
      input.sessionIds ??
      listTeamRuntimeSessionRows({
        userId: input.userId,
        teamWorkspaceId: input.teamWorkspaceId,
      }).map((row) => row.id);
    return {
      diagnostics: buildRuntimeDiagnostics({
        scopeMode: input.sessionIds ? 'session' : 'workspace',
        sessionIds,
        userId: input.userId,
      }),
      sessionCount: sessionIds.length,
      teamWorkspaceId: input.teamWorkspaceId ?? null,
    };
  };

  const listCurrentActiveRuntimeAlertsForScope = (input: {
    teamWorkspaceId?: string;
    userId: string;
  }) => {
    const scope = resolveRuntimeSessionScope({
      userId: input.userId,
      teamWorkspaceId: input.teamWorkspaceId,
    });
    if (!scope) {
      return [];
    }
    return buildRuntimeDiagnostics({
      scopeMode: 'workspace',
      sessionIds: scope.sessionIds,
      userId: input.userId,
    }).activeAlerts;
  };

  app.get(
    '/team/workspaces',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'team.workspace.list');
      const user = request.user as JwtPayload;

      const rowsStep = child('query');
      const rows = sqliteAll<TeamWorkspaceRow>(
        `SELECT id, user_id, name, description, visibility, default_working_root, default_team_roster_json, created_at, updated_at
         FROM team_workspaces
         WHERE user_id = ?
         ORDER BY updated_at DESC, created_at DESC
        LIMIT 200`,
        [user.sub],
      );
      rowsStep.succeed(undefined, { count: rows.length });
      step.succeed(undefined, { count: rows.length });

      return reply.send(rows.map(mapWorkspaceRow));
    },
  );

  app.get(
    '/team/workspaces/:teamWorkspaceId',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const teamWorkspaceId = (request.params as { teamWorkspaceId: string }).teamWorkspaceId;
      const { step, child } = startRequestWorkflow(request, 'team.workspace.get', undefined, {
        teamWorkspaceId,
      });
      const user = request.user as JwtPayload;

      const queryStep = child('query');
      const row = sqliteGet<TeamWorkspaceRow>(
        `SELECT id, user_id, name, description, visibility, default_working_root, default_team_roster_json, created_at, updated_at
         FROM team_workspaces
         WHERE user_id = ? AND id = ?
         LIMIT 1`,
        [user.sub, teamWorkspaceId],
      );
      if (!row) {
        queryStep.fail('workspace not found');
        step.fail('workspace not found');
        return reply.status(404).send(teamRouteErrorPayload('team_workspace_not_found'));
      }
      queryStep.succeed();
      step.succeed(undefined, { teamWorkspaceId });

      return reply.send(mapWorkspaceRow(row));
    },
  );

  app.post(
    '/team/workspaces',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'team.workspace.create');
      const user = request.user as JwtPayload;
      const parseStep = child('parse-body');
      const body = parseBody(createWorkspaceSchema, request.body);
      parseStep.succeed();

      const teamWorkspaceId = randomUUID();
      const defaultTeamRoster = normalizeTeamWorkspaceDefaultRoster(
        body.defaultTeamRoster ?? cloneDefaultTeamRoster(),
      );
      sqliteRun(
        `INSERT INTO team_workspaces (
          id,
          user_id,
          name,
          description,
          visibility,
          default_working_root,
          default_team_roster_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          teamWorkspaceId,
          user.sub,
          body.name,
          body.description ?? null,
          body.visibility,
          body.defaultWorkingRoot ?? null,
          JSON.stringify(defaultTeamRoster),
        ],
      );

      const created = sqliteGet<TeamWorkspaceRow>(
        `SELECT id, user_id, name, description, visibility, default_working_root, default_team_roster_json, created_at, updated_at
         FROM team_workspaces
         WHERE user_id = ? AND id = ?
         LIMIT 1`,
        [user.sub, teamWorkspaceId],
      );
      step.succeed(undefined, { teamWorkspaceId });

      return reply.status(201).send(
        created
          ? mapWorkspaceRow(created)
          : {
              id: teamWorkspaceId,
              name: body.name,
              description: body.description ?? null,
              visibility: body.visibility,
              defaultWorkingRoot: body.defaultWorkingRoot ?? null,
              defaultTeamRoster,
              createdByUserId: user.sub,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
      );
    },
  );

  app.patch(
    '/team/workspaces/:teamWorkspaceId',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const teamWorkspaceId = (request.params as { teamWorkspaceId: string }).teamWorkspaceId;
      const { step, child } = startRequestWorkflow(request, 'team.workspace.update', undefined, {
        teamWorkspaceId,
      });
      const user = request.user as JwtPayload;

      const parseStep = child('parse-body');
      const body = parseBody(updateWorkspaceSchema, request.body);
      parseStep.succeed();

      const existing = sqliteGet<{ id: string }>(
        `SELECT id FROM team_workspaces WHERE user_id = ? AND id = ? LIMIT 1`,
        [user.sub, teamWorkspaceId],
      );
      if (!existing) {
        step.fail('workspace not found');
        return reply.status(404).send(teamRouteErrorPayload('team_workspace_not_found'));
      }

      const updates: string[] = [];
      const params: Array<string | null> = [];
      if (body.name !== undefined) {
        updates.push('name = ?');
        params.push(body.name);
      }
      if (body.description !== undefined) {
        updates.push('description = ?');
        params.push(body.description ?? null);
      }
      if (body.visibility !== undefined) {
        updates.push('visibility = ?');
        params.push(body.visibility);
      }
      if (body.defaultWorkingRoot !== undefined) {
        updates.push('default_working_root = ?');
        params.push(body.defaultWorkingRoot ?? null);
      }
      if (body.defaultTeamRoster !== undefined) {
        updates.push('default_team_roster_json = ?');
        params.push(JSON.stringify(normalizeTeamWorkspaceDefaultRoster(body.defaultTeamRoster)));
      }
      updates.push("updated_at = datetime('now')");

      sqliteRun(`UPDATE team_workspaces SET ${updates.join(', ')} WHERE user_id = ? AND id = ?`, [
        ...params,
        user.sub,
        teamWorkspaceId,
      ]);

      const updated = sqliteGet<TeamWorkspaceRow>(
        `SELECT id, user_id, name, description, visibility, default_working_root, default_team_roster_json, created_at, updated_at
         FROM team_workspaces
         WHERE user_id = ? AND id = ?
         LIMIT 1`,
        [user.sub, teamWorkspaceId],
      );
      if (!updated) {
        step.fail('workspace not found after update');
        return reply.status(404).send(teamRouteErrorPayload('team_workspace_not_found'));
      }
      step.succeed(undefined, { teamWorkspaceId });

      return reply.send(mapWorkspaceRow(updated));
    },
  );

  app.delete(
    '/team/workspaces/:teamWorkspaceId',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const teamWorkspaceId = (request.params as { teamWorkspaceId: string }).teamWorkspaceId;
      const { step } = startRequestWorkflow(request, 'team.workspace.delete', undefined, {
        teamWorkspaceId,
      });
      const user = request.user as JwtPayload;

      const existing = sqliteGet<{ id: string }>(
        `SELECT id FROM team_workspaces WHERE user_id = ? AND id = ? LIMIT 1`,
        [user.sub, teamWorkspaceId],
      );
      if (!existing) {
        step.fail('workspace not found');
        return reply.status(404).send(teamRouteErrorPayload('team_workspace_not_found'));
      }

      // 仅删除 team_workspaces 行；session 数据保留（仍然按 metadata_json
      // 中的 teamWorkspaceId 孤立存在），符合\"删除工作区不破坏历史会话\"的保守策略。
      sqliteRun(`DELETE FROM team_workspaces WHERE user_id = ? AND id = ?`, [
        user.sub,
        teamWorkspaceId,
      ]);

      step.succeed(undefined, { teamWorkspaceId });
      return reply.status(204).send();
    },
  );

  app.post(
    '/team/workspaces/:teamWorkspaceId/sessions',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const teamWorkspaceId = (request.params as { teamWorkspaceId: string }).teamWorkspaceId;
      const { step, child } = startRequestWorkflow(request, 'team.session.create', undefined, {
        teamWorkspaceId,
      });
      const user = request.user as JwtPayload;

      const parseStep = child('parse-body');
      const body = parseBody(createTeamSessionSchema, request.body);
      parseStep.succeed();

      const workspaceStep = child('resolve-workspace');
      const workspace = getTeamWorkspaceForUser(user.sub, teamWorkspaceId);
      if (!workspace) {
        workspaceStep.fail('workspace not found');
        step.fail('workspace not found');
        return reply.status(404).send(teamRouteErrorPayload('team_workspace_not_found'));
      }
      workspaceStep.succeed();

      let templateLookup: {
        id: string;
        name: string;
        teamTemplate: z.infer<typeof workflowTeamTemplateSchema>;
      } | null = null;
      if (body.source?.kind === 'saved-template' && body.source.templateId) {
        const templateStep = child('resolve-template');
        const templateRow = sqliteGet<WorkflowTemplateLookupRow>(
          `SELECT id, name, metadata_json
           FROM workflow_templates
           WHERE user_id = ? AND id = ?
           LIMIT 1`,
          [user.sub, body.source.templateId],
        );
        if (!templateRow) {
          templateStep.fail('template not found');
          step.fail('template not found');
          return reply.status(404).send(teamRouteErrorPayload('team_template_not_found'));
        }

        let parsedMetadata: unknown;
        try {
          parsedMetadata = JSON.parse(templateRow.metadata_json || '{}');
        } catch {
          templateStep.fail('template metadata invalid');
          step.fail('template metadata invalid');
          return reply.status(400).send(teamRouteErrorPayload('team_template_metadata_invalid'));
        }

        const teamTemplate = parseBody(
          workflowTeamTemplateSchema,
          (parsedMetadata as { teamTemplate?: unknown })?.teamTemplate,
        );

        templateLookup = {
          id: templateRow.id,
          name: templateRow.name,
          teamTemplate: teamTemplate,
        };
        templateStep.succeed(undefined, { templateId: templateRow.id });
      }

      const agentsStep = child('resolve-agents');
      const managedAgents = listManagedAgentsForUser(user.sub).filter((agent) => agent.enabled);
      const agentMap = new Map(managedAgents.map((agent) => [agent.id, agent]));
      const templateDefaultBindings = templateLookup?.teamTemplate.defaultBindings;
      const requiredRoleBindings = FIXED_TEAM_CORE_ROLE_ORDER.map((role) => {
        const templateBinding = templateDefaultBindings?.[role];
        const agentId =
          typeof templateBinding === 'object' && templateBinding?.agentId
            ? templateBinding.agentId
            : typeof templateBinding === 'string' && templateBinding.trim().length > 0
              ? templateBinding
              : FIXED_TEAM_CORE_ROLE_BINDINGS[role];
        return {
          role,
          agentId,
          ...(typeof templateBinding === 'object' && templateBinding?.providerId
            ? { providerId: templateBinding.providerId }
            : {}),
          ...(typeof templateBinding === 'object' && templateBinding?.modelId
            ? { modelId: templateBinding.modelId }
            : {}),
          ...(typeof templateBinding === 'object' && templateBinding?.variant
            ? { variant: templateBinding.variant }
            : {}),
        };
      });
      const invalidRequiredAgent = requiredRoleBindings.find(
        (binding) => !agentMap.has(binding.agentId),
      );
      if (invalidRequiredAgent) {
        agentsStep.fail('invalid required agent');
        step.fail('invalid required agent');
        return reply.status(400).send(
          teamRouteErrorPayload('team_required_agent_not_found', {
            agentId: invalidRequiredAgent.agentId,
            role: invalidRequiredAgent.role,
          }),
        );
      }

      const requiredAgentIds = new Set(requiredRoleBindings.map((binding) => binding.agentId));
      const optionalAgentIds = Array.from(
        new Set(
          body.optionalAgentIds.length > 0
            ? body.optionalAgentIds
            : (templateLookup?.teamTemplate.optionalAgentIds ?? []),
        ),
      );
      const invalidOptionalAgent = optionalAgentIds.find((agentId) => !agentMap.has(agentId));
      if (invalidOptionalAgent) {
        agentsStep.fail('invalid optional agent');
        step.fail('invalid optional agent');
        return reply.status(400).send(
          teamRouteErrorPayload('team_optional_agent_not_found', {
            agentId: invalidOptionalAgent,
          }),
        );
      }
      const overlappingOptionalAgent = optionalAgentIds.find((agentId) =>
        requiredAgentIds.has(agentId),
      );
      if (overlappingOptionalAgent) {
        agentsStep.fail('duplicate optional agent');
        step.fail('duplicate optional agent');
        return reply.status(400).send(
          teamRouteErrorPayload('team_optional_agent_duplicates_required', {
            agentId: overlappingOptionalAgent,
          }),
        );
      }
      agentsStep.succeed(undefined, {
        optional: optionalAgentIds.length,
        required: requiredRoleBindings.length,
      });

      const resolveLayerAgentId = (layer: string): string | null => {
        switch (layer) {
          case 'pm1':
            return FIXED_TEAM_CORE_ROLE_BINDINGS.planner;
          case 'pm2':
            return FIXED_TEAM_CORE_ROLE_BINDINGS.leader;
          case 'executor':
            return FIXED_TEAM_CORE_ROLE_BINDINGS.executor;
          case 'reviewer':
            return FIXED_TEAM_CORE_ROLE_BINDINGS.reviewer;
          default:
            return null;
        }
      };
      const rosterSource = normalizeTeamWorkspaceDefaultRoster(
        body.memberSlots && body.memberSlots.length > 0
          ? body.memberSlots
          : parseTeamWorkspaceDefaultRosterJson(workspace.default_team_roster_json),
      );
      const memberSlots = rosterSource.map((slot) => {
        const agentId = resolveLayerAgentId(slot.layer);
        const agent = agentId ? agentMap.get(agentId) : null;
        return {
          ...slot,
          ...(agent
            ? {
                agentId: agent.id,
                agentLabel: agent.label,
              }
            : {}),
        };
      });

      const teamDefinition = {
        createdAt: new Date().toISOString(),
        defaultProvider:
          body.defaultProvider ?? templateLookup?.teamTemplate.defaultProvider ?? null,
        memberSlots,
        optionalMembers: optionalAgentIds.map((agentId) => {
          const agent = agentMap.get(agentId)!;
          return {
            agentId: agent.id,
            agentLabel: agent.label,
            canonicalRole: agent.canonicalRole?.coreRole ?? null,
          };
        }),
        requiredRoleBindings: requiredRoleBindings.map((binding) => {
          const agent = agentMap.get(binding.agentId)!;
          return {
            agentId: agent.id,
            agentLabel: agent.label,
            role: binding.role,
            ...(binding.providerId ? { providerId: binding.providerId } : {}),
            ...(binding.modelId ? { modelId: binding.modelId } : {}),
            ...(binding.variant ? { variant: binding.variant } : {}),
          };
        }),
        source: {
          kind: body.source?.kind ?? 'blank',
          ...(body.source?.templateId ? { templateId: body.source.templateId } : {}),
          ...(templateLookup ? { templateName: templateLookup.name } : {}),
        },
        // 模板内置的快捷起始建议（D 项 starter chips）。前端 empty state 渲染为
        // chip，点击只填 composer 不直接发送（D31：starter 仍须用户主动确认）。
        ...(templateLookup?.teamTemplate.starterSuggestions
          ? { starterSuggestions: templateLookup.teamTemplate.starterSuggestions }
          : {}),
        version: 2,
      };

      const receptionModelSnapshot = await resolveReceptionModelSnapshot({
        memberSlots,
        userId: user.sub,
      });

      const metadataPatch = validateSessionMetadataPatch({
        ...(receptionModelSnapshot ?? {}),
        teamDefinition,
        teamWorkspaceId,
        workingDirectory: body.workingDirectory ?? workspace.default_working_root ?? undefined,
      });
      if (!metadataPatch.success) {
        step.fail('invalid metadata');
        return reply.status(400).send(
          teamRouteErrorPayload('team_session_metadata_invalid', {
            issues: metadataPatch.error.issues,
          }),
        );
      }

      const normalizedMetadata = normalizeIncomingSessionMetadata(metadataPatch.data);
      if (normalizedMetadata.workingDirectory === null) {
        step.fail('forbidden path');
        return reply.status(403).send(teamRouteErrorPayload('team_workspace_path_forbidden'));
      }

      normalizedMetadata.metadata = {
        ...normalizedMetadata.metadata,
        teamDefinition: {
          ...(typeof normalizedMetadata.metadata['teamDefinition'] === 'object' &&
          normalizedMetadata.metadata['teamDefinition'] !== null
            ? (normalizedMetadata.metadata['teamDefinition'] as Record<string, unknown>)
            : {}),
          createdAt: new Date().toISOString(),
          memberSlots,
          source: { kind: 'blank' as const },
          version: 2,
        },
      };

      const requestedParentSessionId = extractParentSessionIdFromMetadata(
        normalizedMetadata.metadata,
      );
      const parentValidation = validateParentSessionBinding({
        parentSessionId: requestedParentSessionId,
        userId: user.sub,
      });
      if (!parentValidation.ok) {
        step.fail(parentValidation.reason);
        return reply
          .status(parentValidation.statusCode)
          .send(mapTeamParentBindingError(parentValidation));
      }

      // 团队会话创建后进入「初始化阶段」：算出待办清单（纯读、零副作用）写入
      // metadata.teamInit，由前端逐项确认后再执行（team-init-runner）。失败不阻塞
      // 会话创建——降级为无初始化清单。
      try {
        const { planTeamInit } = await import('../team/init/team-init-planner.js');
        const teamInit = await planTeamInit({
          workingRoot:
            normalizedMetadata.workingDirectory ?? workspace.default_working_root ?? null,
          teamWorkspaceId,
          userId: user.sub,
        });
        normalizedMetadata.metadata = {
          ...normalizedMetadata.metadata,
          teamInit,
        };
      } catch (err) {
        request.log.warn(
          { err },
          '[team.session.create] planTeamInit failed; session created without init plan',
        );
      }

      // L1.3 §1.3 + L1.8：通过 b 层创建的 session 必须打上 reception 语义
      // （role_layer='reception'），否则 Watcher 后续无法把它当作 handoff 的
      // from_session_id，整条 b → c → d → e/f/g 链路无法挂载到这条会话上。
      // 这里改用 handoff/team-session-create.ts::createTeamSession 而不是
      // 直接 INSERT，统一与 Watcher 内部创建子 session 的语义。
      const sessionTitle = body.title?.trim() || workspace.name;
      const { sessionId } = createTeamSession({
        userId: user.sub,
        roleLayer: 'reception',
        teamParentSessionId: requestedParentSessionId ?? null,
        metadataJson: JSON.stringify(normalizedMetadata.metadata),
        title: sessionTitle,
      });
      step.succeed(undefined, { sessionId, teamWorkspaceId });

      const insertedSession = sqliteGet<{ metadata_json: string }>(
        `SELECT metadata_json FROM sessions WHERE id = ? LIMIT 1`,
        [sessionId],
      );

      return reply.status(201).send({
        id: sessionId,
        metadata_json:
          insertedSession?.metadata_json ?? JSON.stringify(normalizedMetadata.metadata),
        state_status: 'idle',
        title: sessionTitle,
      });
    },
  );

  app.post(
    '/team/workspaces/:teamWorkspaceId/threads',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      // ⚠️ DEPRECATED：保留作为兼容入口（v3.10 之前的"generic team thread"语义）。
      // 新代码请改用 POST /team/workspaces/:id/sessions（接受完整 source/optionalAgentIds/
      // defaultProvider，并且产出带 role_layer='reception' 的合法 b 层会话）。
      //
      // 退出策略（与 L1.4 §1.4.4 feature flag 退出策略对齐）：
      //   - 当前阶段：与 /sessions 共用同一会话创建路径，确保产出 reception session
      //   - Phase F：response header 加 deprecation 标记（运维埋点）
      //   - Phase G+：返回 410 Gone
      const teamWorkspaceId = (request.params as { teamWorkspaceId: string }).teamWorkspaceId;
      const { step, child } = startRequestWorkflow(request, 'team.thread.create', undefined, {
        teamWorkspaceId,
      });
      const user = request.user as JwtPayload;

      const parseStep = child('parse-body');
      const body = parseBody(createThreadSchema, request.body);
      parseStep.succeed();

      const workspaceStep = child('resolve-workspace');
      const workspace = sqliteGet<TeamWorkspaceRow>(
        `SELECT id, user_id, name, description, visibility, default_working_root, default_team_roster_json, created_at, updated_at
         FROM team_workspaces
         WHERE user_id = ? AND id = ?
         LIMIT 1`,
        [user.sub, teamWorkspaceId],
      );
      if (!workspace) {
        workspaceStep.fail('workspace not found');
        step.fail('workspace not found');
        return reply.status(404).send(teamRouteErrorPayload('team_workspace_not_found'));
      }
      workspaceStep.succeed();

      const metadataPatch = validateSessionMetadataPatch({
        ...body.metadata,
        teamWorkspaceId,
        workingDirectory: workspace.default_working_root ?? undefined,
      });
      if (!metadataPatch.success) {
        step.fail('invalid metadata');
        return reply.status(400).send(
          teamRouteErrorPayload('team_session_metadata_invalid', {
            issues: metadataPatch.error.issues,
          }),
        );
      }

      const normalizedMetadata = normalizeIncomingSessionMetadata(metadataPatch.data);
      if (normalizedMetadata.workingDirectory === null) {
        step.fail('forbidden path');
        return reply.status(403).send(teamRouteErrorPayload('team_workspace_path_forbidden'));
      }

      const legacyRosterSource = normalizeTeamWorkspaceDefaultRoster(
        parseTeamWorkspaceDefaultRosterJson(workspace.default_team_roster_json),
      );
      normalizedMetadata.metadata = {
        ...normalizedMetadata.metadata,
        teamDefinition: {
          ...(typeof normalizedMetadata.metadata['teamDefinition'] === 'object' &&
          normalizedMetadata.metadata['teamDefinition'] !== null
            ? (normalizedMetadata.metadata['teamDefinition'] as Record<string, unknown>)
            : {}),
          createdAt: new Date().toISOString(),
          memberSlots: legacyRosterSource,
          source: { kind: 'blank' as const },
          version: 2,
        },
      };

      const legacyReceptionModelSnapshot = await resolveReceptionModelSnapshot({
        memberSlots: legacyRosterSource,
        userId: user.sub,
      });

      normalizedMetadata.metadata = {
        ...normalizedMetadata.metadata,
        ...(legacyReceptionModelSnapshot ?? {}),
      };

      const requestedParentSessionId = extractParentSessionIdFromMetadata(
        normalizedMetadata.metadata,
      );
      const parentValidation = validateParentSessionBinding({
        parentSessionId: requestedParentSessionId,
        userId: user.sub,
      });
      if (!parentValidation.ok) {
        step.fail(parentValidation.reason);
        return reply
          .status(parentValidation.statusCode)
          .send(mapTeamParentBindingError(parentValidation));
      }

      // 与 /sessions 路径产出语义一致的 reception session
      const sessionTitle = body.title?.trim() || workspace.name;
      const { sessionId } = createTeamSession({
        userId: user.sub,
        roleLayer: 'reception',
        teamParentSessionId: requestedParentSessionId ?? null,
        metadataJson: JSON.stringify(normalizedMetadata.metadata),
        title: sessionTitle,
      });
      step.succeed(undefined, { sessionId, teamWorkspaceId });

      // Deprecation 提示：让客户端日志能看到这条警告
      reply.header('Deprecation', 'true');
      reply.header('Sunset', 'use POST /team/workspaces/:id/sessions instead');

      const insertedSession = sqliteGet<{ metadata_json: string }>(
        `SELECT metadata_json FROM sessions WHERE id = ? LIMIT 1`,
        [sessionId],
      );

      return reply.status(201).send({
        id: sessionId,
        metadata_json:
          insertedSession?.metadata_json ?? JSON.stringify(normalizedMetadata.metadata),
        state_status: 'idle',
        title: sessionTitle,
      });
    },
  );

  app.post(
    '/team/workspaces/:teamWorkspaceId/imports',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const teamWorkspaceId = (request.params as { teamWorkspaceId: string }).teamWorkspaceId;
      const { step, child } = startRequestWorkflow(request, 'team.workspace.import', undefined, {
        teamWorkspaceId,
      });
      const user = request.user as JwtPayload;

      const workspaceStep = child('workspace');
      const workspace = sqliteGet<TeamWorkspaceRow>(
        `SELECT id, user_id, name, description, visibility, default_working_root, default_team_roster_json, created_at, updated_at
         FROM team_workspaces
         WHERE user_id = ? AND id = ?
         LIMIT 1`,
        [user.sub, teamWorkspaceId],
      );
      if (!workspace) {
        workspaceStep.fail('workspace not found');
        step.fail('workspace not found');
        return reply.status(404).send(teamRouteErrorPayload('team_workspace_not_found'));
      }
      workspaceStep.succeed();

      const parseStep = child('parse-body');
      const body = parseBody(importWorkspaceSessionSchema, request.body);
      parseStep.succeed();

      const normalizedMessages = normalizeImportedMessages(body.messages);
      const validation = validateImportedMessagesPayload(normalizedMessages);
      if (!validation.ok) {
        step.fail('import too large');
        return reply
          .status(413)
          .send(
            teamRouteErrorPayload('team_import_payload_too_large', { detail: validation.error }),
          );
      }

      const sessionId = randomUUID();
      sqliteRun(
        'INSERT INTO sessions (id, user_id, messages_json, state_status, metadata_json, title) VALUES (?, ?, ?, ?, ?, ?)',
        [
          sessionId,
          user.sub,
          validation.serializedMessages,
          'idle',
          JSON.stringify({
            teamWorkspaceId,
            workingDirectory: workspace.default_working_root ?? undefined,
          }),
          workspace.name,
        ],
      );
      step.succeed(undefined, { sessionId, teamWorkspaceId, messages: normalizedMessages.length });

      return reply.status(201).send({ sessionId });
    },
  );

  app.get(
    '/team/workspaces/:teamWorkspaceId/runtime',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const teamWorkspaceId = (request.params as { teamWorkspaceId: string }).teamWorkspaceId;
      const { step, child } = startRequestWorkflow(
        request,
        'team.workspace-runtime.get',
        undefined,
        {
          teamWorkspaceId,
        },
      );
      const user = request.user as JwtPayload;

      const workspaceStep = child('workspace');
      const workspace = sqliteGet<TeamWorkspaceRow>(
        `SELECT id, user_id, name, description, visibility, default_working_root, default_team_roster_json, created_at, updated_at
         FROM team_workspaces
         WHERE user_id = ? AND id = ?
         LIMIT 1`,
        [user.sub, teamWorkspaceId],
      );
      if (!workspace) {
        workspaceStep.fail('workspace not found');
        step.fail('workspace not found');
        return reply.status(404).send(teamRouteErrorPayload('team_workspace_not_found'));
      }
      workspaceStep.succeed();

      const sessionsStep = child('sessions');
      const scopedSessionRows = listTeamRuntimeSessionRows({ userId: user.sub, teamWorkspaceId });
      const scopedSessionIds = new Set(scopedSessionRows.map((row) => row.id));
      sessionsStep.succeed(undefined, { count: scopedSessionRows.length });

      const sharesStep = child('session-shares');
      const shareRows = listTeamSessionShareRows({ userId: user.sub, teamWorkspaceId }).filter(
        (row) => scopedSessionIds.has(row.session_id),
      );
      sharesStep.succeed(undefined, { count: shareRows.length });

      const sharedSessionsStep = child('shared-with-me');
      const sharedSessionAccessRecords = listSharedSessionsForRecipient({
        email: user.email,
        limit: 24,
        offset: 0,
        teamWorkspaceId,
      });
      const sharedSessions = sharedSessionAccessRecords.map((sharedSession) => ({
        sessionId: sharedSession.session.id,
        title: sharedSession.session.title,
        stateStatus: sharedSession.session.stateStatus,
        workspacePath: sharedSession.session.workspacePath,
        sharedByEmail: sharedSession.sharedByEmail,
        permission: sharedSession.permission,
        createdAt: sharedSession.session.createdAt,
        updatedAt: sharedSession.session.updatedAt,
        shareCreatedAt: sharedSession.shareCreatedAt,
        shareUpdatedAt: sharedSession.shareUpdatedAt,
      }));
      sharedSessionsStep.succeed(undefined, { count: sharedSessions.length });

      const runtimeTaskGroupsStep = child('runtime-task-groups');
      const projectedRuntimeTaskGroups = await buildWorkspaceRuntimeTaskGroups({
        sessionRows: scopedSessionRows,
        userId: user.sub,
      });
      const runtimeTaskGroups = mergeRuntimeTaskGroupsWithDispatchTasks({
        runtimeTaskGroups: projectedRuntimeTaskGroups,
        sessionRows: scopedSessionRows,
        userId: user.sub,
      });
      runtimeTaskGroupsStep.succeed(undefined, { count: runtimeTaskGroups.length });

      const scopedSessionIdList = scopedSessionRows.map((row) => row.id);
      const handoffsStep = child('handoffs');
      const handoffs = listRuntimeHandoffs({
        sessionIds: scopedSessionIdList,
        userId: user.sub,
      });
      handoffsStep.succeed(undefined, { count: handoffs.length });

      const clarificationsStep = child('clarifications');
      const clarifications = listRuntimeClarifications({
        sessionIds: scopedSessionIdList,
        userId: user.sub,
      });
      clarificationsStep.succeed(undefined, { count: clarifications.length });

      const notificationsStep = child('notifications');
      const notifications = listRuntimeNotifications({
        sessionIds: scopedSessionIdList,
        userId: user.sub,
      });
      notificationsStep.succeed(undefined, { count: notifications.length });

      step.succeed(undefined, {
        handoffCount: handoffs.length,
        sessionCount: scopedSessionRows.length,
        sharedSessionCount: sharedSessions.length,
        teamWorkspaceId,
      });

      return reply.send({
        clarifications,
        handoffs,
        notifications,
        runtimeTaskGroups,
        sessionShares: shareRows.map((row) => mapSessionShareRow(user.sub, row)),
        sessions: scopedSessionRows.map((row) => mapRuntimeSessionRow(user.sub, row)),
        sharedSessions,
        workspace: mapWorkspaceRow(workspace),
      });
    },
  );

  app.get(
    '/team/runtime',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'team.runtime.get');
      const user = request.user as JwtPayload;

      const queryStep = child('parse-query');
      const query = parseQuery(teamRuntimeQuerySchema, request.query);
      queryStep.succeed(undefined, query.teamWorkspaceId ? query : undefined);

      if (query.teamWorkspaceId) {
        const workspaceStep = child('workspace');
        const workspace = getTeamWorkspaceForUser(user.sub, query.teamWorkspaceId);
        if (!workspace) {
          workspaceStep.fail('workspace not found');
          step.fail('workspace not found');
          return reply.status(404).send(teamRouteErrorPayload('team_workspace_not_found'));
        }
        workspaceStep.succeed(undefined, { teamWorkspaceId: workspace.id });
      }

      const sessionScope =
        query.sessionId || query.teamWorkspaceId
          ? resolveRuntimeSessionScope({
              userId: user.sub,
              teamWorkspaceId: query.teamWorkspaceId,
              sessionId: query.sessionId,
            })
          : null;
      if (query.sessionId && !sessionScope) {
        step.fail('session not found in team runtime scope');
        return reply.status(404).send(teamRouteErrorPayload('team_session_not_found'));
      }

      // Run independent sync queries together, then overlap async task projection
      // with remaining sync work that doesn't depend on its result.
      const membersStep = child('members');
      const tasksStep = child('tasks');
      const messagesStep = child('messages');
      const sessionsStep = child('sessions');

      const [memberRows, taskRows, messageRows, sessionRows] = [
        sqliteAll<MemberRow>(
          `SELECT id, name, email, role, avatar_url, status, created_at FROM team_members WHERE user_id = ? ORDER BY created_at ASC`,
          [user.sub],
        ),
        sqliteAll<TaskRow>(
          `SELECT id, title, assignee_id, status, priority, result, created_at, updated_at FROM team_tasks WHERE user_id = ? ORDER BY created_at DESC LIMIT 500`,
          [user.sub],
        ),
        sqliteAll<MessageRow>(
          `SELECT id, session_id, sender_id, recipient_member_id, reply_to_message_id, content, type, created_at
             FROM (
               SELECT
                 rowid,
                 id,
                 session_id,
                 sender_id,
                 recipient_member_id,
                 reply_to_message_id,
                 content,
                 type,
                 created_at
               FROM team_messages
               WHERE user_id = ?
               ORDER BY rowid DESC
               LIMIT 100
             )
            ORDER BY rowid ASC`,
          [user.sub],
        ),
        sessionScope?.sessionRows ??
          listTeamRuntimeSessionRows({
            userId: user.sub,
            teamWorkspaceId: query.teamWorkspaceId,
          }),
      ];

      membersStep.succeed(undefined, { count: memberRows.length });
      tasksStep.succeed(undefined, { count: taskRows.length });
      messagesStep.succeed(undefined, { count: messageRows.length });

      const scopedSessionRows = sessionScope
        ? sessionRows.filter((row) => sessionScope.sessionIds.includes(row.id))
        : sessionRows;
      const teamSessionIds = new Set(scopedSessionRows.map((row) => row.id));
      sessionsStep.succeed(undefined, { count: scopedSessionRows.length });

      const sharesStep = child('session-shares');
      const shareRows = listTeamSessionShareRows({
        userId: user.sub,
        teamWorkspaceId: query.teamWorkspaceId,
      }).filter((row) => teamSessionIds.has(row.session_id));
      sharesStep.succeed(undefined, { count: shareRows.length });

      // Kick off async runtime task groups immediately — they are the slowest part.
      // Run remaining sync queries (audit, shared sessions) in parallel with the async work.
      const sharedSessionAccessRecords = listSharedSessionsForRecipient({
        email: user.email,
        limit: 24,
        offset: 0,
        ...(query.teamWorkspaceId
          ? { teamWorkspaceId: query.teamWorkspaceId }
          : { onlyTeamSessions: true }),
      });

      const runtimeTaskGroupsPromise = Promise.all(
        sharedSessionAccessRecords.map(async (sharedSession) => {
          const workspacePath = sharedSession.session.workspacePath ?? null;
          const relatedSessionRows = scopedSessionRows.filter(
            (row) =>
              getWorkspacePathFromMetadataJson({
                metadataJson: row.metadata_json,
                sessionId: row.id,
                userId: user.sub,
              }) === workspacePath,
          );
          const includedSessionIds = new Set(relatedSessionRows.map((sessionRow) => sessionRow.id));
          if (!includedSessionIds.has(sharedSession.session.id)) {
            includedSessionIds.add(sharedSession.session.id);
          }

          // Per-session resilience (same as buildWorkspaceRuntimeTaskGroups):
          // one shared session's task-graph load throwing must not reject the
          // whole dashboard Promise.all. Degrade to an empty task group + warn.
          try {
            const { tasks, updatedAt } = await buildMergedSessionTaskProjection({
              includedSessionIds,
              sessions: scopedSessionRows,
              sessionId: sharedSession.session.id,
            });

            return {
              sessionIds: [sharedSession.session.id],
              tasks: tasks.filter((task) => task.status !== 'cancelled'),
              updatedAt,
              workspacePath,
            };
          } catch (error) {
            console.warn(
              `[team] 共享会话 ${sharedSession.session.id} 任务投影构建失败，降级为空任务组：${
                error instanceof Error ? error.message : String(error)
              }`,
            );
            return {
              sessionIds: [sharedSession.session.id],
              tasks: [],
              updatedAt: 0,
              workspacePath,
            };
          }
        }),
      );

      // While async task projection runs, do the remaining sync work.
      const auditStep = child('audit-logs');
      const auditLogs = listTeamAuditLogs({ userId: user.sub, limit: 24 });
      auditStep.succeed(undefined, { count: auditLogs.length });

      const sharedSessionsStep = child('shared-with-me');
      const sharedSessions = sharedSessionAccessRecords.map((sharedSession) => ({
        sessionId: sharedSession.session.id,
        title: sharedSession.session.title,
        stateStatus: sharedSession.session.stateStatus,
        workspacePath: sharedSession.session.workspacePath,
        sharedByEmail: sharedSession.sharedByEmail,
        permission: sharedSession.permission,
        createdAt: sharedSession.session.createdAt,
        updatedAt: sharedSession.session.updatedAt,
        shareCreatedAt: sharedSession.shareCreatedAt,
        shareUpdatedAt: sharedSession.shareUpdatedAt,
      }));
      sharedSessionsStep.succeed(undefined, { count: sharedSessions.length });

      // Await the async task projection — by now sync work is done, so this
      // only blocks for the remaining async duration.
      const runtimeTaskGroupsStep = child('runtime-task-groups');
      const runtimeTaskGroups = mergeRuntimeTaskGroupsWithDispatchTasks({
        runtimeTaskGroups: mergeRuntimeTaskGroups(await runtimeTaskGroupsPromise),
        sessionRows: scopedSessionRows,
        userId: user.sub,
      });
      runtimeTaskGroupsStep.succeed(undefined, { count: runtimeTaskGroups.length });

      const handoffsStep = child('handoffs');
      const handoffs = listRuntimeHandoffs({
        sessionIds: scopedSessionRows.map((row) => row.id),
        userId: user.sub,
      });
      handoffsStep.succeed(undefined, { count: handoffs.length });

      const clarificationsStep = child('clarifications');
      const clarifications = listRuntimeClarifications({
        sessionIds: scopedSessionRows.map((row) => row.id),
        userId: user.sub,
      });
      clarificationsStep.succeed(undefined, { count: clarifications.length });

      const notificationsStep = child('notifications');
      const notifications = listRuntimeNotifications({
        sessionIds: scopedSessionRows.map((row) => row.id),
        userId: user.sub,
      });
      notificationsStep.succeed(undefined, { count: notifications.length });

      const usageRecordsStep = child('usage-records');
      const usageRecords = listTeamUsageRecords({
        sessionIds: scopedSessionRows.map((row) => row.id),
        userId: user.sub,
      });
      usageRecordsStep.succeed(undefined, { count: usageRecords.length });

      const toolCallRecordsStep = child('tool-call-records');
      const toolCallRecords = listTeamToolCallRecords({
        sessionIds: scopedSessionRows.map((row) => row.id),
        userId: user.sub,
      });
      toolCallRecordsStep.succeed(undefined, { count: toolCallRecords.length });

      const response = {
        auditLogs,
        clarifications,
        diagnostics: buildRuntimeDiagnostics({
          scopeMode: query.sessionId ? 'session' : 'workspace',
          sessionIds: scopedSessionRows.map((row) => row.id),
          userId: user.sub,
        }),
        handoffs,
        members: memberRows.map((row) => ({
          id: row.id,
          name: row.name,
          email: row.email,
          role: row.role,
          avatarUrl: row.avatar_url,
          status: normalizeMemberStatus(row.status),
          createdAt: row.created_at,
        })),
        messages: messageRows.map((row) => ({
          id: row.id,
          sessionId: row.session_id,
          memberId: row.sender_id ?? 'system',
          recipientMemberId: row.recipient_member_id,
          replyToMessageId: row.reply_to_message_id,
          content: row.content,
          type:
            row.type === 'update' ||
            row.type === 'question' ||
            row.type === 'result' ||
            row.type === 'error'
              ? row.type
              : 'update',
          timestamp: Date.parse(row.created_at) || Date.now(),
        })),
        notifications,
        sessionShares: shareRows.map((row) => mapSessionShareRow(user.sub, row)),
        sessions: scopedSessionRows.map((row) => mapRuntimeSessionRow(user.sub, row)),
        sharedSessions,
        runtimeTaskGroups,
        toolCallRecords,
        usageRecords,
        tasks: taskRows.map((row) => ({
          id: row.id,
          title: row.title,
          assigneeId: row.assignee_id,
          status: row.status === 'done' ? 'completed' : row.status,
          priority: row.priority,
          result: row.result,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        })),
      };

      step.succeed(undefined, {
        auditLogCount: auditLogs.length,
        memberCount: response.members.length,
        sessionCount: response.sessions.length,
        sharedSessionCount: response.sharedSessions.length,
        taskCount: response.tasks.length,
      });

      return reply.send(response);
    },
  );

  app.post(
    '/team/runtime/remediations/reconcile-stale-threads',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(
        request,
        'team.runtime.remediation.reconcile-stale-threads',
      );
      const user = request.user as JwtPayload;

      const queryStep = child('parse-query');
      const query = parseQuery(teamRuntimeRemediationQuerySchema, request.query);
      queryStep.succeed(undefined, query.teamWorkspaceId || query.sessionId ? query : undefined);

      if (
        query.sessionId &&
        !resolveRuntimeSessionScope({
          userId: user.sub,
          teamWorkspaceId: query.teamWorkspaceId,
          sessionId: query.sessionId,
        })
      ) {
        step.fail('session not found');
        return reply.status(404).send(teamRouteErrorPayload('team_session_not_found'));
      }

      const candidateStep = child('collect-candidates');
      const result = await executeRuntimeRemediation({
        actorEmail: user.email,
        actorUserId: user.sub,
        code: 'stale-runtime-threads',
        sessionId: query.sessionId,
        teamWorkspaceId: query.teamWorkspaceId,
        workflowName: 'team.runtime.remediation.reconcile-stale-threads',
      });
      candidateStep.succeed(undefined, { count: result.staleCandidateCount });

      step.succeed(undefined, {
        failedCount: result.failedSessionIds.length,
        pausedCount: result.pausedCount,
        resetCount: result.resetCount,
        staleCandidateCount: result.staleCandidateCount,
      });
      return reply.send(result);
    },
  );

  app.post(
    '/team/runtime/remediations/release-stale-decisions',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(
        request,
        'team.runtime.remediation.release-stale-decisions',
      );
      const user = request.user as JwtPayload;

      const queryStep = child('parse-query');
      const query = parseQuery(teamRuntimeRemediationQuerySchema, request.query);
      queryStep.succeed(undefined, query.teamWorkspaceId || query.sessionId ? query : undefined);

      if (
        query.sessionId &&
        !resolveRuntimeSessionScope({
          userId: user.sub,
          teamWorkspaceId: query.teamWorkspaceId,
          sessionId: query.sessionId,
        })
      ) {
        step.fail('session not found');
        return reply.status(404).send(teamRouteErrorPayload('team_session_not_found'));
      }

      const candidateStep = child('collect-candidates');
      const result = await executeRuntimeRemediation({
        actorEmail: user.email,
        actorUserId: user.sub,
        code: 'stale-decisions',
        sessionId: query.sessionId,
        teamWorkspaceId: query.teamWorkspaceId,
        workflowName: 'team.runtime.remediation.release-stale-decisions',
      });
      candidateStep.succeed(undefined, { count: result.staleCandidateCount });

      step.succeed(undefined, {
        failedCount: result.failedSessionIds.length,
        pausedCount: result.pausedCount,
        resetCount: result.resetCount,
        staleCandidateCount: result.staleCandidateCount,
      });
      return reply.send(result);
    },
  );

  app.post(
    '/team/runtime/alerts/:alertCode/remediate',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'team.runtime.alert.remediate');
      const user = request.user as JwtPayload;
      const alertCode = teamRuntimeAlertCodeSchema.parse(
        (request.params as { alertCode: string }).alertCode,
      );
      if (!isTeamRuntimeRemediationCode(alertCode)) {
        step.fail('alert has no remediation');
        return reply.status(409).send(teamRouteErrorPayload('team_runtime_alert_no_remediation'));
      }

      const queryStep = child('parse-query');
      const query = parseQuery(teamRuntimeRemediationQuerySchema, request.query);
      queryStep.succeed(undefined, query.teamWorkspaceId || query.sessionId ? query : undefined);

      if (
        query.sessionId &&
        !resolveRuntimeSessionScope({
          userId: user.sub,
          teamWorkspaceId: query.teamWorkspaceId,
          sessionId: query.sessionId,
        })
      ) {
        step.fail('session not found');
        return reply.status(404).send(teamRouteErrorPayload('team_session_not_found'));
      }

      const activeAlert = listCurrentActiveRuntimeAlertsForScope({
        userId: user.sub,
        teamWorkspaceId: query.teamWorkspaceId,
      }).find((alert) => alert.code === alertCode);
      if (!activeAlert) {
        step.fail('alert not active');
        return reply.status(404).send(teamRouteErrorPayload('team_runtime_alert_not_active'));
      }

      const candidateStep = child('collect-candidates');
      const result = await executeRuntimeRemediation({
        actorEmail: user.email,
        actorUserId: user.sub,
        code: alertCode,
        ...(query.force ? { force: query.force } : {}),
        ...(query.handoffId ? { handoffId: query.handoffId } : {}),
        ...(query.sessionId ? { sessionId: query.sessionId } : {}),
        teamWorkspaceId: query.teamWorkspaceId,
        workflowName: 'team.runtime.alert.remediate',
      });
      candidateStep.succeed(undefined, { count: result.staleCandidateCount });

      step.succeed(undefined, {
        alertCode,
        failedCount: result.failedSessionIds.length,
        staleCandidateCount: result.staleCandidateCount,
      });
      return reply.send(result);
    },
  );

  app.post(
    '/team/runtime/alerts/:alertCode/acknowledge',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'team.runtime.alert.acknowledge');
      const user = request.user as JwtPayload;
      const alertCode = teamRuntimeAlertCodeSchema.parse(
        (request.params as { alertCode: string }).alertCode,
      );
      const queryStep = child('parse-query');
      const query = parseQuery(teamRuntimeQuerySchema, request.query);
      queryStep.succeed(undefined, query.teamWorkspaceId || query.sessionId ? query : undefined);
      const parseStep = child('parse-body');
      const body = parseBody(acknowledgeAlertSchema, request.body ?? {});
      parseStep.succeed();

      if (query.teamWorkspaceId) {
        const workspaceStep = child('workspace');
        const workspace = getTeamWorkspaceForUser(user.sub, query.teamWorkspaceId);
        if (!workspace) {
          workspaceStep.fail('workspace not found');
          step.fail('workspace not found');
          return reply.status(404).send(teamRouteErrorPayload('team_workspace_not_found'));
        }
        workspaceStep.succeed(undefined, { teamWorkspaceId: workspace.id });
      }

      const sessionScope = resolveRuntimeSessionScope({
        userId: user.sub,
        teamWorkspaceId: query.teamWorkspaceId,
        sessionId: query.sessionId,
      });
      if (!sessionScope) {
        step.fail('session not found');
        return reply.status(404).send(teamRouteErrorPayload('team_session_not_found'));
      }

      const active = listCurrentActiveRuntimeAlertsForScope({
        userId: user.sub,
        teamWorkspaceId: query.teamWorkspaceId,
      }).find((alert) => alert.code === alertCode);
      if (!active) {
        step.fail('alert not active');
        return reply.status(404).send(teamRouteErrorPayload('team_runtime_alert_not_active'));
      }

      const control = upsertTeamRuntimeAlertControl({
        alertCode,
        note: body.note ?? null,
        state: 'acknowledged',
        userId: user.sub,
      });
      logRuntimeAlertControl({
        action: 'acknowledge',
        actorEmail: user.email,
        actorUserId: user.sub,
        alertCode,
        detail: {
          note: body.note ?? null,
          state: control.state,
        },
        sessionId: query.sessionId ?? null,
        userId: user.sub,
      });
      step.succeed(undefined, { alertCode });
      return reply.send({
        control: {
          alertCode: control.alertCode,
          note: control.note,
          state: control.state,
          suppressedUntilMs: control.suppressedUntilMs,
          updatedAt: control.updatedAt,
        },
        runtime: buildRuntimePreview({
          sessionIds: sessionScope.sessionIds,
          teamWorkspaceId: query.teamWorkspaceId,
          userId: user.sub,
        }),
      });
    },
  );

  app.post(
    '/team/runtime/alerts/:alertCode/suppress',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'team.runtime.alert.suppress');
      const user = request.user as JwtPayload;
      const alertCode = teamRuntimeAlertCodeSchema.parse(
        (request.params as { alertCode: string }).alertCode,
      );
      const queryStep = child('parse-query');
      const query = parseQuery(teamRuntimeQuerySchema, request.query);
      queryStep.succeed(undefined, query.teamWorkspaceId || query.sessionId ? query : undefined);
      const parseStep = child('parse-body');
      const body = parseBody(suppressAlertSchema, request.body ?? {});
      parseStep.succeed();

      if (query.teamWorkspaceId) {
        const workspaceStep = child('workspace');
        const workspace = getTeamWorkspaceForUser(user.sub, query.teamWorkspaceId);
        if (!workspace) {
          workspaceStep.fail('workspace not found');
          step.fail('workspace not found');
          return reply.status(404).send(teamRouteErrorPayload('team_workspace_not_found'));
        }
        workspaceStep.succeed(undefined, { teamWorkspaceId: workspace.id });
      }

      const sessionScope = resolveRuntimeSessionScope({
        userId: user.sub,
        teamWorkspaceId: query.teamWorkspaceId,
        sessionId: query.sessionId,
      });
      if (!sessionScope) {
        step.fail('session not found');
        return reply.status(404).send(teamRouteErrorPayload('team_session_not_found'));
      }

      const active = listCurrentActiveRuntimeAlertsForScope({
        userId: user.sub,
        teamWorkspaceId: query.teamWorkspaceId,
      }).find((alert) => alert.code === alertCode);
      if (!active) {
        step.fail('alert not active');
        return reply.status(404).send(teamRouteErrorPayload('team_runtime_alert_not_active'));
      }

      const suppressedUntilMs = Date.now() + body.minutes * 60 * 1000;
      const control = upsertTeamRuntimeAlertControl({
        alertCode,
        note: body.note ?? null,
        state: 'suppressed',
        suppressedUntilMs,
        userId: user.sub,
      });
      logRuntimeAlertControl({
        action: 'suppress',
        actorEmail: user.email,
        actorUserId: user.sub,
        alertCode,
        detail: {
          minutes: body.minutes,
          note: body.note ?? null,
          suppressedUntilMs,
        },
        sessionId: query.sessionId ?? null,
        userId: user.sub,
      });
      step.succeed(undefined, { alertCode, suppressedUntilMs });
      return reply.send({
        control: {
          alertCode: control.alertCode,
          note: control.note,
          state: control.state,
          suppressedUntilMs: control.suppressedUntilMs,
          updatedAt: control.updatedAt,
        },
        runtime: buildRuntimePreview({
          sessionIds: sessionScope.sessionIds,
          teamWorkspaceId: query.teamWorkspaceId,
          userId: user.sub,
        }),
      });
    },
  );

  app.post(
    '/team/runtime/alerts/:alertCode/clear',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'team.runtime.alert.clear');
      const user = request.user as JwtPayload;
      const alertCode = teamRuntimeAlertCodeSchema.parse(
        (request.params as { alertCode: string }).alertCode,
      );
      const queryStep = child('parse-query');
      const query = parseQuery(teamRuntimeQuerySchema, request.query);
      queryStep.succeed(undefined, query.teamWorkspaceId || query.sessionId ? query : undefined);

      if (query.teamWorkspaceId) {
        const workspaceStep = child('workspace');
        const workspace = getTeamWorkspaceForUser(user.sub, query.teamWorkspaceId);
        if (!workspace) {
          workspaceStep.fail('workspace not found');
          step.fail('workspace not found');
          return reply.status(404).send(teamRouteErrorPayload('team_workspace_not_found'));
        }
        workspaceStep.succeed(undefined, { teamWorkspaceId: workspace.id });
      }

      const sessionScope = resolveRuntimeSessionScope({
        userId: user.sub,
        teamWorkspaceId: query.teamWorkspaceId,
        sessionId: query.sessionId,
      });
      if (!sessionScope) {
        step.fail('session not found');
        return reply.status(404).send(teamRouteErrorPayload('team_session_not_found'));
      }

      const cleared = clearTeamRuntimeAlertControl({
        alertCode,
        userId: user.sub,
      });
      if (!cleared) {
        step.fail('control not found');
        return reply
          .status(404)
          .send(teamRouteErrorPayload('team_runtime_alert_control_not_found'));
      }

      logRuntimeAlertControl({
        action: 'clear',
        actorEmail: user.email,
        actorUserId: user.sub,
        alertCode,
        detail: {
          cleared: true,
        },
        sessionId: query.sessionId ?? null,
        userId: user.sub,
      });
      step.succeed(undefined, { alertCode });
      return reply.send({
        cleared: true,
        runtime: buildRuntimePreview({
          sessionIds: sessionScope.sessionIds,
          teamWorkspaceId: query.teamWorkspaceId,
          userId: user.sub,
        }),
      });
    },
  );

  await app.register(teamCrudRoutes);
}
