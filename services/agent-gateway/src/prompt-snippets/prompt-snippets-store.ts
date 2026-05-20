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
  input: { title?: string; content?: string; groupId?: string; order?: number },
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
