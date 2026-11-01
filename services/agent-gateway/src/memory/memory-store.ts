import { randomUUID } from 'node:crypto';
import type {
  MemoryEntry,
  MemoryListFilter,
  MemoryRoleLayer,
  MemoryScope,
  MemoryLifecycle,
  MemoryConfirmationKind,
  MemoryStats,
  CreateMemoryInput,
  UpdateMemoryInput,
  MemorySettings,
} from '@openAwork/agent-core';
import {
  DEFAULT_MEMORY_SETTINGS,
  MEMORY_SETTINGS_KEY,
  parseMemorySettings,
  userMemoryScope,
  normalizeWorkspaceScopeId,
} from '@openAwork/agent-core';
import { sqliteAll, sqliteGet, sqliteRun } from '../infra/db.js';
import { isSqliteMalformedError } from '../infra/sqlite-error-utils.js';
import { logGatewayWarn } from '../infra/gateway-logger.js';

/**
 * 本模块只提供**存储原语**（`createMemory` / `updateMemory` / `deleteMemory` / 查询），
 * 不提供任何「按候选批量写入」的入口。
 *
 * 261101 之前这里存在第二份 `upsertExtractedMemories`：它直接调用 `createMemory` 落库，
 * 与 `memory-extraction-store` 的同名壳形成**两条写入路径**，其中直写那份绕过确认门
 * （当时无人 import，属静默旁路）。已删除，并在 `__tests__/memory/memory-store-write-guard`
 * 里锁定「这两类入口不得再出现」。新增批量写入请一律走 `memory-extraction-store`（提议化）
 * 或治理提交器。
 */

interface MemoryRow {
  id: string;
  user_id: string;
  type: string;
  key: string;
  value: string;
  source: string;
  confidence: number;
  priority: number;
  workspace_root: string | null;
  team_workspace_id: string | null;
  role_layers_json: string | null;
  enabled: number;
  created_at: string;
  updated_at: string;
  scope_type: string | null;
  scope_id: string | null;
  lifecycle: string | null;
  revision: number | null;
  confirmation_kind: string | null;
  confirmed_at: string | null;
  change_seq: number | null;
  valid_until: string | null;
  superseded_by: string | null;
}

/**
 * 全局单调变更水位。
 *
 * 维护任务按 `change_seq` 增量扫描，故任何改变正式记忆的写入都必须取一次新水位，
 * 且必须与写入本身同事务——否则会出现「条目已变但水位未动」的漏扫窗口。
 */
export function nextMemoryChangeSeq(): number {
  sqliteRun('UPDATE memory_change_counter SET value = value + 1 WHERE id = 1', []);
  const row = sqliteGet<{ value: number }>(
    'SELECT value FROM memory_change_counter WHERE id = 1 LIMIT 1',
    [],
  );
  return row?.value ?? 1;
}

const MEMORY_ROLE_LAYERS: ReadonlySet<MemoryRoleLayer> = new Set([
  'reception',
  'pm1',
  'pm2',
  'executor',
  'reviewer',
]);

const WORKSPACE_KNOWLEDGE_ARCHITECTURE_SEARCH_TERMS = [
  'architecture:',
  'arch:',
  'manual:architecture',
  'manual:arch:',
  'manual:arch-',
  'manual:arch_',
  ':architecture-',
  ':architecture_',
  ':架构',
];

const WORKSPACE_KNOWLEDGE_ARTIFACT_SEARCH_TERMS = [
  'artifact:',
  'manual:artifact',
  ':artifact-',
  ':artifact_',
];

type WorkspaceKnowledgeRoleLayerSearchKind = MemoryRoleLayer | 'all';

function normalizeMemoryRoleLayers(
  roleLayers: readonly MemoryRoleLayer[] | null | undefined,
): MemoryRoleLayer[] | null {
  if (!roleLayers || roleLayers.length === 0) {
    return null;
  }
  const normalized: MemoryRoleLayer[] = [];
  for (const layer of roleLayers) {
    if (MEMORY_ROLE_LAYERS.has(layer) && !normalized.includes(layer)) {
      normalized.push(layer);
    }
  }
  return normalized.length > 0 ? normalized : null;
}

