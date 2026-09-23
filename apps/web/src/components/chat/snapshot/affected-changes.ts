/**
 * affected-changes · 回退 / 重试「受影响范围」的文件变更检测（纯逻辑）
 *
 * 检测三信号并合并，供 `useSnapshotAwareAction` 决定「是否必须弹选择框」：
 *   1. 消息 trace（`modifiedFilesSummary.files`）——零网络，用于识别「有变更但快照不可用」；
 *   2. `snapshot_trees`（shadow git）——决定文件可恢复性；
 *   3. 按 request 的文件变更投影（`session_file_diffs`）——权威文件清单与统计。
 *
 * 判定口径（产品确认）：仅当检测到变更（文件 > 0 或 快照 > 0）时才弹窗；无变更静默继续。
 * 例外：任一信号源失败时**不得**把「读取失败」当成「没有变更」——此时
 * `detectionIncomplete = true`，调用方必须把它升级为「让用户选择」（弹窗、隐藏恢复
 * 并展示原因），而不是静默放行。
 */

import type { FileChangeSourceKind } from '@openAwork/shared';
import type {
  SessionFileDiffEntry,
  SnapshotTreeEntry,
  SnapshotTreeFileEntry,
} from '@openAwork/web-client';
import type { ChatMessage } from '../../conversation-runtime/messages/support.js';
import { readAssistantTracePayload } from '../../conversation-runtime/messages/support.js';

// ─── 类型 ──────────────────────────────────────────────────────────────

export interface AffectedFileEntry {
  readonly file: string;
  readonly status?: 'added' | 'deleted' | 'modified';
  readonly additions: number;
  readonly deletions: number;
  readonly requestId?: string;
  readonly sourceKind?: FileChangeSourceKind;
}

export interface AffectedChangeSummary {
  readonly fileCount: number;
  readonly totalAdditions: number;
  readonly totalDeletions: number;
  readonly requestIds: readonly string[];
}

export interface AffectedChangeDetection {
  /** 是否检测到任何文件变更（决定是否必须弹窗）。 */
  readonly changesDetected: boolean;
  /** 是否存在失败的检测信号（网络 / 快照读取失败）。 */
  readonly detectionIncomplete: boolean;
  readonly files: readonly AffectedFileEntry[];
  readonly snapshots: readonly SnapshotTreeEntry[];
  readonly summary: AffectedChangeSummary;
}

// ─── 时间与快照排序 ────────────────────────────────────────────────────

/**
 * SQLite `datetime('now')` 的输出形态：UTC、秒级、空格分隔、无时区后缀。
 * `snapshot_trees.created_at` 就是这种格式。
 */
const SQLITE_UTC_DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/;

