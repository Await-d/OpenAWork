import { randomUUID } from 'node:crypto';
import type {
  MemoryEntry,
  MemoryListFilter,
  MemoryRoleLayer,
  MemoryStats,
  CreateMemoryInput,
  UpdateMemoryInput,
  MemorySettings,
  ExtractedMemoryCandidate,
} from '@openAwork/agent-core';
import {
  DEFAULT_MEMORY_SETTINGS,
  MEMORY_SETTINGS_KEY,
  parseMemorySettings,
  deduplicateMemories,
} from '@openAwork/agent-core';
import { sqliteAll, sqliteGet, sqliteRun } from '../infra/db.js';
import { isSqliteMalformedError } from '../infra/sqlite-error-utils.js';
import { scanMemoryWriteContent } from './memory-security-scanner.js';

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
    console.warn(
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
    console.warn(
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

function rowToMemoryEntry(row: MemoryRow): MemoryEntry {
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createMemory(userId: string, input: CreateMemoryInput): MemoryEntry {
  const id = randomUUID();
  const now = new Date().toISOString();
  const roleLayers = normalizeMemoryRoleLayers(input.roleLayers);
  sqliteRun(
    `INSERT INTO memories (id, user_id, type, key, value, source, confidence, priority, workspace_root, team_workspace_id, role_layers_json, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
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
      now,
      now,
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
    enabled: true,
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

export function findEnabledMemoryByTypeAndKey(
  userId: string,
  type: MemoryEntry['type'],
  key: string,
): MemoryEntry | undefined {
  const row = sqliteGet<MemoryRow>(
    'SELECT * FROM memories WHERE user_id = ? AND type = ? AND key = ? AND enabled = 1 LIMIT 1',
    [userId, type, key],
  );
  return row ? rowToMemoryEntry(row) : undefined;
}

export function updateMemory(
  userId: string,
  memoryId: string,
  input: UpdateMemoryInput,
): MemoryEntry | undefined {
  const existing = getMemoryById(userId, memoryId);
  if (!existing) return undefined;

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

  params.push(memoryId, userId);
  sqliteRun(`UPDATE memories SET ${setClauses.join(', ')} WHERE id = ? AND user_id = ?`, params);

  return getMemoryById(userId, memoryId);
}

export function deleteMemory(userId: string, memoryId: string): boolean {
  const existing = getMemoryById(userId, memoryId);
  if (!existing) return false;
  sqliteRun('DELETE FROM memories WHERE id = ? AND user_id = ?', [memoryId, userId]);
  return true;
}

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

export function listEnabledMemoriesForInjection(
  userId: string,
  minConfidence: number,
): MemoryEntry[] {
  const rows = sqliteAll<MemoryRow>(
    'SELECT * FROM memories WHERE user_id = ? AND enabled = 1 AND confidence >= ? ORDER BY priority DESC, confidence DESC',
    [userId, minConfidence],
  );
  return rows.map(rowToMemoryEntry);
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
 * (the run that owns it has long since completed), and `upsertExtractedMemories`
 * dedupes at the memory level regardless — the log is an optimization, not a
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

export function upsertExtractedMemories(
  userId: string,
  candidates: ExtractedMemoryCandidate[],
  workspaceRoot: string | null = null,
): { created: number; updated: number; duplicates: number; blocked: number } {
  // 260515-team-phase-a · T-07：自动抽取也要过安全扫描，避免对话历史里
  // 出现的注入载荷 / 零宽字符通过自动抽取静默落库。命中威胁的候选项被
  // 直接丢弃，由调用方通过返回值 blocked 计数感知。
  const safeCandidates: ExtractedMemoryCandidate[] = [];
  let blocked = 0;
  for (const candidate of candidates) {
    const scanKey = scanMemoryWriteContent(candidate.key);
    const scanValue = scanMemoryWriteContent(candidate.value);
    if (!scanKey.ok || !scanValue.ok) {
      blocked += 1;
      continue;
    }
    safeCandidates.push(candidate);
  }

  const existing = listMemories(userId, { enabled: true, limit: 1000 });
  const result = deduplicateMemories(safeCandidates, existing);

  // Per-candidate resilience: each createMemory / updateMemory is an
  // unguarded SQLite write. Without isolation one row throwing (DB lock /
  // disk error / constraint) would abort the remaining candidates AND — since
  // the counts below were derived from the PLANNED arrays — report writes that
  // never happened. Isolate per candidate, count only actual successes, and
  // warn on failures so a single bad row neither starves the rest nor inflates
  // the result. (§0.94/§0.103 single-point-failure-isolation class.)
  let created = 0;
  for (const candidate of result.toCreate) {
    try {
      createMemory(userId, {
        type: candidate.type,
        key: candidate.key,
        value: candidate.value,
        source: 'auto_extracted',
        confidence: candidate.confidence,
        priority: 30,
        workspaceRoot,
      });
      created += 1;
    } catch (err) {
      console.warn(
        `[memory-store] 自动抽取记忆写入失败，已跳过该条：${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  let updated = 0;
  for (const { existingId, candidate } of result.toUpdate) {
    try {
      updateMemory(userId, existingId, {
        value: candidate.value,
      });
      updated += 1;
    } catch (err) {
      console.warn(
        `[memory-store] 自动抽取记忆更新失败，已跳过该条：${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  return {
    created,
    updated,
    duplicates: result.duplicates.length,
    blocked,
  };
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
    console.warn(
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
