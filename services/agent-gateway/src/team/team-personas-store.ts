/**
 * 260515-team-phase-a · T-05 后端
 *
 * 角色 SOUL（agent_personas）数据访问层。
 *
 * 表：agent_personas（id / user_id / role_layer / key / soul_md / created_at / updated_at）
 * 路由：services/agent-gateway/src/routes/team-personas.ts
 *
 * 设计要点：
 *   - 五层角色 reception / pm1 / pm2 / executor / reviewer 是 role_layer 的合法值
 *   - 用户首次访问某 role_layer 时，从 team-phase-a-content/soul-defaults.ts
 *     读取默认 SOUL 并 upsert（只在用户尚未自定义时使用默认）
 *   - 同一用户在同一 role_layer 下可以维护多份 persona（不同 key），用于以后
 *     做 A/B 或场景化 SOUL；Phase A 默认只有一份 key='default'
 */

import { randomUUID, createHash } from 'node:crypto';
import { sqliteAll, sqliteGet, sqliteRun } from '../infra/db.js';
import {
  DEFAULT_SOULS,
  DEFAULT_SOUL_VERSION,
  LEGACY_DEFAULT_SOUL_FINGERPRINTS,
  SOUL_ROLE_LAYER_ORDER,
  findDefaultSoul,
  type SoulRoleLayer,
} from '../team-phase-a-content/index.js';

interface PersonaRow {
  id: string;
  user_id: string;
  key: string;
  role_layer: string;
  soul_md: string;
  default_version: number | null;
  created_at: string;
  updated_at: string;
}

export interface AgentPersonaRecord {
  id: string;
  roleLayer: SoulRoleLayer;
  key: string;
  soulMd: string;
  /** 该 persona 作为默认副本落库时的默认版本号；null = 用户自定义 / 早于版本化。 */
  defaultVersion: number | null;
  createdAt: string;
  updatedAt: string;
}

export const VALID_SOUL_ROLE_LAYERS: ReadonlySet<SoulRoleLayer> = new Set(SOUL_ROLE_LAYER_ORDER);

export function isSoulRoleLayer(value: string): value is SoulRoleLayer {
  return VALID_SOUL_ROLE_LAYERS.has(value as SoulRoleLayer);
}