export function toTimestamp(value: string | number | undefined): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    // `Date.parse('2026-07-15 10:05:00')` 在 V8 中按**本地时区**解释，而
    // `snapshot_trees.created_at` 来自 SQLite `datetime('now')`（UTC）。
    // 非 UTC 时区下会整体偏移一个时区，导致受影响快照判定与恢复基线错位。
    const normalized = SQLITE_UTC_DATETIME_PATTERN.test(value)
      ? `${value.replace(' ', 'T')}Z`
      : value;
    const parsed = Date.parse(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function sortSnapshotsByCreatedAt(input: {
  snapshots: readonly SnapshotTreeEntry[];
  originalOrder: readonly SnapshotTreeEntry[];
  requestOrderById?: ReadonlyMap<string, number>;
  /**
   * 输入列表的网关排序方向：
   *  - request-scoped 列表 = `ORDER BY created_at ASC, id ASC`；
   *  - session-scoped 列表 = `ORDER BY created_at DESC, id DESC`。
   *
   * `created_at` 只有**秒级**精度，同一回合的多个 step 快照经常落在同一秒；
   * 并列时必须按输入方向取「更早」的那个，否则恢复基线会取到更晚的快照
   * （更早步骤的文件改动不会被回滚）。
   */
  inputOrder: 'asc' | 'desc';
}): readonly SnapshotTreeEntry[] {
  const originalIndexByTreeHash = new Map(
    input.originalOrder.map((snapshot, index) => [snapshot.treeHash, index] as const),
  );
  return [...input.snapshots].sort((left, right) => {
    const leftTimestamp = toTimestamp(left.createdAt);
    const rightTimestamp = toTimestamp(right.createdAt);
    if (leftTimestamp !== null && rightTimestamp !== null && leftTimestamp !== rightTimestamp) {
      return leftTimestamp - rightTimestamp;
    }
    const leftRequestOrder =
      typeof left.clientRequestId === 'string'
        ? input.requestOrderById?.get(left.clientRequestId)
        : undefined;
    const rightRequestOrder =
      typeof right.clientRequestId === 'string'
        ? input.requestOrderById?.get(right.clientRequestId)
        : undefined;
    if (leftRequestOrder !== undefined || rightRequestOrder !== undefined) {
      if (leftRequestOrder === undefined) {
        return 1;
      }
      if (rightRequestOrder === undefined) {
        return -1;
      }
      if (leftRequestOrder !== rightRequestOrder) {
        return leftRequestOrder - rightRequestOrder;
      }
    }
    const leftIndex = originalIndexByTreeHash.get(left.treeHash) ?? 0;
    const rightIndex = originalIndexByTreeHash.get(right.treeHash) ?? 0;
    return input.inputOrder === 'asc' ? leftIndex - rightIndex : rightIndex - leftIndex;
  });
}

export function dedupeSnapshotsByTreeHash(
  snapshots: readonly SnapshotTreeEntry[],
): readonly SnapshotTreeEntry[] {
  const seenTreeHashes = new Set<string>();
  const deduped: SnapshotTreeEntry[] = [];

  for (const snapshot of snapshots) {
    if (seenTreeHashes.has(snapshot.treeHash)) {
      continue;
    }
    seenTreeHashes.add(snapshot.treeHash);
    deduped.push(snapshot);
  }

  return deduped;
}

export function filterAffectedSnapshotsByTimestamp(input: {
  snapshots: readonly SnapshotTreeEntry[];
  messages: readonly ChatMessage[];
  sourceMessageId?: string;
}): readonly SnapshotTreeEntry[] {
  if (!input.sourceMessageId) {
    return input.snapshots;
  }
  const sourceMessage = input.messages.find((message) => message.id === input.sourceMessageId);
  const sourceTimestamp = sourceMessage ? toTimestamp(sourceMessage.createdAt) : null;
  if (sourceTimestamp === null) {
    return input.snapshots;
  }
  return input.snapshots.filter((snapshot) => {
    const snapshotTimestamp = toTimestamp(snapshot.createdAt);
    if (snapshotTimestamp === null) {
      return true;
    }
    return snapshotTimestamp >= sourceTimestamp;
  });
}

// ─── 受影响请求集合 ────────────────────────────────────────────────────

/** 从单条 assistant 消息的 trace 中收集回合键（toolCalls + 变更摘要）。 */
export function collectRequestIdsFromAssistantMessage(message: ChatMessage): readonly string[] {
  if (message.role !== 'assistant') {
    return [];
  }

  const trace = readAssistantTracePayload(message);
  if (!trace) {
    return [];
  }

  const requestIds = new Set<string>();

  for (const toolCall of trace.toolCalls) {
    if (
      typeof toolCall.clientRequestId === 'string' &&
      toolCall.clientRequestId.trim().length > 0
    ) {
      requestIds.add(toolCall.clientRequestId);
    }
  }

  for (const file of trace.modifiedFilesSummary?.files ?? []) {
    if (typeof file.clientRequestId === 'string' && file.clientRequestId.trim().length > 0) {
      requestIds.add(file.clientRequestId);
    }
  }

  return [...requestIds];
}

/**
 * 收集源消息及其之后所有 assistant 回合的请求键（**inclusive**）。
 *
 * 截断是 inclusive 语义（源消息本身也被删除），因此源消息自身的回合键必须计入：
 * 重试 / 编辑的源恒为 user 消息（没有回合键，无副作用），但「以 assistant 消息
 * 为源」的入口（如移动端 answer-retry）必须包含该消息自己的回合。
 */
export function collectAffectedRequestIds(input: {
  messages: readonly ChatMessage[];
  sourceMessageId?: string;
}): readonly string[] {
  if (!input.sourceMessageId) {
    return [];
  }

  const sourceIndex = input.messages.findIndex((message) => message.id === input.sourceMessageId);
  if (sourceIndex < 0) {
    return [];
  }

  const requestIds: string[] = [];
  const seenRequestIds = new Set<string>();

  for (const message of input.messages.slice(sourceIndex)) {
    for (const requestId of collectRequestIdsFromAssistantMessage(message)) {
      if (!seenRequestIds.has(requestId)) {
        seenRequestIds.add(requestId);
        requestIds.push(requestId);
      }
    }
  }

  return requestIds;
}

// ─── 文件清单：三信号采集与合并 ────────────────────────────────────────

function normalizeFileEntry(input: {
  file: string;
  status?: 'added' | 'deleted' | 'modified';
  additions: number;
  deletions: number;
  requestId?: string;
  sourceKind?: FileChangeSourceKind;
}): AffectedFileEntry {
  return {
    file: input.file,
    ...(input.status ? { status: input.status } : {}),
    additions: Number.isFinite(input.additions) ? input.additions : 0,
    deletions: Number.isFinite(input.deletions) ? input.deletions : 0,
    ...(input.requestId ? { requestId: input.requestId } : {}),
    ...(input.sourceKind ? { sourceKind: input.sourceKind } : {}),
  };
}

/** 信号 A：消息 trace 的变更摘要（零网络，inclusive 于源消息）。 */
export function collectAffectedFileChangesFromTrace(input: {
  messages: readonly ChatMessage[];
  sourceMessageId?: string;
}): readonly AffectedFileEntry[] {
  const sourceIndex = input.sourceMessageId
    ? input.messages.findIndex((message) => message.id === input.sourceMessageId)
    : -1;
  const affectedMessages =
    input.sourceMessageId === undefined || sourceIndex < 0
      ? input.messages
      : input.messages.slice(sourceIndex);

  const entries: AffectedFileEntry[] = [];
  for (const message of affectedMessages) {
    if (message.role !== 'assistant') {
      continue;
    }
    const trace = readAssistantTracePayload(message);
    for (const file of trace?.modifiedFilesSummary?.files ?? []) {
      if (typeof file.file !== 'string' || file.file.trim().length === 0) {
        continue;
      }
      entries.push(
        normalizeFileEntry({
          file: file.file,
          ...(file.status ? { status: file.status } : {}),
          additions: file.additions,
          deletions: file.deletions,
          ...(file.clientRequestId ? { requestId: file.clientRequestId } : {}),
          ...(file.sourceKind ? { sourceKind: file.sourceKind } : {}),
        }),
      );
    }
  }
  return entries;
}

/** 信号 C：按 request 的文件变更投影。 */
export function toAffectedFileEntriesFromDiffs(
  diffs: readonly SessionFileDiffEntry[],
): readonly AffectedFileEntry[] {
  return diffs.map((diff) => {
    const requestId = diff.requestId ?? diff.clientRequestId;
    return normalizeFileEntry({
      file: diff.file,
      ...(diff.status ? { status: diff.status } : {}),
      additions: diff.additions,
      deletions: diff.deletions,
      ...(requestId ? { requestId } : {}),
      ...(diff.sourceKind ? { sourceKind: diff.sourceKind } : {}),
    });
  });
}

/** 信号 B 的文件面：快照 detail 的文件条目。 */
export function toAffectedFileEntriesFromSnapshotFiles(
  files: readonly SnapshotTreeFileEntry[],
): readonly AffectedFileEntry[] {
  return files.map((file) =>
    normalizeFileEntry({
      file: file.filePath,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
    }),
  );
}

/**
 * 合并三信号的文件清单（按路径去重）。
 *
 * 优先级：按 request 的变更投影 > 消息 trace > 快照文件条目——
 * 前者是服务端权威记录（含审查态），trace 次之（客户端已有），快照条目最弱（可能只覆盖部分文件）。
 */
export function mergeAffectedFileChanges(input: {
  traceFiles?: readonly AffectedFileEntry[];
  diffFiles?: readonly AffectedFileEntry[];
  snapshotFiles?: readonly AffectedFileEntry[];
}): readonly AffectedFileEntry[] {
  const byFile = new Map<string, AffectedFileEntry>();
  for (const entry of input.snapshotFiles ?? []) {
    byFile.set(entry.file, entry);
  }
  for (const entry of input.traceFiles ?? []) {
    byFile.set(entry.file, entry);
  }
  for (const entry of input.diffFiles ?? []) {
    byFile.set(entry.file, entry);
  }
  return [...byFile.values()].sort((left, right) => left.file.localeCompare(right.file));
}

export function summarizeAffectedChanges(
  files: readonly AffectedFileEntry[],
): AffectedChangeSummary {
  const requestIds: string[] = [];
  const seenRequestIds = new Set<string>();
  let totalAdditions = 0;
  let totalDeletions = 0;

  for (const file of files) {
    totalAdditions += file.additions;
    totalDeletions += file.deletions;
    if (file.requestId && !seenRequestIds.has(file.requestId)) {
      seenRequestIds.add(file.requestId);
      requestIds.push(file.requestId);
    }
  }

  return {
    fileCount: files.length,
    totalAdditions,
    totalDeletions,
    requestIds,
  };
}

export function buildAffectedChangeDetection(input: {
  files: readonly AffectedFileEntry[];
  snapshots: readonly SnapshotTreeEntry[];
  detectionIncomplete?: boolean;
}): AffectedChangeDetection {
  return {
    changesDetected: input.files.length > 0 || input.snapshots.length > 0,
    detectionIncomplete: input.detectionIncomplete ?? false,
    files: input.files,
    snapshots: input.snapshots,
    summary: summarizeAffectedChanges(input.files),
  };
}

/** 统一的摘要文案（对话框 / toast 共用）。 */
export function formatAffectedChangeSummary(summary: AffectedChangeSummary): string {
  return `${summary.fileCount} 个文件 · +${summary.totalAdditions} / -${summary.totalDeletions}`;
}

// ─── 可恢复性 ──────────────────────────────────────────────────────────

/**
 * 推导「无法自动恢复」的原因文案；可恢复时返回 null。
 * 顺序即优先级：读取失败 > 无父快照 > 无可恢复文件。
 */
export function deriveRestoreUnavailableReason(input: {
  detailLoadFailed: boolean;
  parentTreeHash: string | null;
  filePathCount: number;
}): string | null {
  if (input.detailLoadFailed) {
    return '读取受影响文件列表失败，无法保证完整恢复。可先保留文件并继续，或稍后重试。';
  }
  if (!input.parentTreeHash) {
    return '当前回退范围之前没有可用快照，暂时无法自动恢复文件。';
  }
  if (input.filePathCount === 0) {
    return '当前回退范围没有可恢复的文件记录。';
  }
  return null;
}
