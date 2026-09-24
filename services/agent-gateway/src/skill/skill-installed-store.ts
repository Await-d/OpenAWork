/**
 * 已安装技能（`installed_skills`）的共享读写层。
 *
 * 从 `routes/skills.ts` 抽取：路由（HTTP）与 `skill_manage` 工具必须共用同一套
 * 落库语义（安装 upsert / 卸载级联清理 / 启停），避免两处实现漂移。
 */

import { sqliteAll, sqliteGet, sqliteRun, sqliteTransaction } from '../infra/db.js';

export interface InstalledSkillRow {
  skill_id: string;
  source_id: string;
  manifest_json: string;
  granted_permissions_json: string;
  enabled: number;
  installed_at: number;
  updated_at: number;
  latest_version_check_json?: string | null;
}

interface LatestVersionCheckRecord {
  latestVersion: string | null;
  checkedAt: number;
  error: string | null;
}

export interface InstalledSkillRecord {
  skillId: string;
  sourceId: string;
  manifest: unknown;
  grantedPermissions: unknown[];
  enabled: boolean;
  installedAt: number;
  updatedAt: number;
  latestVersion: string | null;
  latestVersionCheckedAt: number | null;
}

export function rowToInstalledSkill(row: InstalledSkillRow): InstalledSkillRecord {
  let latestVersion: string | null = null;
  let latestVersionCheckedAt: number | null = null;
  if (row.latest_version_check_json) {
    try {
      const parsed = JSON.parse(row.latest_version_check_json) as LatestVersionCheckRecord;
      if (typeof parsed.latestVersion === 'string') latestVersion = parsed.latestVersion;
      if (typeof parsed.checkedAt === 'number') latestVersionCheckedAt = parsed.checkedAt;
    } catch {
      // Corrupt JSON — leave both fields null and let the background
      // checker overwrite on next run.
    }
  }
  return {
    skillId: row.skill_id,
    sourceId: row.source_id,
    manifest: JSON.parse(row.manifest_json) as unknown,
    grantedPermissions: JSON.parse(row.granted_permissions_json) as unknown[],
    enabled: row.enabled === 1,
    installedAt: row.installed_at,
    updatedAt: row.updated_at,
    latestVersion,
    latestVersionCheckedAt,
  };
}

// Corrupt-row tolerance (§0.89/§0.90 class): `manifest_json` /
// `granted_permissions_json` are persisted via `JSON.stringify`, but a crash
// mid-write, a disk error, or a hand-edited DB can leave a column that is not
// valid JSON. `/skills/installed` does `rows.map(rowToInstalledSkill)`, so a
// single corrupt row would throw and 500 the WHOLE installed-skills list. This
// variant returns `null` + warn so the list path can skip the bad row and the
// rest still loads.
export function tryRowToInstalledSkill(row: InstalledSkillRow): InstalledSkillRecord | null {
  try {
    return rowToInstalledSkill(row);
  } catch (error) {
    console.warn(
      `[skills] installed skill ${row.skill_id} JSON 解析失败，已跳过：${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }
}

/**
 * 安装（或覆盖安装）一条已安装技能记录。
 *
 * 与 `POST /skills/install` 的历史行为一致：`granted_permissions_json` 落 `[]`，
 * 同 `(skill_id, user_id)` 冲突时覆盖 manifest / source / granted / updated_at。
 */
export function upsertInstalledSkill(
  userId: string,
  input: { skillId: string; sourceId: string; manifestJson: string },
): InstalledSkillRecord {
  const now = Date.now();
  sqliteRun(
    `INSERT INTO installed_skills (skill_id, user_id, source_id, manifest_json, granted_permissions_json, enabled, installed_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?)
     ON CONFLICT(skill_id, user_id) DO UPDATE SET
       source_id = excluded.source_id,
       manifest_json = excluded.manifest_json,
       granted_permissions_json = excluded.granted_permissions_json,
       updated_at = excluded.updated_at`,
    [input.skillId, userId, input.sourceId, input.manifestJson, '[]', now, now],
  );
  return rowToInstalledSkill({
    skill_id: input.skillId,
    source_id: input.sourceId,
    manifest_json: input.manifestJson,
    granted_permissions_json: '[]',
    enabled: 1,
    installed_at: now,
    updated_at: now,
  });
}

/**
 * 卸载技能：单事务内删除 installed_skills 及其会话选择 / 覆盖残留。
 *
 * `chat_workspace_skill_configured` 标记**有意保留**：用户显式配置过工作区技能集后
 * 再卸载某个技能，其「已显式配置」的选择仍然成立，resolver 只会观察到更小的集合。
 */
export function uninstallSkillForUser(userId: string, skillId: string): boolean {
  const existing = sqliteGet<{ skill_id: string }>(
    'SELECT skill_id FROM installed_skills WHERE skill_id = ? AND user_id = ?',
    [skillId, userId],
  );
  if (!existing) {
    return false;
  }

  sqliteTransaction(() => {
    sqliteRun('DELETE FROM installed_skills WHERE skill_id = ? AND user_id = ?', [skillId, userId]);
    sqliteRun('DELETE FROM chat_workspace_skill_selections WHERE user_id = ? AND skill_id = ?', [
      userId,
      skillId,
    ]);
    sqliteRun(
      `DELETE FROM chat_session_skill_overrides
       WHERE skill_id = ?
         AND session_id IN (SELECT id FROM sessions WHERE user_id = ?)`,
      [skillId, userId],
    );
  });
  return true;
}

/** 启停已安装技能；未安装时返回 `undefined`。 */
export function setInstalledSkillEnabled(
  userId: string,
  skillId: string,
  enabled: boolean,
): InstalledSkillRecord | undefined {
  const existing = sqliteGet<InstalledSkillRow>(
    'SELECT * FROM installed_skills WHERE skill_id = ? AND user_id = ?',
    [skillId, userId],
  );
  if (!existing) {
    return undefined;
  }

  sqliteRun(
    'UPDATE installed_skills SET enabled = ?, updated_at = ? WHERE skill_id = ? AND user_id = ?',
    [enabled ? 1 : 0, Date.now(), skillId, userId],
  );
  return rowToInstalledSkill({ ...existing, enabled: enabled ? 1 : 0 });
}

/** 列举用户已安装技能（损坏行跳过）。 */
export function listInstalledSkillsForUser(userId: string): InstalledSkillRecord[] {
  const rows = sqliteAll<InstalledSkillRow>(
    'SELECT * FROM installed_skills WHERE user_id = ? ORDER BY updated_at DESC',
    [userId],
  );
  return rows.flatMap((row) => {
    const skill = tryRowToInstalledSkill(row);
    return skill ? [skill] : [];
  });
}
