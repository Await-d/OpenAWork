/**
 * 结构化规则存储（261101-记忆确认写入与周期整理）。
 *
 * 设计要点：
 * - `memory_rule_entries` 为规则权威（文件发布本期关闭）。
 * - 同 `(user, scope, name)` 已存在启用规则 → 更新 `body`、`revision+1`、刷新
 *   `confirmed_at`；否则插入 `revision=1`。
 * - 注入接口按**白名单**过滤：空数组 = 不返回任何规则（区别于「不限」）。
 */
import { randomUUID } from 'node:crypto';
import type { MemoryRuleEntry, MemoryScope } from '@openAwork/agent-core';
import { memoryScopeKey } from '@openAwork/agent-core';
import {
  sqliteAll,
  sqliteGet,
  sqliteRun,
  sqliteRunWithChanges,
  sqliteTransaction,
} from '../../infra/db.js';

export interface UpsertMemoryRuleInput {
  userId: string;
  scope: MemoryScope;
  name: string;
  body: string;
  now?: Date;
}

export interface SetMemoryRuleEnabledInput {
  userId: string;
  ruleId: string;
  enabled: boolean;
  now?: Date;
}

interface MemoryRuleRow {
  id: string;
  user_id: string;
  scope_type: string;
  scope_id: string;
  name: string;
  body: string;
  revision: number;
  enabled: number;
  confirmed_at: string;
  created_at: string;
  updated_at: string;
}

const VALID_SCOPE_TYPES = new Set(['user', 'workspace', 'team', 'channel_chat']);

function toIso(date: Date): string {
  return date.toISOString();
}

function isoOrNow(date: Date | undefined): string {
  return toIso(date ?? new Date());
}

/** 反解 `scope_key`（`memoryScopeKey` 形式）为 `MemoryScope`；无法解析返回 null。 */
function parseScopeKey(scopeKey: string): MemoryScope | null {
  const separator = scopeKey.indexOf(':');
  if (separator <= 0) {
    return null;
  }
  const type = scopeKey.slice(0, separator);
  const id = scopeKey.slice(separator + 1);
  if (!VALID_SCOPE_TYPES.has(type) || id.length === 0) {
    return null;
  }
  return { type: type as MemoryScope['type'], id };
}

