/**
 * 团队工作区（`team_workspaces`）共享存储层。
 *
 * 从 `routes/team.ts` 抽取：路由（HTTP）与 `team_workspace_manage` 工具必须共用同一套
 * 落库语义（roster 归一、动态 SET、删除仅限工作区行）。本模块不含网络 / 聚合逻辑。
 */

import { randomUUID } from 'node:crypto';
import type { FixedTeamMemberSlot } from '@openAwork/shared';
import { sqliteAll, sqliteGet, sqliteRun } from '../infra/db.js';
import {
  cloneDefaultTeamRoster,
  normalizeTeamWorkspaceDefaultRoster,
  parseTeamWorkspaceDefaultRosterJson,
} from './team-default-roster-store.js';

export interface TeamWorkspaceRow {
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

export interface TeamWorkspaceRecord {
  id: string;
  name: string;
  description: string | null;
  visibility: 'open' | 'closed' | 'private';
  defaultWorkingRoot: string | null;
  defaultTeamRoster: FixedTeamMemberSlot[];
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}

const WORKSPACE_SELECT_COLUMNS =
  'id, user_id, name, description, visibility, default_working_root, default_team_roster_json, created_at, updated_at';

export function mapWorkspaceRow(row: TeamWorkspaceRow): TeamWorkspaceRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    visibility: row.visibility,
    defaultWorkingRoot: row.default_working_root,
    defaultTeamRoster: parseTeamWorkspaceDefaultRosterJson(row.default_team_roster_json),
    createdByUserId: row.user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listTeamWorkspacesForUser(userId: string, limit = 200): TeamWorkspaceRecord[] {
  return sqliteAll<TeamWorkspaceRow>(
    `SELECT ${WORKSPACE_SELECT_COLUMNS}
       FROM team_workspaces
      WHERE user_id = ?
      ORDER BY updated_at DESC, created_at DESC
      LIMIT ?`,
    [userId, limit],
  ).map(mapWorkspaceRow);
}

export function getTeamWorkspaceForUser(
  userId: string,
  teamWorkspaceId: string,
): TeamWorkspaceRecord | undefined {
  const row = sqliteGet<TeamWorkspaceRow>(
    `SELECT ${WORKSPACE_SELECT_COLUMNS}
       FROM team_workspaces
      WHERE user_id = ? AND id = ?
      LIMIT 1`,
    [userId, teamWorkspaceId],
  );
  return row ? mapWorkspaceRow(row) : undefined;
}

export interface CreateTeamWorkspaceInput {
  name: string;
  description?: string | null;
  visibility?: 'open' | 'closed' | 'private';
  defaultWorkingRoot?: string | null;
  defaultTeamRoster?: FixedTeamMemberSlot[];
}

export function createTeamWorkspace(
  userId: string,
  input: CreateTeamWorkspaceInput,
): TeamWorkspaceRecord {
  const teamWorkspaceId = randomUUID();
  const defaultTeamRoster = normalizeTeamWorkspaceDefaultRoster(
    input.defaultTeamRoster ?? cloneDefaultTeamRoster(),
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
      userId,
      input.name,
      input.description ?? null,
      input.visibility ?? 'private',
      input.defaultWorkingRoot ?? null,
      JSON.stringify(defaultTeamRoster),
    ],
  );

  const created = getTeamWorkspaceForUser(userId, teamWorkspaceId);
  if (created) {
    return created;
  }

  // 防御性兜底（INSERT 后必然可查；仅当并发删除等极端情况才走到）。
  const now = new Date().toISOString();
  return {
    id: teamWorkspaceId,
    name: input.name,
    description: input.description ?? null,
    visibility: input.visibility ?? 'private',
    defaultWorkingRoot: input.defaultWorkingRoot ?? null,
    defaultTeamRoster,
    createdByUserId: userId,
    createdAt: now,
    updatedAt: now,
  };
}

export interface UpdateTeamWorkspaceInput {
  name?: string;
  description?: string | null;
  visibility?: 'open' | 'closed' | 'private';
  defaultWorkingRoot?: string | null;
  defaultTeamRoster?: FixedTeamMemberSlot[];
}

export function updateTeamWorkspace(
  userId: string,
  teamWorkspaceId: string,
  patch: UpdateTeamWorkspaceInput,
): TeamWorkspaceRecord | undefined {
  const existing = sqliteGet<{ id: string }>(
    'SELECT id FROM team_workspaces WHERE user_id = ? AND id = ? LIMIT 1',
    [userId, teamWorkspaceId],
  );
  if (!existing) {
    return undefined;
  }

  const updates: string[] = [];
  const params: Array<string | null> = [];
  if (patch.name !== undefined) {
    updates.push('name = ?');
    params.push(patch.name);
  }
  if (patch.description !== undefined) {
    updates.push('description = ?');
    params.push(patch.description ?? null);
  }
  if (patch.visibility !== undefined) {
    updates.push('visibility = ?');
    params.push(patch.visibility);
  }
  if (patch.defaultWorkingRoot !== undefined) {
    updates.push('default_working_root = ?');
    params.push(patch.defaultWorkingRoot ?? null);
  }
  if (patch.defaultTeamRoster !== undefined) {
    updates.push('default_team_roster_json = ?');
    params.push(JSON.stringify(normalizeTeamWorkspaceDefaultRoster(patch.defaultTeamRoster)));
  }
  updates.push("updated_at = datetime('now')");

  sqliteRun(`UPDATE team_workspaces SET ${updates.join(', ')} WHERE user_id = ? AND id = ?`, [
    ...params,
    userId,
    teamWorkspaceId,
  ]);

  return getTeamWorkspaceForUser(userId, teamWorkspaceId);
}

/**
 * 删除工作区（仅本人）。
 *
 * 与路由既有语义一致：**只删除 `team_workspaces` 行**；session 数据保留
 * （仍按 metadata 中的 teamWorkspaceId 孤立存在），符合「删除工作区不破坏历史会话」。
 */
export function deleteTeamWorkspace(userId: string, teamWorkspaceId: string): boolean {
  const existing = sqliteGet<{ id: string }>(
    'SELECT id FROM team_workspaces WHERE user_id = ? AND id = ? LIMIT 1',
    [userId, teamWorkspaceId],
  );
  if (!existing) {
    return false;
  }
  sqliteRun('DELETE FROM team_workspaces WHERE user_id = ? AND id = ?', [userId, teamWorkspaceId]);
  return true;
}
