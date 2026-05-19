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

import { randomUUID } from 'node:crypto';
import { sqliteAll, sqliteGet, sqliteRun } from '../infra/db.js';
import {
  DEFAULT_SOULS,
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
  created_at: string;
  updated_at: string;
}

export interface AgentPersonaRecord {
  id: string;
  roleLayer: SoulRoleLayer;
  key: string;
  soulMd: string;
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
    `SELECT id, user_id, key, role_layer, soul_md, created_at, updated_at
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
    `SELECT id, user_id, key, role_layer, soul_md, created_at, updated_at
     FROM agent_personas
     WHERE user_id = ? AND role_layer = ? AND key = ?
     LIMIT 1`,
    [input.userId, input.roleLayer, input.key],
  );
  return row ? mapPersonaRow(row) : undefined;
}

/**
 * 写入或更新 persona。返回最终记录。
 */
export function upsertAgentPersona(input: {
  userId: string;
  roleLayer: SoulRoleLayer;
  key: string;
  soulMd: string;
}): AgentPersonaRecord {
  const existing = getAgentPersona(input);
  if (existing) {
    sqliteRun(
      `UPDATE agent_personas
       SET soul_md = ?, updated_at = datetime('now')
       WHERE user_id = ? AND role_layer = ? AND key = ?`,
      [input.soulMd, input.userId, input.roleLayer, input.key],
    );
  } else {
    sqliteRun(
      `INSERT INTO agent_personas (id, user_id, role_layer, key, soul_md)
       VALUES (?, ?, ?, ?, ?)`,
      [randomUUID(), input.userId, input.roleLayer, input.key, input.soulMd],
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
 * 一次性确保该用户的 5 层默认 SOUL 都已落库。
 * 用户首次进入 team 设置时调用，幂等。
 */
export function ensureDefaultPersonasForUser(userId: string): AgentPersonaRecord[] {
  const records: AgentPersonaRecord[] = [];
  for (const soul of DEFAULT_SOULS) {
    const existing = getAgentPersona({
      userId,
      roleLayer: soul.roleLayer,
      key: soul.key,
    });
    if (existing) {
      records.push(existing);
      continue;
    }
    records.push(
      upsertAgentPersona({
        userId,
        roleLayer: soul.roleLayer,
        key: soul.key,
        soulMd: soul.soulMd,
      }),
    );
  }
  return records;
}
