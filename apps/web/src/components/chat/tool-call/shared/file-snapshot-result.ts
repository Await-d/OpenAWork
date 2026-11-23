import {
  isIncompleteFileSnapshot,
  parseJsonObjectTolerant,
  summarizeSnapshotDiff,
  type FileChangeResult,
  type FileChangeResultEntry,
} from './file-change-result.js';
import { findToolOutputTruncation, stripToolOutputTruncation } from '@openAwork/shared';

/**
 * 写入类工具（`write` / `edit` / `multi_edit` / ssh 同族）的输出是「整文件信封」：
 *
 *   { before, after, filediff, success, path | file, created, ... }
 *
 * 它**不符合** `parseFileChangeResult` 认的 `{ success, files[] }` 约定，所以此前会落到
 * `StructuredOutputPreview`，把 `before` / `after` 摊成两行字段预览——用户在展开的工具卡里
 * 看不到任何代码差异，只有七个字段。这里把这种信封转换成 `FileChangeResult`，
 * 让输出区与块级工具卡渲染同一套 diff。
 *
 * ## 截断处理（关键）
 *
 * 网关的 `slimMessagesForRecovery` 会按字节预算裁剪**每个字符串叶子**，并在末尾追加
 * `…[truncated, N chars omitted]`。于是刷新历史消息后，`before` / `after` 常常是
 * 「前 N 个字符 + 标记」——两侧都还在，只是都不完整。
 *
 * 旧实现把它等同于「快照不可用」直接放弃 diff，用户最终看到「内容已截断 · 省略 N 字符」
 * 加一坨原始 JSON。这里改为：**剥掉标记，用两侧的可用前缀继续画差异**，同时用
 * `incomplete` + `omittedChars` 如实标注「这不是完整对比」。
 *
 * 只有「一侧完全缺失」或「JSON 本身无法解析」时才返回 null，交回字段表渲染。
 */
export function buildFileSnapshotChangeResult(
  output: unknown,
  raw: unknown,
): FileChangeResult | null {
  const value = resolveEnvelopeRecord(output);
  if (!value) return null;
  return buildFromRecord(value, raw);
}

/**
 * 兼容两种输入形态：
 * - 已是对象（流式 / 直接传递）；
 * - 存储层序列化后的 JSON 字符串（刷新历史消息后的形态），用有界容错解析还原。
 *
 * 注意：**只有 JSON 结构本身损坏（补闭合也救不回来）时才放弃**。字符串内容被裁剪
 * 不影响结构，仍走下面的「可用前缀」路径。
 */
function resolveEnvelopeRecord(output: unknown): Record<string, unknown> | null {
  if (typeof output === 'string') {
    const decoded = parseJsonObjectTolerant(output);
    if (!decoded) return null;
    return isRecord(decoded.value) ? decoded.value : null;
  }
  return isRecord(output) ? output : null;
}

