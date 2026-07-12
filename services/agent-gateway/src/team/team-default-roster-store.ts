/**
 * Team 默认固定团队（workspace 级）存储层。
 *
 * 通过 team_workspaces.default_team_roster_json 保存可见成员槽位快照。
 * 设计原则：
 *   - 默认 roster 是 workspace 级配置，不影响历史 session
 *   - session 创建时会把 roster 版本快照写入 sessions.metadata_json.teamDefinition
 *   - 允许为空数组，代表仍未配置固定 roster
 */

import { DEFAULT_FIXED_TEAM_MEMBER_SLOTS, TEAM_RUNTIME_LAYER_ORDER } from '@openAwork/shared';
import type {
  FixedTeamMemberSlot,
  TeamMemberSpecialty,
  TeamReasoningEffort,
  TeamRuntimeLayer,
} from '@openAwork/shared';
import { sqliteGet, sqliteRun } from '../infra/db.js';

interface TeamWorkspaceRosterRow {
  id: string;
  default_team_roster_json: string | null;
  updated_at: string;
}

export interface TeamWorkspaceDefaultRosterRecord {
  teamWorkspaceId: string;
  memberSlots: FixedTeamMemberSlot[];
  updatedAt: string;
}

const VALID_LAYERS = new Set<TeamRuntimeLayer>(TEAM_RUNTIME_LAYER_ORDER);
const VALID_SPECIALTIES = new Set<TeamMemberSpecialty>([
  ...DEFAULT_FIXED_TEAM_MEMBER_SLOTS.map((slot) => slot.specialty),
  'custom',
]);

const VALID_REASONING_EFFORTS = new Set<TeamReasoningEffort>([
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]);

/**
 * 花名册成员数硬上限（与路由层 z.array(...).max(40) 对齐）。
 *
 * 这是 DB → 运行时的最后一道防线：route schema 已经把写入路径限制在 40，但旧数据 /
 * 手改 DB / 迁移异常可能留下超大数组。运行时会把 roster 渲染进「团队编制清单」注入
 * 每个 pm1/pm2/executor/reviewer 的 system prompt，无界数组会撑爆 prompt + 成本。
 * 这里在解析 / 归一化时统一截断到上限，保证注入侧永远有界。
 */
const MAX_ROSTER_MEMBER_SLOTS = 40;

export function cloneDefaultTeamRoster(): FixedTeamMemberSlot[] {
  return DEFAULT_FIXED_TEAM_MEMBER_SLOTS.map((slot) => ({
    ...slot,
    toolsets: [...slot.toolsets],
  }));
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;
}

function isTeamRuntimeLayer(value: unknown): value is TeamRuntimeLayer {
  return typeof value === 'string' && VALID_LAYERS.has(value as TeamRuntimeLayer);
}

function isTeamMemberSpecialty(value: unknown): value is TeamMemberSpecialty {
  return typeof value === 'string' && VALID_SPECIALTIES.has(value as TeamMemberSpecialty);
}

function isTeamReasoningEffort(value: unknown): value is TeamReasoningEffort {
  return typeof value === 'string' && VALID_REASONING_EFFORTS.has(value as TeamReasoningEffort);
}

function normalizeToolsets(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 20) return null;
  const toolsets = value
    .filter((tool): tool is string => isBoundedString(tool, 80))
    .map((tool) => tool.trim());
  return toolsets.length === value.length ? toolsets : null;
}

/** 归一化一个 id 字符串数组（skills / mcp）：丢弃非字符串 / 超长项，去重。 */
function normalizeIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const item of value) {
    if (isBoundedString(item, 160)) {
      seen.add(item.trim());
    }
  }
  return Array.from(seen).slice(0, 50);
}

