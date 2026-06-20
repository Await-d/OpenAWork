/**
 * 260515-team-phase-b · T-08 内部助手
 *
 * 创建一条带有团队层级语义的 session（绑定 role_layer / team_parent_session_id /
 * handoff_state）。
 *
 * 与现有 `routes/sessions.ts::POST /sessions` 关键区别：
 *   - 现有端点：generic session，不写 role_layer / team_parent_session_id
 *   - 此处端点：team session，必写 role_layer，可写 team_parent_session_id
 *
 * 这个模块同时被两类调用方使用：
 *   1. HTTP 路由 `POST /team/sessions`（路由层做参数校验）
 *   2. Watcher 守护进程（T-04，内部调用，不走 HTTP）
 */

import { randomUUID } from 'node:crypto';
import type { DialogueMode } from '@openAwork/shared';
import { sqliteGet, sqliteRun, sqliteTransaction } from '../../infra/db.js';
import type { HandoffRoleLayer } from '../store/handoff-store.js';

export interface CreateTeamSessionInput {
  userId: string;
  roleLayer: HandoffRoleLayer;
  teamParentSessionId?: string | null;
  metadataJson?: string;
  teamRoleInstance?: {
    rootSessionId: string;
    personaKey?: string | null;
    displayName?: string | null;
  };
  /** 初始 handoff_state（pending/running/null） */
  handoffState?: 'pending' | 'running' | null;
  /** session 标题，调用方可选 */
  title?: string | null;
}

export interface CreateTeamSessionResult {
  sessionId: string;
}

export interface TeamRoleSessionLookupInput {
  userId: string;
  rootSessionId: string;
  roleLayer: HandoffRoleLayer;
  personaKey?: string | null;
}

export interface FindOrCreateTeamRoleSessionInput extends CreateTeamSessionInput {
  rootSessionId?: string | null;
  personaKey?: string | null;
  displayName?: string | null;
}

export interface TeamRoleInstanceMetadata {
  rootSessionId: string;
  roleLayer: HandoffRoleLayer;
  personaKey: string | null;
  displayName: string | null;
}

interface BoundTeamRoleSessionInstance {
  metadataJson: string;
  sessionId: string;
}

class TeamRoleSessionBindingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TeamRoleSessionBindingError';
  }
}

const DEFAULT_DIALOGUE_MODE_BY_ROLE_LAYER: Record<HandoffRoleLayer, DialogueMode> = {
  user: 'coding',
  reception: 'clarify',
  pm1: 'coding',
  pm2: 'coding',
  executor: 'coding',
  reviewer: 'coding',
};

