import { sqliteGet, sqliteRun } from '../infra/db.js';

const leadCn = /^(请帮我|请|帮我|麻烦你|麻烦|我想|我想要|我需要|需要你|帮忙)/;
const tailCn = /(的问题|这个问题|一下|一下子|吧)$/;
const leadEn =
  /^(please|can you|could you|would you|help me|i need to|need to|let's|lets|show me)\s+/i;
const drop = new Set(['a', 'an', 'the', 'my', 'this', 'that']);
const cjk = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/;

function split(text: string) {
  if (typeof Intl.Segmenter !== 'function') return Array.from(text);
  const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  return Array.from(seg.segment(text), (item) => item.segment);
}

function cut(text: string, len: number) {
  const items = split(text);
  if (items.length <= len) return text;
  return items.slice(0, len).join('');
}

function first(text: string) {
  return (
    text
      .split(/\r?\n/)
      .map((item) => item.trim())
      .find((item) => item.length > 0) ?? ''
  );
}

function unwrap(text: string) {
  const head = text[0];
  const tail = text.at(-1);
  if (!head || !tail) return text;
  if (head !== tail) return text;
  if (!['"', "'", '`', '“', '”'].includes(head)) return text;
  return text.slice(1, -1).trim();
}

function compactCn(text: string) {
  const next = text.replace(leadCn, '').replace(tailCn, '').replace(/\s+/g, '');
  return cut(next || text.replace(/\s+/g, ''), 12);
}

function capitalize(text: string) {
  const head = text.slice(0, 1);
  if (!head) return text;
  return head.toUpperCase() + text.slice(1);
}

function compactEn(text: string) {
  const clean = text
    .replace(leadEn, '')
    .replace(/[^A-Za-z0-9\s._:/-]+/g, ' ')
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .filter((item) => !drop.has(item.toLowerCase()))
    .slice(0, 4)
    .join(' ');
  return cut(capitalize(clean || text.trim()), 12);
}

export function buildSessionTitle(text: string): string | null {
  const line = unwrap(first(text)).replace(/\s+/g, ' ').trim();
  if (!line) return null;
  return cjk.test(line) ? compactCn(line) : compactEn(line);
}

/** 会话标题最大长度，与 `PATCH /sessions/:sessionId` 的 title 校验保持一致。 */
export const SESSION_TITLE_MAX_LENGTH = 200;

export interface RenameSessionTitleInput {
  sessionId: string;
  userId: string;
  title: string;
  /**
   * 元数据同时变更时与标题合并为同一条 UPDATE，避免两次写；不传则仅更新标题。
   */
  metadataJson?: string | null;
}

export type RenameSessionTitleResult = { ok: true; title: string } | { ok: false; error: string };

/** 目标会话是否存在且归属该用户。 */
export function sessionExistsForUser(sessionId: string, userId: string): boolean {
  return (
    sqliteGet<{ id: string }>('SELECT id FROM sessions WHERE id = ? AND user_id = ? LIMIT 1', [
      sessionId,
      userId,
    ]) !== undefined
  );
}

/**
 * 更新会话标题（按传入值原样写入，仅做非空与长度防御性校验）。
 *
 * trim 由调用方负责：`session_rename` 工具会先 trim 再传入，而
 * `PATCH /sessions/:sessionId` 路由保持既有「原样存储」行为——
 * 抽取共享函数不得改变路由的字节级语义。
 */
export function renameSessionTitle(input: RenameSessionTitleInput): RenameSessionTitleResult {
  const title = input.title;
  if (title.length === 0) {
    return { ok: false, error: '会话标题不能为空。' };
  }
  if (title.length > SESSION_TITLE_MAX_LENGTH) {
    return { ok: false, error: `会话标题过长，最多 ${SESSION_TITLE_MAX_LENGTH} 个字符。` };
  }

  if (input.metadataJson != null) {
    sqliteRun(
      "UPDATE sessions SET title = ?, metadata_json = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
      [title, input.metadataJson, input.sessionId, input.userId],
    );
  } else {
    sqliteRun(
      "UPDATE sessions SET title = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
      [title, input.sessionId, input.userId],
    );
  }

  return { ok: true, title };
}

export function maybeAutoTitle(input: { sessionId: string; userId: string; text: string }) {
  const title = buildSessionTitle(input.text);
  if (!title) return;

  const count =
    sqliteGet<{ count: number }>(
      "SELECT COUNT(1) AS count FROM message_v2 WHERE session_id = ? AND user_id = ? AND json_extract(data, '$.role') = 'user'",
      [input.sessionId, input.userId],
    )?.count ?? 0;
  if (count !== 1) return;

  sqliteRun(
    "UPDATE sessions SET title = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ? AND COALESCE(TRIM(title), '') = ''",
    [title, input.sessionId, input.userId],
  );
}