function parseMemoryRoleLayers(value: string | null): MemoryRoleLayer[] | null {
  if (!value || value.trim().length === 0) {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return null;
    }
    const roleLayers = parsed.filter(
      (item): item is MemoryRoleLayer =>
        typeof item === 'string' && MEMORY_ROLE_LAYERS.has(item as MemoryRoleLayer),
    );
    return normalizeMemoryRoleLayers(roleLayers);
  } catch (error) {
    logGatewayWarn(
      `[memory-store] role_layers_json 解析失败，已按全部层级处理：${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }
}

function memoryRowReadableByRoleLayer(row: MemoryRow, roleLayer: MemoryRoleLayer): boolean {
  const value = row.role_layers_json;
  if (!value || value.trim().length === 0) {
    return true;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return false;
    }
    return parsed.some((item) => item === roleLayer);
  } catch (error) {
    logGatewayWarn(
      `[memory-store] role_layers_json 解析失败，已从 ${roleLayer} 层过滤结果排除：${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return false;
  }
}

function serializeMemoryRoleLayers(
  roleLayers: readonly MemoryRoleLayer[] | null | undefined,
): string | null {
  const normalized = normalizeMemoryRoleLayers(roleLayers);
  return normalized ? JSON.stringify(normalized) : null;
}

function buildWorkspaceKnowledgeSearchFilter(search: string | undefined): {
  params: string[];
  sql: string;
} | null {
  const trimmed = search?.trim();
  if (!trimmed) {
    return null;
  }

  const normalized = trimmed.toLocaleLowerCase();
  const terms = new Set<string>();
  const persistentOnly =
    normalized === '已入库' ||
    normalized === 'persisted' ||
    normalized === 'saved' ||
    isWholeWorkspaceKnowledgeSearchTerm(normalized);
  const semanticOnly = isWorkspaceKnowledgeSemanticOnlySearchTerm(normalized);
  if (!persistentOnly && !semanticOnly) {
    terms.add(trimmed);
  }
  addWorkspaceKnowledgeSearchAliases(terms, normalized);
  const semanticTypes = workspaceKnowledgeSemanticSearchTypes(normalized);
  const roleLayerSearchKind = workspaceKnowledgeRoleLayerSearchKind(normalized);
  for (const semanticType of semanticTypes) {
    terms.delete(semanticType);
  }

  const clauses: string[] = [];
  const params: string[] = [];
  if (semanticTypes.length > 0) {
    const typeSql =
      semanticTypes.length === 1
        ? 'type = ?'
        : `type IN (${semanticTypes.map(() => '?').join(', ')})`;
    if (isWorkspaceKnowledgeMemoryLikeSearchTerm(normalized)) {
      const keyExclusion = buildWorkspaceKnowledgeMemoryKeyExclusion();
      clauses.push(`(${typeSql} AND ${keyExclusion.sql})`);
      params.push(...semanticTypes, ...keyExclusion.params);
    } else {
      clauses.push(typeSql);
      params.push(...semanticTypes);
    }
  }
  if (roleLayerSearchKind === 'all') {
    clauses.push("(role_layers_json IS NULL OR trim(role_layers_json) = '')");
  } else if (roleLayerSearchKind) {
    clauses.push('role_layers_json LIKE ?');
    params.push(`%"${roleLayerSearchKind}"%`);
  }
  for (const term of terms) {
    const pattern = `%${escapeSqlLikeTerm(term)}%`;
    clauses.push(
      "(key LIKE ? ESCAPE '\\' OR value LIKE ? ESCAPE '\\' OR type LIKE ? ESCAPE '\\' OR source LIKE ? ESCAPE '\\' OR role_layers_json LIKE ? ESCAPE '\\')",
    );
    params.push(pattern, pattern, pattern, pattern, pattern);
  }
  if (
    roleLayerSearchKind !== 'all' &&
    (normalized.includes('全部层级') ||
      normalized.includes('全部可读') ||
      normalized.includes('all layers'))
  ) {
    clauses.push("(role_layers_json IS NULL OR trim(role_layers_json) = '')");
  }

  return clauses.length > 0 ? { params, sql: `(${clauses.join(' OR ')})` } : null;
}

function escapeSqlLikeTerm(term: string): string {
  return term.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

function isWholeWorkspaceKnowledgeSearchTerm(normalized: string): boolean {
  return (
    normalized === '知识' ||
    normalized === '工作区知识' ||
    normalized === '知识库' ||
    normalized === '知识资产' ||
    normalized === '知识图谱' ||
    normalized === '全部知识' ||
    normalized === '全量知识' ||
    normalized === '完整图谱' ||
    normalized === 'workspace knowledge' ||
    normalized === 'knowledge base' ||
    normalized === 'knowledge graph' ||
    normalized === 'all knowledge' ||
    normalized === 'full graph'
  );
}

function isWorkspaceKnowledgeSemanticOnlySearchTerm(normalized: string): boolean {
  return (
    normalized === '架构' ||
    normalized === 'architecture' ||
    normalized === 'arch' ||
    normalized === '产物' ||
    normalized === 'artifact' ||
    normalized === '事实' ||
    normalized === 'fact' ||
    normalized === '规则' ||
    normalized === '指令' ||
    normalized === '团队宪法' ||
    normalized === 'constitution' ||
    normalized === 'instruction' ||
    normalized === '记忆' ||
    normalized === 'memory' ||
    normalized === '工作区记忆' ||
    normalized === '项目记忆' ||
    normalized === 'project memory' ||
    workspaceKnowledgeRoleLayerSearchKind(normalized) !== null
  );
}

function isWorkspaceKnowledgeMemorySearchTerm(normalized: string): boolean {
  return normalized === '记忆' || normalized === 'memory' || normalized === '工作区记忆';
}

function isWorkspaceKnowledgeProjectMemorySearchTerm(normalized: string): boolean {
  return normalized === '项目记忆' || normalized === 'project memory';
}

function isWorkspaceKnowledgeMemoryLikeSearchTerm(normalized: string): boolean {
  return (
    isWorkspaceKnowledgeMemorySearchTerm(normalized) ||
    isWorkspaceKnowledgeProjectMemorySearchTerm(normalized)
  );
}

function buildWorkspaceKnowledgeMemoryKeyExclusion(): { params: string[]; sql: string } {
  const terms = [
    ...WORKSPACE_KNOWLEDGE_ARCHITECTURE_SEARCH_TERMS,
    ...WORKSPACE_KNOWLEDGE_ARTIFACT_SEARCH_TERMS,
  ];
  return {
    params: terms.map((term) => `%${escapeSqlLikeTerm(term)}%`),
    sql: terms.map(() => "key NOT LIKE ? ESCAPE '\\'").join(' AND '),
  };
}

function workspaceKnowledgeSemanticSearchTypes(normalized: string): MemoryEntry['type'][] {
  switch (normalized) {
    case '事实':
    case 'fact':
      return ['fact'];
    case '规则':
    case '指令':
    case '团队宪法':
    case 'constitution':
    case 'instruction':
      return ['instruction'];
    case '记忆':
    case 'memory':
    case '工作区记忆':
      return ['project_context', 'learned_pattern', 'preference', 'fact'];
    case '项目记忆':
    case 'project memory':
      return ['project_context'];
    default:
      return [];
  }
}

function workspaceKnowledgeRoleLayerSearchKind(
  normalized: string,
): WorkspaceKnowledgeRoleLayerSearchKind | null {
  const search = normalized.trim().replace(/\s+/g, ' ');
  switch (search) {
    case '接待':
    case '接待层':
    case 'reception':
    case 'reception layer':
      return 'reception';
    case 'pm1':
    case 'pm 1':
    case 'pm1层':
    case 'pm1 layer':
      return 'pm1';
    case 'pm2':
    case 'pm 2':
    case 'pm2层':
    case 'pm2 layer':
      return 'pm2';
    case '执行':
    case '执行层':
    case 'executor':
    case 'executor layer':
      return 'executor';
    case '评审':
    case '评审层':
    case 'reviewer':
    case 'reviewer layer':
      return 'reviewer';
    case '全部层级':
    case '全部可读':
    case '全部层级可读':
    case '全层级':
    case '全层级可读':
    case 'all layer':
    case 'all layers':
      return 'all';
    default:
      return null;
  }
}

function addWorkspaceKnowledgeSearchAliases(terms: Set<string>, normalized: string): void {
  const aliases: Array<[string[], string | string[]]> = [
    [['项目上下文', 'project context'], 'project_context'],
    [['架构', 'architecture'], WORKSPACE_KNOWLEDGE_ARCHITECTURE_SEARCH_TERMS],
    [['产物', 'artifact'], WORKSPACE_KNOWLEDGE_ARTIFACT_SEARCH_TERMS],
    [['规则', '指令', '团队宪法', 'constitution', 'instruction'], 'instruction'],
    [['经验', '沉淀', 'learned pattern'], 'learned_pattern'],
    [['个人记忆', '用户记忆', '偏好', 'preference'], 'preference'],
    [['事实', 'fact'], 'fact'],
    [['手动', 'manual'], 'manual'],
    [['自动', '抽取', 'auto extracted'], 'auto_extracted'],
    [['api'], 'api'],
  ];
  for (const [labels, alias] of aliases) {
    if (labels.some((label) => normalized.includes(label))) {
      const aliasTerms = Array.isArray(alias) ? alias : [alias];
      for (const aliasTerm of aliasTerms) {
        terms.add(aliasTerm);
      }
    }
  }
  if (normalized === 'arch') {
    for (const aliasTerm of WORKSPACE_KNOWLEDGE_ARCHITECTURE_SEARCH_TERMS) {
      terms.add(aliasTerm);
    }
  }
  if (isWorkspaceKnowledgeMemorySearchTerm(normalized)) {
    terms.add('project_context');
    terms.add('learned_pattern');
    terms.add('preference');
    terms.add('fact');
  }
}

/**
 * 把一行 `memories` 记录映射为领域对象。
 *
 * 作用域采用三态回退：优先 `scope_type`/`scope_id`（新库与迁移后都有值），缺失则按
 * team → workspace → user 顺序从旧列推断，保证历史行与未迁移行也能读出合理作用域。
 * 生命周期、版本、水位同样给默认值，避免 null 渗透到注入与展示层。
 */
function rowToMemoryEntry(row: MemoryRow): MemoryEntry {
  const scope = resolveRowScope(row);
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type as MemoryEntry['type'],
    key: row.key,
    value: row.value,
    source: row.source as MemoryEntry['source'],
    confidence: row.confidence,
    priority: row.priority,
    workspaceRoot: row.workspace_root,
    teamWorkspaceId: row.team_workspace_id,
    roleLayers: parseMemoryRoleLayers(row.role_layers_json),
    enabled: row.enabled === 1,
    scope,
    lifecycle: parseMemoryLifecycle(row.lifecycle),
    revision: row.revision ?? 1,
    confirmationKind: parseMemoryConfirmationKind(row.confirmation_kind),
    confirmedAt: row.confirmed_at ?? null,
    changeSeq: row.change_seq ?? 0,
    validUntil: row.valid_until ?? null,
    supersededBy: row.superseded_by ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function resolveRowScope(row: MemoryRow): MemoryScope {
  if (row.scope_type && row.scope_id) {
    return { type: row.scope_type as MemoryScope['type'], id: row.scope_id };
  }
  const teamWorkspaceId = row.team_workspace_id?.trim();
  if (teamWorkspaceId) {
    return { type: 'team', id: teamWorkspaceId };
  }
  const workspaceRoot = row.workspace_root?.trim();
  if (workspaceRoot) {
    return { type: 'workspace', id: normalizeWorkspaceScopeId(workspaceRoot) };
  }
  return userMemoryScope(row.user_id);
}

const MEMORY_LIFECYCLES: ReadonlySet<string> = new Set(['active', 'archived', 'superseded']);

function parseMemoryLifecycle(value: string | null): MemoryLifecycle {
  return value && MEMORY_LIFECYCLES.has(value) ? (value as MemoryLifecycle) : 'active';
}

function parseMemoryConfirmationKind(value: string | null): MemoryConfirmationKind | null {
  return value === 'manual' || value === 'proposal' ? value : null;
}

export function createMemory(userId: string, input: CreateMemoryInput): MemoryEntry {
  const id = randomUUID();
  const now = new Date().toISOString();
  const roleLayers = normalizeMemoryRoleLayers(input.roleLayers);
  const enabled = input.enabled !== false;
  const scope = input.scope ?? userMemoryScope(userId);
  const changeSeq = nextMemoryChangeSeq();
  sqliteRun(
    `INSERT INTO memories (
       id, user_id, type, key, value, source, confidence, priority,
       workspace_root, team_workspace_id, role_layers_json, enabled, created_at, updated_at,
       scope_type, scope_id, lifecycle, revision, confirmation_kind, confirmed_at,
       change_seq, valid_until, superseded_by
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      userId,
      input.type,
      input.key,
      input.value,
      input.source ?? 'manual',
      input.confidence ?? 1.0,
      input.priority ?? 50,
      input.workspaceRoot ?? null,
      input.teamWorkspaceId ?? null,
      serializeMemoryRoleLayers(roleLayers),
      enabled ? 1 : 0,
      now,
      now,
      scope.type,
      scope.id,
      'active',
      1,
      input.confirmationKind ?? null,
      input.confirmedAt ?? null,
      changeSeq,
      input.validUntil ?? null,
      null,
    ],
  );
  return {
    id,
    userId,
    type: input.type,
    key: input.key,
    value: input.value,
    source: input.source ?? 'manual',
    confidence: input.confidence ?? 1.0,
    priority: input.priority ?? 50,
    workspaceRoot: input.workspaceRoot ?? null,
    teamWorkspaceId: input.teamWorkspaceId ?? null,
    roleLayers,
    enabled,
    scope,
    lifecycle: 'active',
    revision: 1,
    confirmationKind: input.confirmationKind ?? null,
    confirmedAt: input.confirmedAt ?? null,
    changeSeq,
    validUntil: input.validUntil ?? null,
    supersededBy: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function getMemoryById(userId: string, memoryId: string): MemoryEntry | undefined {
  const row = sqliteGet<MemoryRow>('SELECT * FROM memories WHERE id = ? AND user_id = ? LIMIT 1', [
    memoryId,
    userId,
  ]);
  return row ? rowToMemoryEntry(row) : undefined;
}

export function listMemories(userId: string, filter: MemoryListFilter): MemoryEntry[] {
  const conditions: string[] = ['user_id = ?'];
  const params: Array<string | number | null> = [userId];

  if (filter.type !== undefined) {
    conditions.push('type = ?');
    params.push(filter.type);
  }
  if (filter.source !== undefined) {
    conditions.push('source = ?');
    params.push(filter.source);
  }
  if (filter.enabled !== undefined) {
    conditions.push('enabled = ?');
    params.push(filter.enabled ? 1 : 0);
  }
  if (filter.workspaceRoot !== undefined) {
    if (filter.workspaceRoot === null) {
      conditions.push('workspace_root IS NULL');
    } else {
      conditions.push('workspace_root = ?');
      params.push(filter.workspaceRoot);
    }
  }
  if (filter.teamWorkspaceId !== undefined) {
    if (filter.teamWorkspaceId === null) {
      conditions.push('team_workspace_id IS NULL');
    } else {
      conditions.push('team_workspace_id = ?');
      params.push(filter.teamWorkspaceId);
    }
  }
  if (filter.roleLayer !== undefined) {
    conditions.push('(role_layers_json IS NULL OR role_layers_json LIKE ?)');
    params.push(`%"${filter.roleLayer}"%`);
  }
  if (filter.search !== undefined && filter.search.trim().length > 0) {
    conditions.push('(key LIKE ? OR value LIKE ?)');
    const searchPattern = `%${filter.search.trim()}%`;
    params.push(searchPattern, searchPattern);
  }

  const limit = filter.limit ?? 100;
  const offset = filter.offset ?? 0;

  const rows = sqliteAll<MemoryRow>(
    `SELECT * FROM memories WHERE ${conditions.join(' AND ')} ORDER BY priority DESC, confidence DESC, key ASC, id ASC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  return rows.map(rowToMemoryEntry);
}

export function listMemoriesForTeamWorkspaceKnowledge(
  userId: string,
  filter: MemoryListFilter & { teamWorkspaceId: string; workspaceRoot?: string | null },
): MemoryEntry[] {
  const conditions: string[] = ['user_id = ?'];
  const params: Array<string | number | null> = [userId];

  if (filter.type !== undefined) {
    conditions.push('type = ?');
    params.push(filter.type);
  }
  if (filter.source !== undefined) {
    conditions.push('source = ?');
    params.push(filter.source);
  }
  if (filter.enabled !== undefined) {
    conditions.push('enabled = ?');
    params.push(filter.enabled ? 1 : 0);
  }

  if (filter.workspaceRoot && filter.workspaceRoot.trim().length > 0) {
    conditions.push(
      '(team_workspace_id = ? OR (team_workspace_id IS NULL AND workspace_root = ?))',
    );
    params.push(filter.teamWorkspaceId, filter.workspaceRoot);
  } else {
    conditions.push('team_workspace_id = ?');
    params.push(filter.teamWorkspaceId);
  }

  const searchFilter = buildWorkspaceKnowledgeSearchFilter(filter.search);
  if (searchFilter) {
    conditions.push(searchFilter.sql);
    params.push(...searchFilter.params);
  }

  const limit = filter.limit ?? 100;
  const offset = filter.offset ?? 0;
  const roleLayer = filter.roleLayer;
  if (roleLayer !== undefined) {
    conditions.push(
      "(role_layers_json IS NULL OR trim(role_layers_json) = '' OR role_layers_json LIKE ?)",
    );
    params.push(`%"${roleLayer}"%`);
    const rows = sqliteAll<MemoryRow>(
      `SELECT * FROM memories WHERE ${conditions.join(' AND ')} ORDER BY priority DESC, confidence DESC, key ASC, id ASC`,
      params,
    );
    return rows
      .filter((row) => memoryRowReadableByRoleLayer(row, roleLayer))
      .slice(offset, offset + limit)
      .map(rowToMemoryEntry);
  }

  const rows = sqliteAll<MemoryRow>(
    `SELECT * FROM memories WHERE ${conditions.join(' AND ')} ORDER BY priority DESC, confidence DESC, key ASC, id ASC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  return rows.map(rowToMemoryEntry);
}

/**
 * 旧签名兼容：默认按 user 作用域查找启用记忆。
 *
 * 历史调用方（管理工具、提取流程）不知道作用域概念，其语义一直是「用户级同名记忆」，
 * 故这里固定落到 `userMemoryScope(userId)`，由新函数承载作用域过滤。
 */
export function findEnabledMemoryByTypeAndKey(
  userId: string,
  type: MemoryEntry['type'],
  key: string,
): MemoryEntry | undefined {
  return findActiveMemoryByTypeAndKey(userId, userMemoryScope(userId), type, key);
}

export function updateMemory(
  userId: string,
  memoryId: string,
  input: UpdateMemoryInput,
): MemoryEntry | undefined {
  const existing = getMemoryById(userId, memoryId);
  if (!existing) return undefined;

  // 乐观并发：调用方持有的期望版本与库内当前版本不一致时拒绝写入，让上层去提示
  // 「内容已被他人改动」，而不是静默覆盖掉对方的修改。
  if (input.expectedRevision !== undefined && input.expectedRevision !== existing.revision) {
    return undefined;
  }

  const setClauses: string[] = ["updated_at = datetime('now')"];
  const params: Array<string | number | null> = [];

  if (input.type !== undefined) {
    setClauses.push('type = ?');
    params.push(input.type);
  }
  if (input.key !== undefined) {
    setClauses.push('key = ?');
    params.push(input.key);
  }
  if (input.value !== undefined) {
    setClauses.push('value = ?');
    params.push(input.value);
  }
  if (input.source !== undefined) {
    setClauses.push('source = ?');
    params.push(input.source);
  }
  if (input.confidence !== undefined) {
    setClauses.push('confidence = ?');
    params.push(input.confidence);
  }
  if (input.priority !== undefined) {
    setClauses.push('priority = ?');
    params.push(input.priority);
  }
  if (input.workspaceRoot !== undefined) {
    setClauses.push('workspace_root = ?');
    params.push(input.workspaceRoot);
  }
  if (input.teamWorkspaceId !== undefined) {
    setClauses.push('team_workspace_id = ?');
    params.push(input.teamWorkspaceId);
  }
  if (input.roleLayers !== undefined) {
    setClauses.push('role_layers_json = ?');
    params.push(serializeMemoryRoleLayers(input.roleLayers));
  }
  if (input.enabled !== undefined) {
    setClauses.push('enabled = ?');
    params.push(input.enabled ? 1 : 0);
  }
  if (input.scope !== undefined) {
    setClauses.push('scope_type = ?', 'scope_id = ?');
    params.push(input.scope.type, input.scope.id);
  }
  if (input.lifecycle !== undefined) {
    setClauses.push('lifecycle = ?');
    params.push(input.lifecycle);
  }
  if (input.validUntil !== undefined) {
    setClauses.push('valid_until = ?');
    params.push(input.validUntil);
  }
  if (input.supersededBy !== undefined) {
    setClauses.push('superseded_by = ?');
    params.push(input.supersededBy);
  }
  if (input.confirmationKind !== undefined) {
    setClauses.push('confirmation_kind = ?');
    params.push(input.confirmationKind);
  }
  if (input.confirmedAt !== undefined) {
    setClauses.push('confirmed_at = ?');
    params.push(input.confirmedAt);
  }

  // 每次成功更新都推进版本与全局水位：版本供回滚/冲突检测，水位供维护增量扫描。
  setClauses.push('revision = revision + 1', 'change_seq = ?');
  params.push(nextMemoryChangeSeq());

  params.push(memoryId, userId);
  sqliteRun(`UPDATE memories SET ${setClauses.join(', ')} WHERE id = ? AND user_id = ?`, params);

  return getMemoryById(userId, memoryId);
}

/** 按作用域列出正式记忆（可选 enabled / lifecycle / limit 过滤）。 */
export function listMemoriesByScope(
  userId: string,
  scope: MemoryScope,
  filter?: { enabled?: boolean; lifecycle?: MemoryLifecycle; limit?: number },
): MemoryEntry[] {
  const conditions: string[] = ['user_id = ?', 'scope_type = ?', 'scope_id = ?'];
  const params: Array<string | number | null> = [userId, scope.type, scope.id];
  if (filter?.enabled !== undefined) {
    conditions.push('enabled = ?');
    params.push(filter.enabled ? 1 : 0);
  }
  if (filter?.lifecycle !== undefined) {
    conditions.push('lifecycle = ?');
    params.push(filter.lifecycle);
  }
  const limit = filter?.limit ?? 1000;
  const rows = sqliteAll<MemoryRow>(
    `SELECT * FROM memories WHERE ${conditions.join(' AND ')} ORDER BY priority DESC, confidence DESC, key ASC, id ASC LIMIT ?`,
    [...params, limit],
  );
  return rows.map(rowToMemoryEntry);
}

/** 某作用域内启用且处于 active 生命周期的记忆，供注入与查重使用。 */
export function listActiveMemoriesForScope(userId: string, scope: MemoryScope): MemoryEntry[] {
  return listMemoriesByScope(userId, scope, { enabled: true, lifecycle: 'active' });
}

/** 自某水位以来发生变更的 active 记忆（维护任务增量扫描）。 */
export function listActiveMemoriesChangedSince(
  userId: string,
  sinceChangeSeq: number,
  limit = 1000,
): MemoryEntry[] {
  const rows = sqliteAll<MemoryRow>(
    `SELECT * FROM memories
     WHERE user_id = ? AND lifecycle = 'active' AND change_seq > ?
     ORDER BY change_seq ASC, id ASC LIMIT ?`,
    [userId, sinceChangeSeq, limit],
  );
  return rows.map(rowToMemoryEntry);
}

/** 在某作用域内按 type + key 查启用中的 active 记忆（唯一键语义）。 */
export function findActiveMemoryByTypeAndKey(
  userId: string,
  scope: MemoryScope,
  type: MemoryEntry['type'],
  key: string,
): MemoryEntry | undefined {
  const row = sqliteGet<MemoryRow>(
    `SELECT * FROM memories
     WHERE user_id = ? AND scope_type = ? AND scope_id = ? AND type = ? AND key = ?
       AND enabled = 1 AND lifecycle = 'active'
     LIMIT 1`,
    [userId, scope.type, scope.id, type, key],
  );
  return row ? rowToMemoryEntry(row) : undefined;
}

/**
 * 注入用：跨多个作用域取启用、active、置信度达标且在有效期内的记忆。
 *
 * `allowedScopes` 是注入白名单的来源（渠道会话据此把 owner 个人记忆挡在上下文外），
 * 传空数组时返回空集而不是「不过滤」——白名单语义下空集就是「不注入任何记忆」。
 */
export function listEnabledMemoriesForScopeInjection(
  userId: string,
  scopes: readonly MemoryScope[],
  minConfidence: number,
): MemoryEntry[] {
  if (scopes.length === 0) {
    return [];
  }
  const scopeClauses = scopes.map(() => '(scope_type = ? AND scope_id = ?)').join(' OR ');
  const params: Array<string | number | null> = [userId, minConfidence];
  for (const scope of scopes) {
    params.push(scope.type, scope.id);
  }
  const rows = sqliteAll<MemoryRow>(
    `SELECT * FROM memories
     WHERE user_id = ? AND enabled = 1 AND lifecycle = 'active' AND confidence >= ?
       AND (valid_until IS NULL OR valid_until > datetime('now'))
       AND (${scopeClauses})
     ORDER BY priority DESC, confidence DESC, key ASC, id ASC`,
    params,
  );
  return rows.map(rowToMemoryEntry);
}

/**
 * 刻意**不提供**「硬删除记忆」原语（261101）。
 *
 * 这里曾导出 `deleteMemory`：一条 `DELETE FROM memories`，无调用方，但会把
 * `memory_revisions` 经 FK CASCADE 一并抹掉——即「删一条记忆＝连它的整段变更历史一起
 * 消失」，且不经过任何审计路径。用户可见的删除语义是**软归档**
 * （`applyManualMemoryChange` 置 `enabled=0` + `lifecycle='archived'`），历史与版本都保留，
 * 因此没有任何合法调用方需要硬删除。
 *
 * 若将来确实需要「用户明确要求的永久清除」，应当新增一条**带审计**的清除路径（写一条
 * 终态 revision 后再删、并在审计里留下清除记录），而不是把这个原语放回来。
 * `__tests__/memory/memory-store-write-guard.test.ts` 会锁定它不得重新出现。
 */

export function getMemoryStats(userId: string): MemoryStats {
  const allRows = sqliteAll<MemoryRow>('SELECT * FROM memories WHERE user_id = ?', [userId]);

  const stats: MemoryStats = {
    total: allRows.length,
    enabled: 0,
    disabled: 0,
    byType: {
      preference: 0,
      fact: 0,
      instruction: 0,
      project_context: 0,
      learned_pattern: 0,
    },
    bySource: {
      manual: 0,
      auto_extracted: 0,
      api: 0,
    },
  };

  for (const row of allRows) {
    if (row.enabled === 1) {
      stats.enabled += 1;
    } else {
      stats.disabled += 1;
    }

    const memType = row.type as MemoryEntry['type'];
    if (memType in stats.byType) {
      stats.byType[memType] += 1;
    }

    const memSource = row.source as MemoryEntry['source'];
    if (memSource in stats.bySource) {
      stats.bySource[memSource] += 1;
    }
  }

  return stats;
}
export function hasExtractionLog(
  userId: string,
  sessionId: string,
  clientRequestId: string,
): boolean {
  const row = sqliteGet<{ id: number }>(
    'SELECT id FROM memory_extraction_logs WHERE user_id = ? AND session_id = ? AND client_request_id = ? LIMIT 1',
    [userId, sessionId, clientRequestId],
  );
  return row !== undefined;
}

/**
 * Retention for `memory_extraction_logs`. This table is a pure dedup /
 * idempotency log: one row per (user, session, clientRequestId) extraction
 * turn, read ONLY by the point-query `hasExtractionLog` and removed only by the
 * session-delete CASCADE. A `clientRequestId` is a one-time id for a single
 * streaming run, so a row older than a generous window can never be re-queried
 * (the run that owns it has long since completed), and the proposal store dedupes
 * at the proposal level regardless — the log is an optimization, not a
 * correctness guarantee. So old rows are safe to drop, bounding what is
 * otherwise an only-grows table on a long-lived account. Amortized: prune every
 * N inserts so write amplification is negligible.
 */
const DEFAULT_MEMORY_EXTRACTION_LOG_MAX_AGE_HOURS = 24 * 30;
export const MEMORY_EXTRACTION_LOG_PRUNE_CHECK_INTERVAL = 100;

let extractionLogRetentionHoursOverride: number | null = null;
let extractionLogPruneCheckInterval = MEMORY_EXTRACTION_LOG_PRUNE_CHECK_INTERVAL;
let extractionLogInsertsSincePrune = 0;
let extractionLogPruneDisabled = false;

function resolveExtractionLogMaxAgeHours(): number {
  if (extractionLogRetentionHoursOverride !== null) {
    return extractionLogRetentionHoursOverride;
  }
  const raw = globalThis.process?.env['OPENAWORK_MEMORY_EXTRACTION_LOG_MAX_AGE_HOURS'];
  if (raw === undefined || raw === null || raw.trim() === '') {
    return DEFAULT_MEMORY_EXTRACTION_LOG_MAX_AGE_HOURS;
  }
  const parsed = Number(raw);
  // Non-positive / NaN disables retention, matching the sibling stores' env
  // dead-switch semantics.
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  return Math.floor(parsed);
}

function pruneExtractionLogs(maxAgeHours: number): void {
  sqliteRun(`DELETE FROM memory_extraction_logs WHERE created_at < datetime('now', ?)`, [
    `-${maxAgeHours} hours`,
  ]);
}

function maybePruneExtractionLogs(): void {
  if (extractionLogPruneDisabled) {
    return;
  }
  const maxAgeHours = resolveExtractionLogMaxAgeHours();
  if (maxAgeHours <= 0) {
    // Retention disabled: reset the counter so re-enabling later doesn't
    // trigger one giant catch-up prune.
    extractionLogInsertsSincePrune = 0;
    return;
  }
  extractionLogInsertsSincePrune += 1;
  if (extractionLogInsertsSincePrune < extractionLogPruneCheckInterval) {
    return;
  }
  extractionLogInsertsSincePrune = 0;
  try {
    pruneExtractionLogs(maxAgeHours);
  } catch (error) {
    // A prune failure must never break extraction-log persistence or the
    // memory-extraction flow. Disable the prune path on DB corruption,
    // consistent with the sibling retention stores.
    if (isSqliteMalformedError(error)) {
      extractionLogPruneDisabled = true;
      return;
    }
    // Otherwise swallow — retention is best-effort.
  }
}

/** Test-only: override the extraction-log retention window (null clears it). */
export function __setMemoryExtractionLogRetentionForTesting(
  maxAgeHours: number | null,
  checkInterval?: number,
): void {
  extractionLogRetentionHoursOverride = maxAgeHours;
  extractionLogPruneCheckInterval =
    typeof checkInterval === 'number' && checkInterval > 0
      ? Math.floor(checkInterval)
      : MEMORY_EXTRACTION_LOG_PRUNE_CHECK_INTERVAL;
  extractionLogInsertsSincePrune = 0;
  extractionLogPruneDisabled = false;
}

export function insertExtractionLog(
  userId: string,
  sessionId: string,
  clientRequestId: string,
  extractedCount: number,
): void {
  sqliteRun(
    `INSERT OR IGNORE INTO memory_extraction_logs (user_id, session_id, client_request_id, extracted_count)
     VALUES (?, ?, ?, ?)`,
    [userId, sessionId, clientRequestId, extractedCount],
  );
  // Opportunistic retention: bound this only-grows dedup log on a long-lived
  // account. Old rows can never be re-queried (one-time clientRequestId).
  maybePruneExtractionLogs();
}
export function readMemorySettings(userId: string): MemorySettings {
  const row = sqliteGet<{ value: string }>(
    'SELECT value FROM user_settings WHERE user_id = ? AND key = ? LIMIT 1',
    [userId, MEMORY_SETTINGS_KEY],
  );

  if (!row) {
    return { ...DEFAULT_MEMORY_SETTINGS };
  }

  try {
    return parseMemorySettings(JSON.parse(row.value) as unknown);
  } catch (err) {
    logGatewayWarn(
      `[memory-store] 读取记忆设置失败，已回退默认设置：${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return { ...DEFAULT_MEMORY_SETTINGS };
  }
}

export function writeMemorySettings(userId: string, settings: MemorySettings): void {
  sqliteRun(
    `INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?)
     ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    [userId, MEMORY_SETTINGS_KEY, JSON.stringify(settings)],
  );
}
