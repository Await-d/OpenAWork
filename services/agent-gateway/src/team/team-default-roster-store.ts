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
import type { FixedTeamMemberSlot, TeamMemberSpecialty, TeamRuntimeLayer } from '@openAwork/shared';
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
const VALID_SPECIALTIES = new Set<TeamMemberSpecialty>(
  DEFAULT_FIXED_TEAM_MEMBER_SLOTS.map((slot) => slot.specialty),
);

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

function normalizeToolsets(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 20) return null;
  const toolsets = value
    .filter((tool): tool is string => isBoundedString(tool, 80))
    .map((tool) => tool.trim());
  return toolsets.length === value.length ? toolsets : null;
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

  return {
    id: id.trim(),
    layer,
    specialty,
    displayName: displayName.trim(),
    personaKey: personaKey.trim(),
    toolsets,
    required,
  };
}

export function normalizeTeamWorkspaceDefaultRoster(
  memberSlots: FixedTeamMemberSlot[],
): FixedTeamMemberSlot[] {
  const normalized = memberSlots
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
