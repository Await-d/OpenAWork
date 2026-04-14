import { randomUUID } from 'node:crypto';
import type {
  MemoryEntry,
  MemoryListFilter,
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
import { sqliteAll, sqliteGet, sqliteRun } from './db.js';

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
  enabled: number;
  created_at: string;
  updated_at: string;
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
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createMemory(userId: string, input: CreateMemoryInput): MemoryEntry {
  const id = randomUUID();
  const now = new Date().toISOString();
  sqliteRun(
    `INSERT INTO memories (id, user_id, type, key, value, source, confidence, priority, workspace_root, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
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
  if (filter.search !== undefined && filter.search.trim().length > 0) {
    conditions.push('(key LIKE ? OR value LIKE ?)');
    const searchPattern = `%${filter.search.trim()}%`;
    params.push(searchPattern, searchPattern);
  }

  const limit = filter.limit ?? 100;
  const offset = filter.offset ?? 0;

  const rows = sqliteAll<MemoryRow>(
    `SELECT * FROM memories WHERE ${conditions.join(' AND ')} ORDER BY priority DESC, confidence DESC, key ASC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  return rows.map(rowToMemoryEntry);
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
  if (input.priority !== undefined) {
    setClauses.push('priority = ?');
    params.push(input.priority);
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
}

export function upsertExtractedMemories(
  userId: string,
  candidates: ExtractedMemoryCandidate[],
  workspaceRoot: string | null = null,
): { created: number; updated: number; duplicates: number } {
  const existing = listMemories(userId, { enabled: true, limit: 1000 });
  const result = deduplicateMemories(candidates, existing);

  for (const candidate of result.toCreate) {
    createMemory(userId, {
      type: candidate.type,
      key: candidate.key,
      value: candidate.value,
      source: 'auto_extracted',
      confidence: candidate.confidence,
      priority: 30,
      workspaceRoot,
    });
  }

  for (const { existingId, candidate } of result.toUpdate) {
    updateMemory(userId, existingId, {
      value: candidate.value,
    });
  }

  return {
    created: result.toCreate.length,
    updated: result.toUpdate.length,
    duplicates: result.duplicates.length,
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
  } catch {
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
