/**
 * 260515-team-phase-a · T-04 后端
 *
 * 团队宪法（constitution）数据访问层。
 *
 * 表：team_workspaces（已有）+ Phase A 新增列 constitution_md / constitution_version
 * 路由：services/agent-gateway/src/routes/team-constitution.ts
 *
 * D52 乐观锁：constitution_version 是单调递增整数。客户端 PUT 时必须带
 * expectedVersion；只有相等才更新，否则返回 409。
 */

import { sqliteGet, sqliteRun } from '../infra/db.js';

interface ConstitutionRow {
  id: string;
  user_id: string;
  constitution_md: string | null;
  constitution_version: number | null;
  updated_at: string;
}

export interface TeamConstitutionRecord {
  teamWorkspaceId: string;
  body: string;
  version: number;
  updatedAt: string;
}

export interface TeamConstitutionUpdateOptions {
  userId: string;
  teamWorkspaceId: string;
  body: string;
  expectedVersion: number;
}

export type TeamConstitutionUpdateResult =
  | { ok: true; record: TeamConstitutionRecord }
  | { ok: false; reason: 'not-found' | 'version-conflict'; currentVersion?: number };

/**
 * 读取宪法。如果工作区存在但还没设置宪法，返回 body=''、version=0。
 */
export function getTeamConstitution(input: {
  userId: string;
  teamWorkspaceId: string;
}): TeamConstitutionRecord | undefined {
  const row = sqliteGet<ConstitutionRow>(
    `SELECT id, user_id, constitution_md, constitution_version, updated_at
     FROM team_workspaces
     WHERE user_id = ? AND id = ?
     LIMIT 1`,
    [input.userId, input.teamWorkspaceId],
  );
  if (!row) return undefined;
  return {
    teamWorkspaceId: row.id,
    body: row.constitution_md ?? '',
    version: row.constitution_version ?? 0,
    updatedAt: row.updated_at,
  };
}

/**
 * 写入宪法（D52 乐观锁）。expectedVersion 必须等于当前 version 才更新；
 * 写入成功后 version+1。
 */
export function updateTeamConstitution(
  options: TeamConstitutionUpdateOptions,
): TeamConstitutionUpdateResult {
  const current = getTeamConstitution({
    userId: options.userId,
    teamWorkspaceId: options.teamWorkspaceId,
  });
  if (!current) return { ok: false, reason: 'not-found' };

  if (current.version !== options.expectedVersion) {
    return { ok: false, reason: 'version-conflict', currentVersion: current.version };
  }

  const nextVersion = current.version + 1;
  sqliteRun(
    `UPDATE team_workspaces
     SET constitution_md = ?,
         constitution_version = ?,
         updated_at = datetime('now')
     WHERE user_id = ? AND id = ? AND constitution_version = ?`,
    [options.body, nextVersion, options.userId, options.teamWorkspaceId, options.expectedVersion],
  );

  const fresh = getTeamConstitution({
    userId: options.userId,
    teamWorkspaceId: options.teamWorkspaceId,
  });
  if (!fresh || fresh.version !== nextVersion) {
    // 罕见：并发写入两次拿到同一 expectedVersion 时，第二次 UPDATE 会因为
    // WHERE constitution_version 不再匹配而 0 行受影响。此时 fresh.version
    // 已经被另一方推进，应当报版本冲突让客户端重读重写。
    return {
      ok: false,
      reason: 'version-conflict',
      currentVersion: fresh?.version ?? current.version,
    };
  }

  return { ok: true, record: fresh };
}