function normalizeMemberSlot(entry: unknown): FixedTeamMemberSlot | null {
  if (!entry || typeof entry !== 'object') return null;
  const rec = entry as Record<string, unknown>;
  const id = rec['id'];
  const layer = rec['layer'];
  const specialty = rec['specialty'];
  const displayName = rec['displayName'];
  const personaKey = rec['personaKey'];
  const toolsets = normalizeToolsets(rec['toolsets']);
  const required = rec['required'];

  if (
    !isBoundedString(id, 120) ||
    !isTeamRuntimeLayer(layer) ||
    !isTeamMemberSpecialty(specialty) ||
    !isBoundedString(displayName, 200) ||
    !isBoundedString(personaKey, 160) ||
    toolsets === null ||
    typeof required !== 'boolean'
  ) {
    return null;
  }

  // Phase 2：保留可选的成员模型绑定（modelId / providerId / variant），
  // 否则会在快照归一化时被丢弃，运行时就拿不到「每层/每成员模型」。
  const modelId = rec['modelId'];
  const providerId = rec['providerId'];
  const variant = rec['variant'];
  const thinkingEnabled = rec['thinkingEnabled'];
  const reasoningEffort = rec['reasoningEffort'];
  // 自定义角色字段：custom 标记 + systemPrompt 人物设定提示词。
  const custom = rec['custom'] === true;
  const systemPrompt = rec['systemPrompt'];
  // 模板初始能力绑定：skills / mcp id 列表。
  const skillIds = normalizeIdList(rec['skillIds']);
  const mcpServerIds = normalizeIdList(rec['mcpServerIds']);
  // 路由关键词：让上游派发动态识别该成员（尤其自定义角色）的专长。
  const routingKeywords = normalizeIdList(rec['routingKeywords']);
  // 派发优先级：同分排序权重。
  const dispatchPriorityRaw = rec['dispatchPriority'];
  const dispatchPriority =
    dispatchPriorityRaw === 'high' ||
    dispatchPriorityRaw === 'low' ||
    dispatchPriorityRaw === 'normal'
      ? dispatchPriorityRaw
      : undefined;

  return {
    id: id.trim(),
    layer,
    specialty,
    displayName: displayName.trim(),
    personaKey: personaKey.trim(),
    toolsets,
    required,
    ...(isBoundedString(modelId, 200) ? { modelId: modelId.trim() } : {}),
    ...(isBoundedString(providerId, 200) ? { providerId: providerId.trim() } : {}),
    ...(isBoundedString(variant, 80) ? { variant: variant.trim() } : {}),
    ...(typeof thinkingEnabled === 'boolean' ? { thinkingEnabled } : {}),
    ...(isTeamReasoningEffort(reasoningEffort) ? { reasoningEffort } : {}),
    ...(custom ? { custom: true } : {}),
    ...(isBoundedString(systemPrompt, 8000) ? { systemPrompt: systemPrompt.trim() } : {}),
    ...(skillIds.length > 0 ? { skillIds } : {}),
    ...(mcpServerIds.length > 0 ? { mcpServerIds } : {}),
    ...(routingKeywords.length > 0 ? { routingKeywords } : {}),
    ...(dispatchPriority ? { dispatchPriority } : {}),
  };
}

export function normalizeTeamWorkspaceDefaultRoster(
  memberSlots: FixedTeamMemberSlot[],
): FixedTeamMemberSlot[] {
  const normalized = memberSlots
    .slice(0, MAX_ROSTER_MEMBER_SLOTS)
    .map((slot) => normalizeMemberSlot(slot))
    .filter((slot): slot is FixedTeamMemberSlot => slot !== null);
  return normalized.length > 0 ? normalized : cloneDefaultTeamRoster();
}

export function parseTeamWorkspaceDefaultRosterJson(json: string | null): FixedTeamMemberSlot[] {
  if (!json || json.trim().length === 0) {
    return cloneDefaultTeamRoster();
  }

  try {
    const raw = JSON.parse(json) as unknown;
    if (!Array.isArray(raw)) {
      return cloneDefaultTeamRoster();
    }

    const memberSlots = raw
      .slice(0, MAX_ROSTER_MEMBER_SLOTS)
      .map((entry) => normalizeMemberSlot(entry))
      .filter((slot): slot is FixedTeamMemberSlot => slot !== null);
    return memberSlots.length > 0 ? memberSlots : cloneDefaultTeamRoster();
  } catch {
    return cloneDefaultTeamRoster();
  }
}

