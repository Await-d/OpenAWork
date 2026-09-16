/**
 * 把控制台 / 网络里「有问题」的条目整理成给 composer 的 Markdown 摘要。
 *
 * 用户点一下就能把一屏错误甩给模型，不必逐条手动复制。这里只保留 error 日志、
 * 网络层失败（`network.errorMessage`）与 4xx/5xx 响应，并按消息去重、按条数
 * 截断，避免把上下文塞爆。纯函数 + 一个薄薄的发送包装，便于单测。
 */

import type { ConsoleEntry } from './browser-console-types.js';
import { insertTextIntoComposer } from './browser-clipboard.js';

const DEFAULT_MAX_ENTRIES = 30;
const DEFAULT_MAX_MESSAGE_CHARS = 2000;
const TRUNCATION_SUFFIX = '…';

export interface ErrorDigestOptions {
  url?: string | null;
  title?: string | null;
  maxEntries?: number;
  maxMessageChars?: number;
}

interface DigestProblem {
  level: string;
  message: string;
  timestamp: number;
}

/** 单个条目是否属于「问题」：error 日志、网络层失败、或 4xx/5xx 响应。 */
function isProblemEntry(entry: ConsoleEntry): boolean {
  if (entry.level === 'error') return true;
  if (entry.level !== 'network') return false;
  const network = entry.network;
  if (!network) return false;
  if (typeof network.errorMessage === 'string' && network.errorMessage.length > 0) return true;
  return typeof network.status === 'number' && network.status >= 400;
}

/** 取用于摘要展示的消息：网络条目在 message 为空时按结构化字段兜底。 */
function problemMessage(entry: ConsoleEntry): string {
  if (entry.level !== 'network' || !entry.network) return entry.message;
  if (entry.message.trim().length > 0) return entry.message;
  const { method, url, status, errorMessage } = entry.network;
  const call = `${(method || 'GET').toUpperCase()} ${url}`;
  if (errorMessage) return `${call} · ${errorMessage}`;
  return `${call} · 状态 ${status ?? 0}`;
}

/** 压平换行，保证每条问题恰好占一个 bullet 行。 */
function normalizeMessage(message: string): string {
  return message.replace(/\r?\n/g, ' ').trim();
}

/** 截断到 `maxChars` 个字符以内（含省略号）。 */
function truncateMessage(message: string, maxChars: number): string {
  if (maxChars <= 0) return '';
  if (message.length <= maxChars) return message;
  if (maxChars === 1) return TRUNCATION_SUFFIX;
  return `${message.slice(0, maxChars - 1)}${TRUNCATION_SUFFIX}`;
}

/** 过滤 → 去重 → 截断条数，得到最终要展示的问题列表。 */
function collectProblems(entries: ConsoleEntry[], opts: ErrorDigestOptions): DigestProblem[] {
  const maxEntries = opts.maxEntries ?? DEFAULT_MAX_ENTRIES;
  if (maxEntries <= 0) return [];
  const seen = new Set<string>();
  const problems: DigestProblem[] = [];
  for (const entry of entries) {
    if (!isProblemEntry(entry)) continue;
    const message = normalizeMessage(problemMessage(entry));
    if (seen.has(message)) continue;
    seen.add(message);
    problems.push({ level: entry.level, message, timestamp: entry.timestamp });
    if (problems.length >= maxEntries) break;
  }
  return problems;
}

function buildMarkdown(problems: DigestProblem[], opts: ErrorDigestOptions): string {
  const maxMessageChars = opts.maxMessageChars ?? DEFAULT_MAX_MESSAGE_CHARS;
  const lines: string[] = ['## 浏览器错误摘要', ''];

  const title = opts.title?.trim();
  const url = opts.url?.trim();
  if (title) lines.push(`- 页面标题：${title}`);
  if (url) lines.push(`- 页面地址：${url}`);
  lines.push(`- 问题数量：${problems.length}`);

  lines.push('', '### 问题明细', '');
  for (const problem of problems) {
    const time = new Date(problem.timestamp).toISOString();
    const message = truncateMessage(problem.message, maxMessageChars);
    lines.push(`- [${time}] [${problem.level}] ${message}`);
  }
  return lines.join('\n');
}

function composeDigest(
  entries: ConsoleEntry[],
  opts: ErrorDigestOptions,
): { markdown: string; count: number } {
  const problems = collectProblems(entries, opts);
  if (problems.length === 0) return { markdown: '', count: 0 };
  return { markdown: buildMarkdown(problems, opts), count: problems.length };
}

/**
 * 生成错误摘要 Markdown。
 *
 * @returns 含问题明细的 Markdown；没有任何问题时返回空字符串。
 */
export function buildErrorDigest(entries: ConsoleEntry[], opts: ErrorDigestOptions = {}): string {
  return composeDigest(entries, opts).markdown;
}

/**
 * 统计「有问题」的条目数（与摘要中列出的条数一致）。
 *
 * 复用同一套过滤 / 去重 / 截断逻辑，供工具栏按钮判断是否可点击、并展示角标。
 */
export function countErrorDigestProblems(
  entries: ConsoleEntry[],
  opts: ErrorDigestOptions = {},
): number {
  return collectProblems(entries, opts).length;
}

/**
 * 生成摘要并插入聊天输入框。
 *
 * @returns 实际包含的问题条数；为 0 时不派发任何事件。
 */
export function sendErrorDigestToComposer(
  entries: ConsoleEntry[],
  opts: ErrorDigestOptions = {},
): number {
  const { markdown, count } = composeDigest(entries, opts);
  if (count === 0) return 0;
  insertTextIntoComposer(markdown);
  return count;
}
