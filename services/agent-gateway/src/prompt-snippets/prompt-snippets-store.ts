/**
 * 快捷提示词存储层 — SQLite CRUD。
 *
 * 数据模型：
 * - prompt_snippet_groups: 分组（用户级）
 * - prompt_snippets: 提示词条目（属于某个分组）
 */

import { randomUUID } from 'node:crypto';
import { db } from '../infra/db.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PromptSnippetGroup {
  id: string;
  userId: string;
  name: string;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface PromptSnippet {
  id: string;
  userId: string;
  groupId: string;
  title: string;
  content: string;
  order: number;
  createdAt: string;
  updatedAt: string;
}

/** 提示词内容版本（资产化沉淀：每次内容变更自动留痕，可回滚）。 */
export interface PromptSnippetVersion {
  id: string;
  snippetId: string;
  userId: string;
  /** 版本号（同一 snippet 内单调递增，从 1 开始）。 */
  version: number;
  title: string;
  content: string;
  /** 创建来源：'created' = 首次创建；'updated' = 内容更新；'restored' = 回滚到历史版本。 */
  source: 'created' | 'updated' | 'restored';
  createdAt: string;
}

// ─── Migration ──────────────────────────────────────────────────────────────

export function migratePromptSnippetsTables(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS prompt_snippet_groups (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_prompt_snippet_groups_user ON prompt_snippet_groups(user_id, sort_order)',
  );

  db.exec(`
    CREATE TABLE IF NOT EXISTS prompt_snippets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      group_id TEXT NOT NULL REFERENCES prompt_snippet_groups(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_prompt_snippets_user_group ON prompt_snippets(user_id, group_id, sort_order)',
  );

  db.exec(`
    CREATE TABLE IF NOT EXISTS prompt_snippet_versions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      snippet_id TEXT NOT NULL REFERENCES prompt_snippets(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      source TEXT NOT NULL CHECK(source IN ('created', 'updated', 'restored')) DEFAULT 'created',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(snippet_id, version)
    )
  `);
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_prompt_snippet_versions_snippet ON prompt_snippet_versions(snippet_id, version DESC)',
  );
}

// ─── Group CRUD ─────────────────────────────────────────────────────────────

export function listGroups(userId: string): PromptSnippetGroup[] {
  const rows = db
    .prepare(
      'SELECT id, user_id, name, sort_order, created_at, updated_at FROM prompt_snippet_groups WHERE user_id = ? ORDER BY sort_order ASC, created_at ASC',
    )
    .all(userId) as Array<{
    id: string;
    user_id: string;
    name: string;
    sort_order: number;
    created_at: string;
    updated_at: string;
  }>;

  return rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    name: r.name,
    order: r.sort_order,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export function createGroup(
  userId: string,
  input: { name: string; order?: number },
): PromptSnippetGroup {
  const id = randomUUID();
  const order = input.order ?? 0;
  db.prepare(
    'INSERT INTO prompt_snippet_groups (id, user_id, name, sort_order) VALUES (?, ?, ?, ?)',
  ).run(id, userId, input.name, order);

  const row = db
    .prepare(
      'SELECT id, user_id, name, sort_order, created_at, updated_at FROM prompt_snippet_groups WHERE id = ?',
    )
    .get(id) as {
    id: string;
    user_id: string;
    name: string;
    sort_order: number;
    created_at: string;
    updated_at: string;
  };

  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    order: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function hasPromptSnippetGroup(userId: string, groupId: string): boolean {
  const existing = db
    .prepare('SELECT id FROM prompt_snippet_groups WHERE id = ? AND user_id = ?')
    .get(groupId, userId) as { id: string } | undefined;

  return Boolean(existing?.id);
}

/** 校验条目属于当前用户（版本端点 404 语义用）。 */
export function hasPromptSnippet(userId: string, snippetId: string): boolean {
  const existing = db
    .prepare('SELECT id FROM prompt_snippets WHERE id = ? AND user_id = ?')
    .get(snippetId, userId) as { id: string } | undefined;

  return Boolean(existing?.id);
}

export function updateGroup(
  userId: string,
  groupId: string,
  input: { name?: string; order?: number },
): PromptSnippetGroup | null {
  const existing = db
    .prepare('SELECT id FROM prompt_snippet_groups WHERE id = ? AND user_id = ?')
    .get(groupId, userId) as { id: string } | undefined;

  if (!existing) return null;

  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.name !== undefined) {
    sets.push('name = ?');
    params.push(input.name);
  }
  if (input.order !== undefined) {
    sets.push('sort_order = ?');
    params.push(input.order);
  }

  if (sets.length === 0) {
    // Nothing to update, return current
    const row = db
      .prepare(
        'SELECT id, user_id, name, sort_order, created_at, updated_at FROM prompt_snippet_groups WHERE id = ?',
      )
      .get(groupId) as {
      id: string;
      user_id: string;
      name: string;
      sort_order: number;
      created_at: string;
      updated_at: string;
    };
    return {
      id: row.id,
      userId: row.user_id,
      name: row.name,
      order: row.sort_order,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  sets.push("updated_at = datetime('now')");
  params.push(groupId, userId);

  db.prepare(
    `UPDATE prompt_snippet_groups SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`,
  ).run(...params);

  const row = db
    .prepare(
      'SELECT id, user_id, name, sort_order, created_at, updated_at FROM prompt_snippet_groups WHERE id = ?',
    )
    .get(groupId) as {
    id: string;
    user_id: string;
    name: string;
    sort_order: number;
    created_at: string;
    updated_at: string;
  };

  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    order: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function deleteGroup(userId: string, groupId: string): boolean {
  const existing = db
    .prepare('SELECT id FROM prompt_snippet_groups WHERE id = ? AND user_id = ?')
    .get(groupId, userId) as { id: string } | undefined;

  if (!existing) return false;

  db.prepare('DELETE FROM prompt_snippet_groups WHERE id = ? AND user_id = ?').run(groupId, userId);
  return true;
}

// ─── Snippet CRUD ───────────────────────────────────────────────────────────

export function listSnippets(userId: string, groupId?: string): PromptSnippet[] {
  let sql =
    'SELECT id, user_id, group_id, title, content, sort_order, created_at, updated_at FROM prompt_snippets WHERE user_id = ?';
  const params: unknown[] = [userId];

  if (groupId) {
    sql += ' AND group_id = ?';
    params.push(groupId);
  }

  sql += ' ORDER BY sort_order ASC, created_at ASC';

  const rows = db.prepare(sql).all(...params) as Array<{
    id: string;
    user_id: string;
    group_id: string;
    title: string;
    content: string;
    sort_order: number;
    created_at: string;
    updated_at: string;
  }>;

  return rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    groupId: r.group_id,
    title: r.title,
    content: r.content,
    order: r.sort_order,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export function createSnippet(
  userId: string,
  input: { groupId: string; title: string; content: string; order?: number },
): PromptSnippet {
  const id = randomUUID();
  const order = input.order ?? 0;
  db.prepare(
    'INSERT INTO prompt_snippets (id, user_id, group_id, title, content, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(id, userId, input.groupId, input.title, input.content, order);

  recordSnippetVersion(userId, id, input.title, input.content, 'created');

  const row = db
    .prepare(
      'SELECT id, user_id, group_id, title, content, sort_order, created_at, updated_at FROM prompt_snippets WHERE id = ?',
    )
    .get(id) as {
    id: string;
    user_id: string;
    group_id: string;
    title: string;
    content: string;
    sort_order: number;
    created_at: string;
    updated_at: string;
  };

  return {
    id: row.id,
    userId: row.user_id,
    groupId: row.group_id,
    title: row.title,
    content: row.content,
    order: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function updateSnippet(
  userId: string,
  snippetId: string,
  input: { title?: string; content?: string; groupId?: string; order?: number; source?: 'updated' | 'restored' },
): PromptSnippet | null {
  const existing = db
    .prepare('SELECT id FROM prompt_snippets WHERE id = ? AND user_id = ?')
    .get(snippetId, userId) as { id: string } | undefined;

  if (!existing) return null;

  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.title !== undefined) {
    sets.push('title = ?');
    params.push(input.title);
  }
  if (input.content !== undefined) {
    sets.push('content = ?');
    params.push(input.content);
  }
  if (input.groupId !== undefined) {
    sets.push('group_id = ?');
    params.push(input.groupId);
  }
  if (input.order !== undefined) {
    sets.push('sort_order = ?');
    params.push(input.order);
  }

  if (sets.length === 0) {
    const row = db
      .prepare(
        'SELECT id, user_id, group_id, title, content, sort_order, created_at, updated_at FROM prompt_snippets WHERE id = ?',
      )
      .get(snippetId) as {
      id: string;
      user_id: string;
      group_id: string;
      title: string;
      content: string;
      sort_order: number;
      created_at: string;
      updated_at: string;
    };
    return {
      id: row.id,
      userId: row.user_id,
      groupId: row.group_id,
      title: row.title,
      content: row.content,
      order: row.sort_order,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  sets.push("updated_at = datetime('now')");
  params.push(snippetId, userId);

  db.prepare(`UPDATE prompt_snippets SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`).run(
    ...params,
  );

  // 仅当内容（title/content）真正变更时留痕，避免仅调整分组/顺序或内容不变也产生版本噪音。
  const hadContentChange = input.title !== undefined || input.content !== undefined;
  if (hadContentChange) {
    const after = db
      .prepare(
        'SELECT title, content FROM prompt_snippets WHERE id = ? AND user_id = ?',
      )
      .get(snippetId, userId) as { title: string; content: string };
    const before = db
      .prepare(
        `SELECT title, content FROM prompt_snippet_versions
         WHERE snippet_id = ? ORDER BY version DESC LIMIT 1`,
      )
      .get(snippetId) as { title: string; content: string } | undefined;
    const changed = !before || before.title !== after.title || before.content !== after.content;
    if (changed) {
      recordSnippetVersion(userId, snippetId, after.title, after.content, input.source ?? 'updated');
    }
  }

  const row = db
    .prepare(
      'SELECT id, user_id, group_id, title, content, sort_order, created_at, updated_at FROM prompt_snippets WHERE id = ?',
    )
    .get(snippetId) as {
    id: string;
    user_id: string;
    group_id: string;
    title: string;
    content: string;
    sort_order: number;
    created_at: string;
    updated_at: string;
  };

  return {
    id: row.id,
    userId: row.user_id,
    groupId: row.group_id,
    title: row.title,
    content: row.content,
    order: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function deleteSnippet(userId: string, snippetId: string): boolean {
  const existing = db
    .prepare('SELECT id FROM prompt_snippets WHERE id = ? AND user_id = ?')
    .get(snippetId, userId) as { id: string } | undefined;

  if (!existing) return false;

  db.prepare('DELETE FROM prompt_snippets WHERE id = ? AND user_id = ?').run(snippetId, userId);
  return true;
}

// ─── 版本历史 ──────────────────────────────────────────────────────────────

function nextSnippetVersion(snippetId: string): number {
  const row = db
    .prepare(
      'SELECT COALESCE(MAX(version), 0) AS max_version FROM prompt_snippet_versions WHERE snippet_id = ?',
    )
    .get(snippetId) as { max_version: number };
  return row.max_version + 1;
}

/** 记录一条版本；同一 snippet 内版本单调递增。 */
function recordSnippetVersion(
  userId: string,
  snippetId: string,
  title: string,
  content: string,
  source: 'created' | 'updated' | 'restored',
): void {
  const version = nextSnippetVersion(snippetId);
  db.prepare(
    `INSERT INTO prompt_snippet_versions (id, user_id, snippet_id, version, title, content, source)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(randomUUID(), userId, snippetId, version, title, content, source);
}

/** 列出某条目的全部版本（新→旧）。条目不存在或跨用户访问返回空数组。 */
export function listSnippetVersions(
  userId: string,
  snippetId: string,
): PromptSnippetVersion[] {
  const owned = db
    .prepare('SELECT id FROM prompt_snippets WHERE id = ? AND user_id = ?')
    .get(snippetId, userId) as { id: string } | undefined;
  if (!owned) {
    return [];
  }

  const rows = db
    .prepare(
      `SELECT id, user_id, snippet_id, version, title, content, source, created_at
       FROM prompt_snippet_versions
       WHERE user_id = ? AND snippet_id = ?
       ORDER BY version DESC`,
    )
    .all(userId, snippetId) as Array<{
    id: string;
    user_id: string;
    snippet_id: string;
    version: number;
    title: string;
    content: string;
    source: 'created' | 'updated' | 'restored';
    created_at: string;
  }>;

  return rows.map((r) => ({
    id: r.id,
    snippetId: r.snippet_id,
    userId: r.user_id,
    version: r.version,
    title: r.title,
    content: r.content,
    source: r.source,
    createdAt: r.created_at,
  }));
}

/**
 * 回滚到指定版本：把该版本内容写回条目（source='restored' 留痕为新版本）。
 * 条目或版本不存在 / 跨用户访问时返回 null。
 */
export function restoreSnippetVersion(
  userId: string,
  snippetId: string,
  version: number,
): PromptSnippet | null {
  const owned = db
    .prepare('SELECT id FROM prompt_snippets WHERE id = ? AND user_id = ?')
    .get(snippetId, userId) as { id: string } | undefined;
  if (!owned) {
    return null;
  }

  const target = db
    .prepare(
      `SELECT title, content FROM prompt_snippet_versions
       WHERE user_id = ? AND snippet_id = ? AND version = ?`,
    )
    .get(userId, snippetId, version) as { title: string; content: string } | undefined;
  if (!target) {
    return null;
  }

  return updateSnippet(userId, snippetId, {
    title: target.title,
    content: target.content,
    source: 'restored',
  });
}