function parseMetadataJson(metadataJson: string | undefined): Record<string, unknown> {
  if (metadataJson === undefined) {
    return {};
  }
  try {
    const parsed = JSON.parse(metadataJson) as unknown;
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch (_error) {
    return {};
  }
  return {};
}

function normalizeOptionalMetadataString(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeTeamRoleInstancePersonaKey(value: string | null | undefined): string {
  return normalizeOptionalMetadataString(value) ?? '';
}

export function withRoleLayerDialogueMetadataDefaults(input: {
  metadataJson?: string;
  roleLayer: HandoffRoleLayer;
}): string {
  const metadata = parseMetadataJson(input.metadataJson);

  if (!Object.prototype.hasOwnProperty.call(metadata, 'defaultProvider')) {
    metadata['defaultProvider'] = null;
  }
  if (!Object.prototype.hasOwnProperty.call(metadata, 'defaultModel')) {
    metadata['defaultModel'] = null;
  }
  if (!Object.prototype.hasOwnProperty.call(metadata, 'dialogueMode')) {
    metadata['dialogueMode'] = DEFAULT_DIALOGUE_MODE_BY_ROLE_LAYER[input.roleLayer];
  }

  return JSON.stringify(metadata);
}

export function withTeamRoleInstanceMetadata(input: {
  metadataJson?: string;
  roleLayer: HandoffRoleLayer;
  rootSessionId: string;
  personaKey?: string | null;
  displayName?: string | null;
}): string {
  const metadata = parseMetadataJson(input.metadataJson);
  const roleInstance: TeamRoleInstanceMetadata = {
    rootSessionId: input.rootSessionId,
    roleLayer: input.roleLayer,
    personaKey: normalizeOptionalMetadataString(input.personaKey),
    displayName: normalizeOptionalMetadataString(input.displayName),
  };
  metadata['teamRoleInstance'] = roleInstance;
  return JSON.stringify(metadata);
}

/**
 * 校验 team_parent_session_id：必须存在且属于同一用户。
 * 不存在 / 跨用户 → 返回 false 让上层 400/404。
 */
export function validateTeamParentSession(input: {
  userId: string;
  teamParentSessionId: string;
}): boolean {
  const row = sqliteGet<{ id: string }>(
    `SELECT id FROM sessions WHERE id = ? AND user_id = ? LIMIT 1`,
    [input.teamParentSessionId, input.userId],
  );
  return row !== undefined;
}

export function resolveTeamRootSessionId(input: {
  userId: string;
  sessionId: string;
}): string | null {
  let currentSessionId: string | null = input.sessionId;
  const visited = new Set<string>();

  while (currentSessionId) {
    if (visited.has(currentSessionId)) {
      return currentSessionId;
    }
    visited.add(currentSessionId);
    const row: { id: string; team_parent_session_id: string | null } | undefined = sqliteGet<{
      id: string;
      team_parent_session_id: string | null;
    }>(
      `SELECT id, team_parent_session_id
         FROM sessions
        WHERE id = ? AND user_id = ?
        LIMIT 1`,
      [currentSessionId, input.userId],
    );
    if (!row) {
      return null;
    }
    if (!row.team_parent_session_id) {
      return row.id;
    }
    currentSessionId = row.team_parent_session_id;
  }

  return null;
}

export function findReusableTeamRoleSession(
  input: TeamRoleSessionLookupInput,
): CreateTeamSessionResult | null {
  const metadataExpression = `CASE WHEN json_valid(metadata_json) THEN metadata_json ELSE '{}' END`;
  const normalizedPersonaKey = normalizeOptionalMetadataString(input.personaKey);
  const params: Array<string> = [
    input.userId,
    input.roleLayer,
    input.rootSessionId,
    input.roleLayer,
  ];
  const personaPredicate =
    normalizedPersonaKey !== null
      ? `AND json_extract(${metadataExpression}, '$.teamRoleInstance.personaKey') = ?`
      : `AND json_extract(${metadataExpression}, '$.teamRoleInstance.personaKey') IS NULL`;
  if (normalizedPersonaKey !== null) {
    params.push(normalizedPersonaKey);
  }

  const row = sqliteGet<{ id: string }>(
    `SELECT id
       FROM sessions
      WHERE user_id = ?
        AND role_layer = ?
        AND json_extract(${metadataExpression}, '$.teamRoleInstance.rootSessionId') = ?
        AND json_extract(${metadataExpression}, '$.teamRoleInstance.roleLayer') = ?
        ${personaPredicate}
      ORDER BY created_at ASC, id ASC
      LIMIT 1`,
    params,
  );

  return row ? { sessionId: row.id } : null;
}

function findBoundTeamRoleSessionInstance(
  input: TeamRoleSessionLookupInput,
): BoundTeamRoleSessionInstance | null {
  const row = sqliteGet<{ metadata_json: string; session_id: string }>(
    `SELECT s.metadata_json, i.session_id
       FROM team_role_session_instances i
       JOIN sessions s ON s.id = i.session_id AND s.user_id = i.user_id
      WHERE i.user_id = ?
        AND i.root_session_id = ?
        AND i.role_layer = ?
        AND i.persona_key = ?
      LIMIT 1`,
    [
      input.userId,
      input.rootSessionId,
      input.roleLayer,
      normalizeTeamRoleInstancePersonaKey(input.personaKey),
    ],
  );

  return row ? { metadataJson: row.metadata_json, sessionId: row.session_id } : null;
}

function bindTeamRoleSessionInstance(input: TeamRoleSessionLookupInput & {
  displayName?: string | null;
  sessionId: string;
}): BoundTeamRoleSessionInstance {
  sqliteRun(
    `INSERT OR IGNORE INTO team_role_session_instances (
       id, user_id, root_session_id, role_layer, persona_key, session_id, display_name
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      randomUUID(),
      input.userId,
      input.rootSessionId,
      input.roleLayer,
      normalizeTeamRoleInstancePersonaKey(input.personaKey),
      input.sessionId,
      normalizeOptionalMetadataString(input.displayName),
    ],
  );

  const bound = findBoundTeamRoleSessionInstance(input);
  if (!bound) {
    throw new TeamRoleSessionBindingError('团队角色 session 绑定失败。');
  }
  return bound;
}

function updateReusableTeamRoleSessionState(input: {
  handoffState?: 'pending' | 'running' | null;
  sessionId: string;
  userId: string;
}): void {
  sqliteRun(`UPDATE sessions SET handoff_state = ? WHERE id = ? AND user_id = ?`, [
    input.handoffState ?? 'running',
    input.sessionId,
    input.userId,
  ]);
}

function findLegacyReusableTeamRoleSession(input: TeamRoleSessionLookupInput): {
  sessionId: string;
  metadataJson: string;
} | null {
  const payloadExpression = `CASE WHEN json_valid(h.payload_json) THEN h.payload_json ELSE '{}' END`;
  const normalizedPersonaKey = normalizeOptionalMetadataString(input.personaKey);
  const params: Array<string> = [
    input.rootSessionId,
    input.userId,
    input.userId,
    input.userId,
    input.roleLayer,
    input.roleLayer,
  ];
  const personaPredicate =
    normalizedPersonaKey !== null
      ? `AND json_extract(${payloadExpression}, '$.assignedMember.personaKey') = ?`
      : `AND json_extract(${payloadExpression}, '$.assignedMember.personaKey') IS NULL`;
  if (normalizedPersonaKey !== null) {
    params.push(normalizedPersonaKey);
  }

  const row = sqliteGet<{ id: string; metadata_json: string }>(
    `WITH RECURSIVE session_tree(id) AS (
       SELECT id
         FROM sessions
        WHERE id = ? AND user_id = ?
       UNION ALL
       SELECT child.id
         FROM sessions child
         JOIN session_tree parent ON child.team_parent_session_id = parent.id
        WHERE child.user_id = ?
     )
     SELECT s.id, s.metadata_json
       FROM handoff_records h
       JOIN sessions s ON s.id = h.to_session_id AND s.user_id = h.user_id
      WHERE h.user_id = ?
        AND h.to_role_layer = ?
        AND h.to_session_id IS NOT NULL
        AND s.role_layer = ?
        AND (h.from_session_id IN (SELECT id FROM session_tree)
          OR h.to_session_id IN (SELECT id FROM session_tree))
        ${personaPredicate}
      ORDER BY COALESCE(h.started_at, h.created_at) ASC, h.id ASC
      LIMIT 1`,
    params,
  );

  return row ? { sessionId: row.id, metadataJson: row.metadata_json } : null;
}

function markSessionAsTeamRoleInstance(input: {
  userId: string;
  sessionId: string;
  metadataJson: string;
  rootSessionId: string;
  roleLayer: HandoffRoleLayer;
  personaKey?: string | null;
  displayName?: string | null;
  handoffState?: 'pending' | 'running' | null;
}): void {
  const roleInstanceMetadataJson = withTeamRoleInstanceMetadata({
    metadataJson: input.metadataJson,
    roleLayer: input.roleLayer,
    rootSessionId: input.rootSessionId,
    personaKey: input.personaKey,
    displayName: input.displayName,
  });
  const metadataJson = withRoleLayerDialogueMetadataDefaults({
    metadataJson: roleInstanceMetadataJson,
    roleLayer: input.roleLayer,
  });
  sqliteRun(
    `UPDATE sessions
        SET metadata_json = ?,
            handoff_state = ?,
            title = COALESCE(title, ?)
      WHERE id = ? AND user_id = ?`,
    [
      metadataJson,
      input.handoffState ?? 'running',
      normalizeOptionalMetadataString(input.displayName),
      input.sessionId,
      input.userId,
    ],
  );
}

export function findOrCreateTeamRoleSession(
  input: FindOrCreateTeamRoleSessionInput,
): CreateTeamSessionResult {
  const rootSessionId =
    normalizeOptionalMetadataString(input.rootSessionId) ??
    (input.teamParentSessionId
      ? resolveTeamRootSessionId({
          userId: input.userId,
          sessionId: input.teamParentSessionId,
        })
      : null);

  if (!rootSessionId) {
    return createTeamSession(input);
  }

  return sqliteTransaction(() =>
    findOrCreateTeamRoleSessionInTransaction({
      ...input,
      rootSessionId,
    }),
  );
}

function findOrCreateTeamRoleSessionInTransaction(
  input: FindOrCreateTeamRoleSessionInput & { rootSessionId: string },
): CreateTeamSessionResult {
  const lookup: TeamRoleSessionLookupInput = {
    userId: input.userId,
    rootSessionId: input.rootSessionId,
    roleLayer: input.roleLayer,
    personaKey: input.personaKey,
  };

  const bound = findBoundTeamRoleSessionInstance(lookup);
  if (bound) {
    updateReusableTeamRoleSessionState({
      handoffState: input.handoffState,
      sessionId: bound.sessionId,
      userId: input.userId,
    });
    return { sessionId: bound.sessionId };
  }

  const existing = findReusableTeamRoleSession({
    userId: input.userId,
    rootSessionId: input.rootSessionId,
    roleLayer: input.roleLayer,
    personaKey: input.personaKey,
  });
  if (existing) {
    const winner = bindTeamRoleSessionInstance({
      ...lookup,
      displayName: input.displayName,
      sessionId: existing.sessionId,
    });
    updateReusableTeamRoleSessionState({
      handoffState: input.handoffState,
      sessionId: winner.sessionId,
      userId: input.userId,
    });
    return { sessionId: winner.sessionId };
  }

  const legacy = findLegacyReusableTeamRoleSession({
    userId: input.userId,
    rootSessionId: input.rootSessionId,
    roleLayer: input.roleLayer,
    personaKey: input.personaKey,
  });
  if (legacy) {
    markSessionAsTeamRoleInstance({
      userId: input.userId,
      sessionId: legacy.sessionId,
      metadataJson: legacy.metadataJson,
      rootSessionId: input.rootSessionId,
      roleLayer: input.roleLayer,
      personaKey: input.personaKey,
      displayName: input.displayName,
      handoffState: input.handoffState,
    });
    const winner = bindTeamRoleSessionInstance({
      ...lookup,
      displayName: input.displayName,
      sessionId: legacy.sessionId,
    });
    updateReusableTeamRoleSessionState({
      handoffState: input.handoffState,
      sessionId: winner.sessionId,
      userId: input.userId,
    });
    return { sessionId: winner.sessionId };
  }

  const created = createTeamSession({
    ...input,
    teamRoleInstance: {
      rootSessionId: input.rootSessionId,
      personaKey: input.personaKey,
      displayName: input.displayName,
    },
    title: input.title ?? input.displayName ?? null,
  });
  const winner = bindTeamRoleSessionInstance({
    ...lookup,
    displayName: input.displayName,
    sessionId: created.sessionId,
  });
  return { sessionId: winner.sessionId };
}

export function createTeamSession(input: CreateTeamSessionInput): CreateTeamSessionResult {
  const sessionId = randomUUID();
  const roleInstanceMetadataJson = input.teamRoleInstance
    ? withTeamRoleInstanceMetadata({
        metadataJson: input.metadataJson,
        roleLayer: input.roleLayer,
        rootSessionId: input.teamRoleInstance.rootSessionId,
        personaKey: input.teamRoleInstance.personaKey,
        displayName: input.teamRoleInstance.displayName,
      })
    : input.metadataJson;
  const metadataJson = withRoleLayerDialogueMetadataDefaults({
    metadataJson: roleInstanceMetadataJson,
    roleLayer: input.roleLayer,
  });

  // L1.8 D18：计算 structural_depth 和 execution_depth
  // structural_depth = parent 的 structural_depth + 1（根 session = 0）
  // execution_depth = parent 的 execution_depth + (roleLayer 是 executor/reviewer ? 1 : 0)
  let structuralDepth = 0;
  let executionDepth = 0;
  if (input.teamParentSessionId) {
    const parent = sqliteGet<{ structural_depth: number; execution_depth: number }>(
      `SELECT structural_depth, execution_depth FROM sessions WHERE id = ? LIMIT 1`,
      [input.teamParentSessionId],
    );
    if (parent) {
      structuralDepth = (parent.structural_depth ?? 0) + 1;
      executionDepth =
        (parent.execution_depth ?? 0) +
        (input.roleLayer === 'executor' || input.roleLayer === 'reviewer' ? 1 : 0);
    }
  }

  sqliteRun(
    `INSERT INTO sessions (
       id, user_id, messages_json, state_status, metadata_json, title,
       team_parent_session_id, role_layer, handoff_state,
       structural_depth, execution_depth
     ) VALUES (?, ?, '[]', 'idle', ?, ?, ?, ?, ?, ?, ?)`,
    [
      sessionId,
      input.userId,
      metadataJson,
      input.title ?? null,
      input.teamParentSessionId ?? null,
      input.roleLayer,
      input.handoffState ?? null,
      structuralDepth,
      executionDepth,
    ],
  );
  return { sessionId };
}
