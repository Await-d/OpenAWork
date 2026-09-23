/**
 * rollback-file-choice · 移动端「重新生成 / 重新发送」的文件变更选择模型（纯逻辑）
 *
 * 与 Web 端同一产品口径：**检测到变更就必须让用户选择，不允许静默放行**；
 * 无法自动恢复（无父快照 / 快照读取失败）时仍展示影响面与原因，只是不提供「恢复」。
 * **「读取失败」不得当成「没有变更」**：`detectionIncomplete` 为真且无证据时，
 * 调用方仍必须弹窗（展示「无法确认」），而不是直接继续。
 *
 * 移动端消息模型携带 `clientRequestIds`（trace 里的回合键）与 `createdAtMs`，
 * 因此可以按 request 精确定位受影响快照；缺失时退化为按时间过滤，再退化为全部快照。
 *
 * 网络请求不在此模块：调用方（ChatScreen / answer-retry）负责拉取 `snapshot_trees`
 * 与按 request 的变更投影后传入。
 */

import type { SnapshotTreeEntry } from '@openAwork/web-client';
import type { MobileChatMessage } from './chat-message-content';

export const MOBILE_SNAPSHOT_READ_FAILED_REASON =
  '快照信息读取失败，无法保证完整恢复。可先保留文件并继续，或稍后重试。';

export const MOBILE_NO_SNAPSHOT_REASON = '当前回退范围之前没有可用快照，暂时无法自动恢复文件。';

export const MOBILE_DETECTION_FAILED_REASON =
  '检测文件变更时出错，无法确认该范围是否存在变更。可先保留文件并继续，或稍后重试。';

export interface MobileRollbackChoiceModel {
  readonly affectedSnapshots: readonly SnapshotTreeEntry[];
  readonly changesDetected: boolean;
  /** 检测不完整（快照列表 / 按 request 投影读取失败）。 */
  readonly detectionIncomplete: boolean;
  readonly fileCount: number;
  readonly restoreTargetTreeHash: string | null;
  readonly restoreUnavailableReason: string | null;
  readonly summaryText: string;
}

/**
 * SQLite `datetime('now')` 的输出形态：UTC、秒级、空格分隔、无时区后缀。
 * `snapshot_trees.created_at` 就是这种格式——`Date.parse` 会按**本地时区**解释它。
 */
const SQLITE_UTC_DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/;