function mapRuleRow(row: MemoryRuleRow): MemoryRuleEntry {
  return {
    id: row.id,
    userId: row.user_id,
    scope: { type: row.scope_type as MemoryScope['type'], id: row.scope_id },
    name: row.name,
    body: row.body,
    revision: row.revision,
    enabled: row.enabled === 1,
    confirmedAt: row.confirmed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const RULE_COLUMNS =
  'id, user_id, scope_type, scope_id, name, body, revision, enabled, confirmed_at, created_at, updated_at';

/**
 * 新增或更新一条规则。
 *
 * 同 `(user, scope, name)` 已存在启用规则时更新正文并 `revision+1`；否则以
 * `revision=1` 新建。
 */
export function upsertMemoryRule(input: UpsertMemoryRuleInput): MemoryRuleEntry {
  const nowIso = isoOrNow(input.now);

  return sqliteTransaction(() => {
    const existing = sqliteGet<MemoryRuleRow>(
      `SELECT ${RULE_COLUMNS}
         FROM memory_rule_entries
        WHERE user_id = ? AND scope_type = ? AND scope_id = ? AND name = ? AND enabled = 1`,
      [input.userId, input.scope.type, input.scope.id, input.name],
    );

    if (existing !== undefined) {
      sqliteRun(
        `UPDATE memory_rule_entries
            SET body = ?, revision = revision + 1, confirmed_at = ?, updated_at = ?
          WHERE id = ?`,
        [input.body, nowIso, nowIso, existing.id],
      );
      return {
        ...mapRuleRow(existing),
        body: input.body,
        revision: existing.revision + 1,
        confirmedAt: nowIso,
        updatedAt: nowIso,
      };
    }

    const id = randomUUID();
    sqliteRun(
      `INSERT INTO memory_rule_entries
         (id, user_id, scope_type, scope_id, name, body, revision, enabled, confirmed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?)`,
      [
        id,
        input.userId,
        input.scope.type,
        input.scope.id,
        input.name,
        input.body,
        nowIso,
        nowIso,
        nowIso,
      ],
    );

    return {
      id,
      userId: input.userId,
      scope: input.scope,
      name: input.name,
      body: input.body,
      revision: 1,
      enabled: true,
      confirmedAt: nowIso,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
  });
}

export function getMemoryRuleByName(
  userId: string,
  scope: MemoryScope,
  name: string,
): MemoryRuleEntry | undefined {
  const row = sqliteGet<MemoryRuleRow>(
    `SELECT ${RULE_COLUMNS} FROM memory_rule_entries
     WHERE user_id = ? AND scope_type = ? AND scope_id = ? AND name = ?
     ORDER BY enabled DESC, rowid DESC LIMIT 1`,
    [userId, scope.type, scope.id, name],
  );
  return row === undefined ? undefined : mapRuleRow(row);
}

/** 列出用户规则；传 `scope` 时按作用域过滤。 */
export function listMemoryRules(userId: string, scope?: MemoryScope): MemoryRuleEntry[] {
  const rows =
    scope === undefined
      ? sqliteAll<MemoryRuleRow>(
          `SELECT ${RULE_COLUMNS}
             FROM memory_rule_entries
            WHERE user_id = ?
            ORDER BY scope_type ASC, scope_id ASC, name ASC`,
          [userId],
        )
      : sqliteAll<MemoryRuleRow>(
          `SELECT ${RULE_COLUMNS}
             FROM memory_rule_entries
            WHERE user_id = ? AND scope_type = ? AND scope_id = ?
            ORDER BY name ASC`,
          [userId, scope.type, scope.id],
        );
  return rows.map(mapRuleRow);
}

/**
 * 列出可用于注入的规则。
 *
 * `allowedScopes` 是 `memoryScopeKey` 形式的**白名单**：空数组表示不返回任何
 * 规则（不是「不限」）。
 */
export function listMemoryRulesForInjection(
  userId: string,
  allowedScopes: readonly string[],
): MemoryRuleEntry[] {
  if (allowedScopes.length === 0) {
    return [];
  }

  const allowed = new Set(allowedScopes);
  const rows = sqliteAll<MemoryRuleRow>(
    `SELECT ${RULE_COLUMNS}
       FROM memory_rule_entries
      WHERE user_id = ? AND enabled = 1
      ORDER BY scope_type ASC, scope_id ASC, name ASC`,
    [userId],
  );

  const result: MemoryRuleEntry[] = [];
  for (const row of rows) {
    const scope = parseScopeKey(`${row.scope_type}:${row.scope_id}`);
    if (scope === null || !allowed.has(memoryScopeKey(scope))) {
      continue;
    }
    result.push(mapRuleRow(row));
  }
  return result;
}

/** 启用 / 停用规则；返回是否有行被改动。 */
export function setMemoryRuleEnabled(input: SetMemoryRuleEnabledInput): boolean {
  const nowIso = isoOrNow(input.now);
  const changes = sqliteRunWithChanges(
    `UPDATE memory_rule_entries
        SET enabled = ?, revision = revision + 1, updated_at = ?
      WHERE id = ? AND user_id = ?`,
    [input.enabled ? 1 : 0, nowIso, input.ruleId, input.userId],
  );
  return changes > 0;
}

/** 删除规则；返回是否删除了行。 */
export function deleteMemoryRule(userId: string, ruleId: string): boolean {
  const changes = sqliteRunWithChanges(
    'DELETE FROM memory_rule_entries WHERE id = ? AND user_id = ?',
    [ruleId, userId],
  );
  return changes > 0;
}