function mapPersonaRow(row: PersonaRow): AgentPersonaRecord {
  return {
    id: row.id,
    roleLayer: row.role_layer as SoulRoleLayer,
    key: row.key,
    soulMd: row.soul_md,
    defaultVersion: row.default_version ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * 列出某用户某层级下的所有 persona（按 key 排序）。
 */
export function listAgentPersonas(input: {
  userId: string;
  roleLayer: SoulRoleLayer;
}): AgentPersonaRecord[] {
  const rows = sqliteAll<PersonaRow>(
    `SELECT id, user_id, key, role_layer, soul_md, default_version, created_at, updated_at
     FROM agent_personas
     WHERE user_id = ? AND role_layer = ?
     ORDER BY key ASC`,
    [input.userId, input.roleLayer],
  );
  return rows.map(mapPersonaRow);
}

/**
 * 获取某用户在某层级 / 某 key 下的 persona。
 */
export function getAgentPersona(input: {
  userId: string;
  roleLayer: SoulRoleLayer;
  key: string;
}): AgentPersonaRecord | undefined {
  const row = sqliteGet<PersonaRow>(
    `SELECT id, user_id, key, role_layer, soul_md, default_version, created_at, updated_at
     FROM agent_personas
     WHERE user_id = ? AND role_layer = ? AND key = ?
     LIMIT 1`,
    [input.userId, input.roleLayer, input.key],
  );
  return row ? mapPersonaRow(row) : undefined;
}

/**
 * 写入或更新 persona。返回最终记录。
 *
 * defaultVersion 语义：
 *   - 传入数字：把该 persona 标记为「系统默认副本 + 版本号」（仅 seed 默认时用）。
 *   - 传入 null / 不传：标记为「用户自定义」（default_version 写 null）——这样默认
 *     升级时不会覆盖用户的修改。用户在设置面板编辑 SOUL 走的就是这条（不传）。
 */
export function upsertAgentPersona(input: {
  userId: string;
  roleLayer: SoulRoleLayer;
  key: string;
  soulMd: string;
  defaultVersion?: number | null;
}): AgentPersonaRecord {
  const defaultVersion = input.defaultVersion ?? null;
  const existing = getAgentPersona(input);
  if (existing) {
    sqliteRun(
      `UPDATE agent_personas
       SET soul_md = ?, default_version = ?, updated_at = datetime('now')
       WHERE user_id = ? AND role_layer = ? AND key = ?`,
      [input.soulMd, defaultVersion, input.userId, input.roleLayer, input.key],
    );
  } else {
    sqliteRun(
      `INSERT INTO agent_personas (id, user_id, role_layer, key, soul_md, default_version)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [randomUUID(), input.userId, input.roleLayer, input.key, input.soulMd, defaultVersion],
    );
  }
  const fresh = getAgentPersona(input);
  if (!fresh) {
    throw new Error('Failed to read back agent persona after upsert');
  }
  return fresh;
}

/**
 * 取得"有效 SOUL"：用户自定义优先，否则回退到默认模板。
 *
 * 这是 7 层指令栈注入的唯一读取点（stream-system-prompts）。
 */
export function resolveEffectiveSoul(input: {
  userId: string;
  roleLayer: SoulRoleLayer;
  key?: string;
}): { soulMd: string; isDefault: boolean } {
  const key = input.key ?? 'default';
  const persona = getAgentPersona({
    userId: input.userId,
    roleLayer: input.roleLayer,
    key,
  });
  if (persona && persona.soulMd.length > 0) {
    return { soulMd: persona.soulMd, isDefault: false };
  }

  const defaultSoul = findDefaultSoul(input.roleLayer);
  return {
    soulMd: defaultSoul?.soulMd ?? '',
    isDefault: true,
  };
}

/**
 * 把某层 persona 重置为「当前最新默认 SOUL」。
 *
 * 用于设置面板的「恢复为最新默认」入口：用户自定义过（或停留在旧版默认）后，
 * 想一键回到当前内置默认文案。重置后该副本重新标记为 default_version=
 * DEFAULT_SOUL_VERSION（即「未自定义的默认副本」），后续默认升级仍会自动下发。
 *
 * 返回重置后的记录；该层无内置默认（不应发生）时返回 undefined。
 */
export function resetAgentPersonaToDefault(input: {
  userId: string;
  roleLayer: SoulRoleLayer;
  key?: string;
}): AgentPersonaRecord | undefined {
  const key = input.key ?? 'default';
  const defaultSoul = findDefaultSoul(input.roleLayer);
  if (!defaultSoul) return undefined;
  return upsertAgentPersona({
    userId: input.userId,
    roleLayer: input.roleLayer,
    key,
    soulMd: defaultSoul.soulMd,
    defaultVersion: DEFAULT_SOUL_VERSION,
  });
}

/**
 * 一次性确保该用户的 5 层默认 SOUL 都已落库，并把「未被用户自定义的默认副本」
 * 自动升级到当前默认版本。幂等。
 *
 * 三种情形：
 *   1. 不存在该层 persona → 种入当前默认（default_version=DEFAULT_SOUL_VERSION）。
 *   2. 存在且 default_version 非空且 < 当前版本 → 它是旧版默认副本（用户没改过）
 *      → 刷新到当前默认 + 升版。
 *   3. 存在且 default_version 为 null → 可能是「用户自定义」也可能是「版本化机制
 *      落库前的旧默认副本」。仅当其内容与某历史默认指纹完全一致（说明用户从未改过）
 *      时，才采纳为默认副本并刷新；否则视为用户自定义，原样保留不动。
 */
export function ensureDefaultPersonasForUser(userId: string): AgentPersonaRecord[] {
  const records: AgentPersonaRecord[] = [];
  for (const soul of DEFAULT_SOULS) {
    const existing = getAgentPersona({
      userId,
      roleLayer: soul.roleLayer,
      key: soul.key,
    });

    // 情形 1：不存在 → 种入当前默认。
    if (!existing) {
      records.push(
        upsertAgentPersona({
          userId,
          roleLayer: soul.roleLayer,
          key: soul.key,
          soulMd: soul.soulMd,
          defaultVersion: DEFAULT_SOUL_VERSION,
        }),
      );
      continue;
    }

    // 情形 2：已是默认副本但版本过旧 → 刷新到当前默认。
    if (existing.defaultVersion !== null && existing.defaultVersion < DEFAULT_SOUL_VERSION) {
      records.push(
        upsertAgentPersona({
          userId,
          roleLayer: soul.roleLayer,
          key: soul.key,
          soulMd: soul.soulMd,
          defaultVersion: DEFAULT_SOUL_VERSION,
        }),
      );
      continue;
    }

    // 情形 3：default_version 为 null —— 用历史指纹判断是否其实是「未改过的旧默认」。
    if (existing.defaultVersion === null) {
      const fingerprint = createHash('sha256').update(existing.soulMd).digest('hex');
      const legacy = LEGACY_DEFAULT_SOUL_FINGERPRINTS[soul.roleLayer] ?? [];
      if (legacy.includes(fingerprint)) {
        // 内容与历史默认完全一致 → 用户没改过 → 采纳为默认副本并刷新到当前版本。
        records.push(
          upsertAgentPersona({
            userId,
            roleLayer: soul.roleLayer,
            key: soul.key,
            soulMd: soul.soulMd,
            defaultVersion: DEFAULT_SOUL_VERSION,
          }),
        );
        continue;
      }
      // 否则视为用户自定义，原样保留。
    }

    records.push(existing);
  }
  return records;
}