export function toTimestamp(value: string | number | undefined): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = SQLITE_UTC_DATETIME_PATTERN.test(value)
      ? `${value.replace(' ', 'T')}Z`
      : value;
    const parsed = Date.parse(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * 收集源消息及其之后所有消息携带的回合键（**inclusive**）。
 *
 * 截断是 inclusive 语义（源消息本身也被删除），所以源消息自身的回合键必须计入——
 * 以 assistant 消息为源的入口（answer-retry）依赖这一点。
 */
export function collectAffectedRequestIdsFromMessages(input: {
  messages: readonly MobileChatMessage[];
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
  for (const message of input.messages.slice(sourceIndex)) {
    for (const requestId of message.clientRequestIds ?? []) {
      if (!requestIds.includes(requestId)) {
        requestIds.push(requestId);
      }
    }
  }
  return requestIds;
}

/**
 * 选出受影响快照：
 *   1. 有回合键 → 按 `clientRequestId` 精确匹配；
 *   2. 精确匹配为空（step / baseline 快照的 request 归属可能缺失）→ 回退到时间过滤；
 *   3. 没有时间信息 → 返回全部快照（保守：宁可多提示，不静默）。
 *
 * **输入契约**：`snapshots` 必须按网关 `list()` 的顺序传入（`created_at DESC, id DESC`）——
 * 函数内部会翻转为升序，时间并列时保留「更早者在前」，避免恢复基线取到更晚的快照。
 */
export function selectAffectedSnapshots(input: {
  messages: readonly MobileChatMessage[];
  requestIds: readonly string[];
  snapshots: readonly SnapshotTreeEntry[];
  sourceMessageId?: string;
}): readonly SnapshotTreeEntry[] {
  let selected: readonly SnapshotTreeEntry[] | null = null;

  if (input.requestIds.length > 0) {
    const requestIdSet = new Set(input.requestIds);
    const byRequest = input.snapshots.filter(
      (snapshot) => snapshot.clientRequestId !== null && requestIdSet.has(snapshot.clientRequestId),
    );
    if (byRequest.length > 0) {
      selected = byRequest;
    }
  }

  if (selected === null) {
    const sourceMessage = input.sourceMessageId
      ? input.messages.find((message) => message.id === input.sourceMessageId)
      : undefined;
    const sourceTimestamp = sourceMessage?.createdAtMs ?? null;
    selected =
      sourceTimestamp === null
        ? input.snapshots
        : input.snapshots.filter((snapshot) => {
            const snapshotTimestamp = toTimestamp(snapshot.createdAt);
            return snapshotTimestamp === null || snapshotTimestamp >= sourceTimestamp;
          });
  }

  // DESC 输入翻转为 ASC 后稳定排序：时间可比的按时间升序，不可比的保持原始相对位置。
  return [...selected]
    .reverse()
    .map((snapshot, index) => ({ index, snapshot }))
    .sort((left, right) => {
      const leftTimestamp = toTimestamp(left.snapshot.createdAt);
      const rightTimestamp = toTimestamp(right.snapshot.createdAt);
      if (leftTimestamp !== null && rightTimestamp !== null && leftTimestamp !== rightTimestamp) {
        return leftTimestamp - rightTimestamp;
      }
      return left.index - right.index;
    })
    .map((entry) => entry.snapshot);
}

export function buildMobileRollbackChoiceModel(input: {
  snapshots: readonly SnapshotTreeEntry[];
  /** 快照列表读取失败。 */
  snapshotListFailed?: boolean;
  /** 按 request 的变更投影读取失败。 */
  diffLoadFailed?: boolean;
  /** 除快照外的变更证据（按 request 的文件变更投影）。 */
  hasFileChangeEvidence?: boolean;
}): MobileRollbackChoiceModel {
  const seenTreeHashes = new Set<string>();
  const affectedSnapshots: SnapshotTreeEntry[] = [];
  for (const snapshot of input.snapshots) {
    if (seenTreeHashes.has(snapshot.treeHash)) {
      continue;
    }
    seenTreeHashes.add(snapshot.treeHash);
    affectedSnapshots.push(snapshot);
  }

  const earliestSnapshot = affectedSnapshots[0] ?? null;
  const fileCount = affectedSnapshots.reduce((sum, snapshot) => sum + snapshot.filesChanged, 0);
  const changesDetected = affectedSnapshots.length > 0 || input.hasFileChangeEvidence === true;
  const detectionIncomplete = input.snapshotListFailed === true || input.diffLoadFailed === true;

  let restoreUnavailableReason: string | null = null;
  if (!changesDetected) {
    // 无证据 + 检测不完整 = 「无法确认」，不是「无法恢复」。
    restoreUnavailableReason = MOBILE_DETECTION_FAILED_REASON;
  } else if (input.snapshotListFailed) {
    restoreUnavailableReason = MOBILE_SNAPSHOT_READ_FAILED_REASON;
  } else if (!earliestSnapshot?.parentTreeHash) {
    restoreUnavailableReason = MOBILE_NO_SNAPSHOT_REASON;
  }

  return {
    affectedSnapshots,
    changesDetected,
    detectionIncomplete,
    fileCount,
    restoreTargetTreeHash: earliestSnapshot?.parentTreeHash ?? null,
    restoreUnavailableReason,
    summaryText:
      affectedSnapshots.length > 0
        ? `从该消息之后有 ${affectedSnapshots.length} 个快照（约 ${fileCount} 个文件变更）。`
        : changesDetected
          ? '从该消息之后检测到文件变更。'
          : '文件变更检测未完成，无法确认该消息之后是否存在变更。',
  };
}

/** 组装 Alert 正文（与 Web 端文案对齐）。 */
export function buildMobileRollbackAlertMessage(model: MobileRollbackChoiceModel): string {
  const lines = [
    model.summaryText,
    model.changesDetected ? '重新生成不会自动恢复这些文件变更。' : '继续操作不会恢复任何文件。',
  ];
  if (model.restoreUnavailableReason) {
    lines.push(model.restoreUnavailableReason);
  }
  return lines.join('\n');
}
