import { sqliteGet, sqliteRun } from './db.js';

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
  return cut(next || text.replace(/\s+/g, ''), 7);
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
  return cut(capitalize(clean || text.trim()), 32);
}

export function buildSessionTitle(text: string): string | null {
  const line = unwrap(first(text)).replace(/\s+/g, ' ').trim();
  if (!line) return null;
  return cjk.test(line) ? compactCn(line) : compactEn(line);
}

export function maybeAutoTitle(input: { sessionId: string; userId: string; text: string }) {
  const title = buildSessionTitle(input.text);
  if (!title) return;

  const count =
    sqliteGet<{ count: number }>(
      'SELECT COUNT(1) AS count FROM session_messages WHERE session_id = ? AND user_id = ? AND role = ?',
      [input.sessionId, input.userId, 'user'],
    )?.count ?? 0;
  if (count !== 1) return;

  sqliteRun(
    "UPDATE sessions SET title = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ? AND COALESCE(TRIM(title), '') = ''",
    [title, input.sessionId, input.userId],
  );
}
