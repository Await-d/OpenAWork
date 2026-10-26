/**
 * 会话类工具文本输出的解析（纯函数）。
 *
 * `session_list` / `session_info` 的网关返回是**给人看的文本**（Markdown 表格 /
 * `Key: Value` 多行），模型消费友好，但前端直接铺出来就是一片管道符。这里把文本
 * 还原成结构化视图模型，交给卡片渲染；解析失败时返回 `null` 让调用方回退文本。
 */

import type { SessionLike } from '../previews/task-session-preview.js';

const NO_SESSIONS = /^No sessions found\.?$/i;

/** 单行 Markdown 表格拆分：去掉首尾空段，保留中间含空字段的列。 */
function splitTableRow(line: string): string[] {
  const cells = line.split('|');
  // 首尾各有一个空串（`| a | b |` → ['', 'a', 'b', '']）。
  if (cells.length >= 2 && cells[0]?.trim() === '') cells.shift();
  if (cells.length >= 1 && cells[cells.length - 1]?.trim() === '') cells.pop();
  return cells.map((cell) => cell.trim());
}

function isSeparatorRow(line: string): boolean {
  return /^\|[\s:|-]+\|$/.test(line.trim()) && line.includes('-');
}

/**
 * 解析 `session_list` 的 Markdown 表格。
 *
 * 标题里可能含 `|`（`truncateText` 不会转义），所以第 6 列之后的内容会重新拼回标题，
 * 而不是丢弃 —— 宁可标题多一个管道符，也不要吞掉用户可见的文字。
 */
export function parseSessionListTable(output: unknown): SessionLike[] | null {
  if (typeof output !== 'string') return null;
  const trimmed = output.trim();
  if (trimmed.length === 0) return null;
  if (NO_SESSIONS.test(trimmed)) return [];

  const lines = trimmed.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => line.trim().startsWith('| Session ID |'));
  if (headerIndex < 0) return null;

  const sessions: SessionLike[] = [];
  for (let i = headerIndex + 1; i < lines.length; i++) {
    const line = lines[i]?.trim() ?? '';
    if (line.length === 0) continue;
    if (!line.startsWith('|')) continue;
    if (isSeparatorRow(line)) continue;

    const cells = splitTableRow(line);
    if (cells.length < 6) continue;

    const [id, messages, first, last, status, ...rest] = cells;
    const title = rest.join(' | ').trim();
    const messageCount = Number.parseInt(messages ?? '', 10);

    sessions.push({
      ...(id ? { id } : {}),
      ...(title.length > 0 ? { name: title } : {}),
      ...(status ? { status } : {}),
      ...(first ? { createdAt: first } : {}),
      ...(last ? { lastActivity: last } : {}),
      ...(Number.isFinite(messageCount) ? { messageCount } : {}),
    });
  }

  return sessions.length > 0 ? sessions : null;
}

export interface SessionInfoView {
  sessionId: string;
  status?: string;
  messageCount?: number;
  dateRange?: string;
  todos?: string;
  fileDiffs?: string;
  snapshots?: string;
  parentSession?: string;
  children?: string;
  /** 未显式建模的字段，按原顺序保留（不丢信息）。 */
  extra: Array<[string, string]>;
}

/** 已单独建模的字段（避免在「更多」里重复）。 */
const MODELED_KEYS: ReadonlySet<string> = new Set([
  'Session ID',
  'Messages',
  'Date Range',
  'Status',
  'Has Todos',
  'File Diffs',
  'Snapshots',
  'Parent Session',
  'Children',
]);

/**
 * 解析 `session_info` 的 `Key: Value` 文本。
 *
 * 只认首个 `: ` 作为分隔（值里可能含冒号，如 `Latest Snapshot: ...`）；缺少
 * `Session ID` 视为不是详情输出，返回 null。
 */
export function parseSessionInfoText(output: unknown): SessionInfoView | null {
  if (typeof output !== 'string') return null;
  const trimmed = output.trim();
  if (trimmed.length === 0) return null;

  const entries: Array<[string, string]> = [];
  for (const rawLine of trimmed.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    const separator = line.indexOf(': ');
    if (separator <= 0) continue;
    entries.push([line.slice(0, separator).trim(), line.slice(separator + 2).trim()]);
  }

  const map = new Map(entries);
  const sessionId = map.get('Session ID') ?? '';
  if (sessionId.length === 0) return null;

  const messageCount = Number.parseInt(map.get('Messages') ?? '', 10);
  const extra = entries.filter(([key]) => !MODELED_KEYS.has(key));
  // 网关用字面量 `None` 表示「没有父会话」，卡片上显示 `None` 只会制造噪音。
  const parentSession = map.get('Parent Session');
  const hasParent =
    parentSession !== undefined && parentSession.length > 0 && parentSession !== 'None';

  return {
    sessionId,
    ...(map.get('Status') ? { status: map.get('Status') } : {}),
    ...(Number.isFinite(messageCount) ? { messageCount } : {}),
    ...(map.get('Date Range') ? { dateRange: map.get('Date Range') } : {}),
    ...(map.get('Has Todos') ? { todos: map.get('Has Todos') } : {}),
    ...(map.get('File Diffs') ? { fileDiffs: map.get('File Diffs') } : {}),
    ...(map.get('Snapshots') ? { snapshots: map.get('Snapshots') } : {}),
    ...(hasParent && parentSession ? { parentSession } : {}),
    ...(map.get('Children') ? { children: map.get('Children') } : {}),
    extra,
  };
}