function buildFromRecord(record: Record<string, unknown>, raw: unknown): FileChangeResult | null {
  const before = readSnapshotText(record['before']);
  const after = readSnapshotText(record['after']);
  if (before === undefined || after === undefined) return null;

  const path = readPath(record);
  // 没有文件名的差异头只剩 `+N/-M`，对用户无意义；这种信封交回字段表。
  if (!path) return null;

  const truncated = readTruncation(record);
  const beforeText = stripToolOutputTruncation(before);
  const afterText = stripToolOutputTruncation(after);
  const hasComparableContent = beforeText.length > 0 || afterText.length > 0;

  // 标记存在但两侧剥离后都没内容：没有任何可画的东西，交回字段表。
  if (truncated.omittedChars > 0 && !hasComparableContent) return null;
  // 没有截断标记、却仍被 `isIncompleteFileSnapshot` 判为不完整（如 `status: 'partial'`）：
  // 尊重既有完整性语义，不接管——那种情况无法判断内容是否可信。
  if (truncated.omittedChars === 0 && isIncompleteFileSnapshot(record)) return null;

  const action = readAction(record, beforeText, afterText);
  const moveTo = readMoveTo(record, path);
  /*
   * 行数的口径分两种：
   *
   * 1. **完整快照**：按内容重新计算（不采信外部上报值）。
   * 2. **被瘦身过的快照**：按可用前缀算出来的是「部分差异」，甚至可能是 `+0/-0`——
   *    真实的改动常常落在截断点之后（实测一条 `before=13596 / after=15235` 的记录，
   *    前 8000 字符完全相同、改动全在后段，前缀 diff 得到 `+0/-0`，而真实是 `+115/-33`）。
   *    此时优先采信信封自报的 `filediff.additions/deletions`：它是**瘦身之前**算好的
   *    完整计数，就在同一份数据里。拿不到自报值时退回前缀计数，并如实标注 `incomplete`，
   *    绝不让「实际改了却显示 0」这种假象出现。
   */
  const prefixTotals = summarizeSnapshotDiff(beforeText, afterText);
  const reportedTotals = readReportedCounts(record);
  const useReported = truncated.omittedChars > 0 && reportedTotals !== undefined;
  const additions = useReported ? reportedTotals.additions : prefixTotals.added;
  const deletions = useReported ? reportedTotals.deletions : prefixTotals.removed;

  const entry: FileChangeResultEntry = {
    action,
    path,
    ...(moveTo ? { moveTo } : {}),
    before: beforeText,
    after: afterText,
    additions,
    deletions,
    incomplete: truncated.omittedChars > 0,
    ...(truncated.omittedChars > 0 ? { omittedChars: truncated.omittedChars } : {}),
  };

  return {
    success: record['success'] !== false,
    files: [entry],
    raw,
  };
}

/**
 * 统计信封里被省略的字符数。
 *
 * 只看 `before` / `after`：`filediff` 内是同一份快照的副本，重复计数会让「省略 N 字符」
 * 显示成两倍，反而误导。
 */
function readTruncation(record: Record<string, unknown>): { omittedChars: number } {
  let omittedChars = 0;
  for (const text of [record['before'], record['after']]) {
    if (typeof text !== 'string') continue;
    const found = findToolOutputTruncation(text);
    if (found) omittedChars += found.omittedChars;
  }
  return { omittedChars };
}

function readSnapshotText(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readPath(record: Record<string, unknown>): string | undefined {
  for (const key of ['path', 'filePath', 'file'] as const) {
    const value = record[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

/**
 * 动作优先采信信封自报字段，其次按快照内容推断：
 * 只有 `after` 有内容 → 新增；只有 `before` 有内容 → 删除；否则修改。
 */
function readAction(
  record: Record<string, unknown>,
  before: string,
  after: string,
): FileChangeResultEntry['action'] {
  if (record['created'] === true) return 'add';
  if (record['deleted'] === true) return 'delete';
  if (before.length === 0 && after.length > 0) return 'add';
  if (after.length === 0 && before.length > 0) return 'delete';
  return 'update';
}

function readMoveTo(record: Record<string, unknown>, path: string): string | undefined {
  for (const key of ['moveTo', 'to', 'newPath'] as const) {
    const value = record[key];
    if (typeof value === 'string' && value.trim() && value.trim() !== path) return value.trim();
  }
  return undefined;
}

/**
 * 采信信封自报的差异行数（`filediff.additions/deletions`，退化到顶层同名字段）。
 *
 * 这是**瘦身之前**算好的完整计数：`slimMessagesForRecovery` 只裁剪字符串叶子，
 * 数字字段原样保留。快照被截断时它是唯一还能反映真实改动量的来源。
 *
 * 两个数值必须同时存在且合法才采信——只拿到一半时宁可退回前缀计数，
 * 也不要拼出一个「+115 / -0」这种自相矛盾的统计。
 */
function readReportedCounts(
  record: Record<string, unknown>,
): { additions: number; deletions: number } | undefined {
  const candidates = [record['filediff'], record];
  for (const candidate of candidates) {
    if (!isRecord(candidate)) continue;
    const additions = readCount(candidate['additions']);
    const deletions = readCount(candidate['deletions']);
    if (additions !== undefined && deletions !== undefined) return { additions, deletions };
  }
  return undefined;
}

function readCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
