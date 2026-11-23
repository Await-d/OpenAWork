import type { SessionFileDiffEntry } from '@openAwork/web-client';
import { summarizeSnapshotDiff } from '../shared/file-change-result.js';

/**
 * 完整文件快照（`before` / `after` 两侧都是**未瘦身**的全文）。
 *
 * 与 `FileChangeResultEntry` 的区别：那里的 `before` / `after` 可能是网关
 * `slimMessagesForRecovery` 截断后的前缀，这里的两个字段一定来自
 * `GET /sessions/:id/file-changes?includeText=true`（读 `session_file_diffs` + 备份文件，
 * 不做任何裁剪）。
 */
export interface CompleteFileSnapshot {
  after: string;
  before: string;
  additions: number;
  deletions: number;
}

/**
 * 在会话级文件变更投影里定位「某一条工具结果对应哪个文件」。
 *
 * 两侧的路径形态**不保证一致**：
 * - `fileDiffs[].file` 来自网关存储，通常是绝对路径
 *   （`/home/await/project/OpenAWork/apps/web/src/x.ts`）；
 * - 工具输出里的 `path` 可能是同一个绝对路径，也可能是工作区相对路径
 *   （`apps/web/src/x.ts` 甚至 `src/x.ts`）。
 *
 * 因此按三级降序匹配，**每一级都必须唯一命中**：
 * 1. 原始字符串精确相等；
 * 2. 归一化分隔符（`\` → `/`）后相等（Windows 路径 / 混合分隔符）；
 * 3. 一侧是另一侧的**路径段后缀**——必须以 `/<rest>` 结尾或整体相等。
 *    刻意不用裸 `endsWith`：那会让 `bar.ts` 命中 `foobar.ts`。
 *
 * 任何一级出现多个候选即视为**歧义**，返回 `undefined`——调用方必须给出
 * 「未能定位该文件的完整快照」而不是随手挑一个（挑错就会把 A 文件的完整内容
 * 画到 B 文件的 diff 上，比不加载更糟）。
 *
 * ## 同一文件被写入多次：按 `toolCallId` 消歧
 *
 * `session_file_diffs` 是**每次写入一行**（`ORDER BY created_at DESC`），所以同一会话里
 * 反复编辑同一个文件会得到多条同 `file` 的记录。实测本机数据：**37.4%** 的变更记录处于
 * 「同会话同文件多条」的组里（最多一组 10 条）——若只按路径匹配，这些场景会全部退化成
 * 「未能定位」，功能在真实使用中大面积失效。
 *
 * 因此匹配顺序是 **`toolCallId` 精确命中优先**，路径匹配只作为回退（`toolCallId` 缺失时，
 * 例如历史数据）。`session_file_diffs.tool_call_id` 实测 1941/1941 条全部有值，且
 * `includeText: true` 时后端原样返回该字段，所以主路径能真正消歧。
 *
 * 路径回退仍然要求**唯一命中**：多候选返回 `undefined`，绝不「取最新一条」——那会把
 * **另一次**写入的快照画到这张卡上，属于静默错误，比明确的失败更糟。
 */
export function matchFileDiff(
  fileDiffs: readonly SessionFileDiffEntry[],
  filePath: string,
  toolCallId?: string,
): SessionFileDiffEntry | undefined {
  const candidates = fileDiffs.filter(
    (diff) => typeof diff.file === 'string' && diff.file.trim().length > 0,
  );

  // ① 工具调用 id 是唯一标识：同一次写入的多条路径（move / 多文件）也能精确归位。
  const callId = toolCallId?.trim();
  if (callId) {
    const byCallId = candidates.filter((diff) => diff.toolCallId === callId);
    if (byCallId.length === 1) return byCallId[0];
    // 同一个 toolCallId 命中多个文件（多文件写入）：继续用路径在**这一批内**收敛，
    // 而不是退回全局路径匹配——那样会重新引入「别的写入」的快照。
    if (byCallId.length > 1) return matchByPath(byCallId, filePath);
  }

  return matchByPath(candidates, filePath);
}

/** 按路径三级降序匹配（调用方保证候选集已收敛）。 */
function matchByPath(
  candidates: readonly SessionFileDiffEntry[],
  filePath: string,
): SessionFileDiffEntry | undefined {
  const target = filePath.trim();
  if (target.length === 0) return undefined;

  const exact = candidates.filter((diff) => diff.file === target);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return undefined;

  const normalizedTarget = normalizeSeparators(target);
  const samePath = candidates.filter((diff) => normalizeSeparators(diff.file) === normalizedTarget);
  if (samePath.length === 1) return samePath[0];
  if (samePath.length > 1) return undefined;

  const suffixMatches = candidates.filter((diff) =>
    isPathSegmentSuffix(normalizeSeparators(diff.file), normalizedTarget),
  );
  return suffixMatches.length === 1 ? suffixMatches[0] : undefined;
}

/**
 * 把命中的变更条目转成可渲染的完整快照。
 *
 * - 两侧都缺失（网关没给文本）→ `undefined`，调用方报「完整内容不可用」；
 * - 单侧缺失按空文件处理：新增文件没有 `before`、删除文件没有 `after`，这是
 *   合法形态，不能当成「快照损坏」。
 * - 增删行数优先采信服务端统计（`session_file_diffs` 里就是全量口径），缺失时
 *   才按完整文本本地统计，保证 `+N/-M` 不会因为服务端字段缺失而空着。
 */
export function toCompleteSnapshot(entry: SessionFileDiffEntry): CompleteFileSnapshot | undefined {
  if (entry.before === undefined && entry.after === undefined) return undefined;
  const before = entry.before ?? '';
  const after = entry.after ?? '';
  const totals = summarizeSnapshotDiff(before, after);
  return {
    before,
    after,
    additions: readCount(entry.additions, totals.added),
    deletions: readCount(entry.deletions, totals.removed),
  };
}

function normalizeSeparators(value: string): string {
  return value.replaceAll('\\', '/');
}

/**
 * `left` 与 `right` 是否为「同一路径的不同粒度写法」。
 *
 * 必须落在路径段边界上：`a/b/c.ts` 与 `b/c.ts` 命中，`foobar.ts` 与 `bar.ts` 不命中。
 */
function isPathSegmentSuffix(left: string, right: string): boolean {
  if (left === right) return true;
  if (left.endsWith(`/${right}`)) return true;
  return right.endsWith(`/${left}`);
}

function readCount(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}