export function getTeamWorkspaceDefaultRoster(input: {
  userId: string;
  teamWorkspaceId: string;
}): TeamWorkspaceDefaultRosterRecord | undefined {
  const row = sqliteGet<TeamWorkspaceRosterRow>(
    `SELECT id, default_team_roster_json, updated_at
     FROM team_workspaces
     WHERE user_id = ? AND id = ?
     LIMIT 1`,
    [input.userId, input.teamWorkspaceId],
  );
  if (!row) return undefined;
  return {
    teamWorkspaceId: row.id,
    memberSlots: parseTeamWorkspaceDefaultRosterJson(row.default_team_roster_json),
    updatedAt: row.updated_at,
  };
}

export function updateTeamWorkspaceDefaultRoster(input: {
  userId: string;
  teamWorkspaceId: string;
  memberSlots: FixedTeamMemberSlot[];
}): TeamWorkspaceDefaultRosterRecord | undefined {
  const existing = getTeamWorkspaceDefaultRoster({
    userId: input.userId,
    teamWorkspaceId: input.teamWorkspaceId,
  });
  if (!existing) return undefined;

  sqliteRun(
    `UPDATE team_workspaces
     SET default_team_roster_json = ?,
         updated_at = datetime('now')
     WHERE user_id = ? AND id = ?`,
    [
      JSON.stringify(normalizeTeamWorkspaceDefaultRoster(input.memberSlots)),
      input.userId,
      input.teamWorkspaceId,
    ],
  );

  return getTeamWorkspaceDefaultRoster({
    userId: input.userId,
    teamWorkspaceId: input.teamWorkspaceId,
  });
}

interface SessionRosterRow {
  metadata_json: string | null;
  team_parent_session_id: string | null;
}

/**
 * 读取某 session「实际运行的花名册」—— 即根 session 快照里的
 * teamDefinition.memberSlots（向上回溯 team_parent_session_id 到根）。
 *
 * 为什么需要它：派发打分（pm2-runner → resolveAssignedMember）原本只读 workspace
 * 级 default_team_roster_json，但一个 session 的真实 roster 是创建时冻结进
 * teamDefinition.memberSlots 的快照（可能来自模板、或晚于 workspace 默认被改过）。
 * 两者可能漂移 —— 用户在模板/会话里给成员设的 routingKeywords / dispatchPriority
 * 若只存在于会话快照，就不会进入派发打分。本函数让派发能优先读「会话实际 roster」。
 *
 * 找不到 / 为空时返回 undefined（调用方回退到 workspace 默认 roster）。
 */
export function resolveSessionMemberSlots(sessionId: string): FixedTeamMemberSlot[] | undefined {
  let currentId: string | null = sessionId;
  let guard = 0;
  let snapshot: unknown[] | null = null;
  while (currentId && guard < 16) {
    const row: SessionRosterRow | undefined = sqliteGet<SessionRosterRow>(
      `SELECT metadata_json, team_parent_session_id FROM sessions WHERE id = ? LIMIT 1`,
      [currentId],
    );
    if (!row) break;
    try {
      const parsed = JSON.parse(row.metadata_json ?? '{}') as Record<string, unknown>;
      const teamDefinition = parsed['teamDefinition'];
      if (teamDefinition && typeof teamDefinition === 'object') {
        const slots = (teamDefinition as Record<string, unknown>)['memberSlots'];
        if (Array.isArray(slots) && slots.length > 0) {
          snapshot = slots;
          break;
        }
      }
    } catch {
      // ignore malformed metadata, keep walking up
    }
    if (!row.team_parent_session_id) break;
    currentId = row.team_parent_session_id;
    guard += 1;
  }
  if (!snapshot) return undefined;
  const normalized = snapshot
    .slice(0, MAX_ROSTER_MEMBER_SLOTS)
    .map((entry) => normalizeMemberSlot(entry))
    .filter((slot): slot is FixedTeamMemberSlot => slot !== null);
  return normalized.length > 0 ? normalized : undefined;
}
