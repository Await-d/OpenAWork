/**
 * useSnapshotAwareAction
 * ──────────────────────
 *
 * 包裹「编辑重发 / 重试」动作，让文件变更处理成为**必选交互**：
 *
 *  1. 执行前检测受影响范围的变更（三信号：消息 trace / snapshot_trees / 按 request 的变更投影）；
 *  2. 检测到变更 → 弹出 SnapshotRestoreConfirmDialog，让用户选择
 *     「保留文件并继续 / 恢复文件后继续（可用时）/ 打开文件变更面板 / 取消」；
 *  3. 未检测到变更 → 直接执行原动作（静默，产品确认口径）。
 *
 * 关键不变量：**「读取失败」不得当成「没有变更」**——任一信号失败但仍有变更证据时，
 * 弹窗照常出现，只把「恢复文件后继续」降级为不可用并展示原因。
 *
 * Usage:
 * ```tsx
 * const { checkAndExecute, dialogProps, restoring } = useSnapshotAwareAction({
 *   sessionId,
 *   gatewayUrl,
 *   messages,
 *   onOpenFileChangesPanel,
 * });
 *
 * checkAndExecute({ action: 'edit', sourceMessageId, onProceed: () => { ... } });
 * <SnapshotRestoreConfirmDialog {...dialogProps} restoring={restoring} />
 * ```
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import type { SnapshotTreeEntry, SnapshotTreeFileEntry } from '@openAwork/web-client';
import { createSessionsClient, createSnapshotTreesClient } from '@openAwork/web-client';
import { toast } from '../../common/feedback/ToastNotification.js';
import type { ChatMessage } from '../../conversation-runtime/messages/support.js';
import { useAuthStore } from '../../../stores/auth/auth.js';
import type { SnapshotRestoreConfirmDialogProps } from './SnapshotRestoreConfirmDialog.js';
import {
  buildAffectedChangeDetection,
  collectAffectedFileChangesFromTrace,
  collectAffectedRequestIds,
  dedupeSnapshotsByTreeHash,
  deriveRestoreUnavailableReason,
  filterAffectedSnapshotsByTimestamp,
  mergeAffectedFileChanges,
  sortSnapshotsByCreatedAt,
  toAffectedFileEntriesFromDiffs,
  toAffectedFileEntriesFromSnapshotFiles,
  type AffectedChangeDetection,
  type AffectedChangeSummary,
  type AffectedFileEntry,
} from './affected-changes.js';

// ─── 类型 ──────────────────────────────────────────────────────────────

export interface UseSnapshotAwareActionInput {
  sessionId: string | null;
  gatewayUrl: string;
  messages: readonly ChatMessage[];
  /**
   * 打开「文件变更面板」的入口（Chat → 右栏审查面板；Team → 快照时间线）。
   * 缺省时对话框不渲染该按钮。
   */
  onOpenFileChangesPanel?: () => void;
}

interface CheckAndExecuteInput {
  action: 'edit' | 'retry';
  onProceed: () => void;
  sourceMessageId?: string;
}

interface UseSnapshotAwareActionReturn {
  checkAndExecute: (input: CheckAndExecuteInput) => void;
  dialogProps: Omit<SnapshotRestoreConfirmDialogProps, 'restoring'>;
  restoring: boolean;
}

interface SnapshotRestorePlan {
  readonly filePaths: readonly string[];
  readonly snapshotFiles: readonly SnapshotTreeFileEntry[];
  readonly targetTreeHash: string | null;
  readonly detailLoadFailed: boolean;
}

interface SnapshotLoadResult {
  readonly failed: boolean;
  readonly snapshots: readonly SnapshotTreeEntry[];
}

interface DiffLoadResult {
  readonly entries: readonly AffectedFileEntry[];
  readonly failed: boolean;
}

interface AffectedChangeContext {
  readonly detection: AffectedChangeDetection;
  readonly plan: SnapshotRestorePlan;
  readonly restoreUnavailableReason: string | null;
}

const EMPTY_RESTORE_PLAN: SnapshotRestorePlan = {
  filePaths: [],
  snapshotFiles: [],
  targetTreeHash: null,
  detailLoadFailed: false,
};

const SNAPSHOT_READ_FAILED_REASON =
  '快照信息读取失败，无法保证完整恢复。可先保留文件并继续，或稍后重试。';

const DETECTION_FAILED_REASON =
  '检测文件变更时出错，无法确认该范围是否存在变更。可先保留文件并继续，或稍后重试。';

// ─── 网络：受影响快照 ──────────────────────────────────────────────────

async function loadAffectedSnapshots(input: {
  accessToken: string;
  client: ReturnType<typeof createSnapshotTreesClient>;
  messages: readonly ChatMessage[];
  sessionId: string;
  sourceMessageId?: string;
}): Promise<SnapshotLoadResult> {
  const affectedRequestIds = collectAffectedRequestIds({
    messages: input.messages,
    ...(input.sourceMessageId !== undefined ? { sourceMessageId: input.sourceMessageId } : {}),
  });

  if (affectedRequestIds.length > 0) {
    const requestScopedResults = await Promise.allSettled(
      affectedRequestIds.map((clientRequestId) =>
        input.client.list(input.accessToken, input.sessionId, { clientRequestId }),
      ),
    );
    const requestScopedSnapshots = requestScopedResults.flatMap((result) =>
      result.status === 'fulfilled' ? result.value.trees : [],
    );
    if (requestScopedSnapshots.length > 0) {
      return {
        failed: requestScopedResults.some((result) => result.status === 'rejected'),
        snapshots: sortSnapshotsByCreatedAt({
          snapshots: dedupeSnapshotsByTreeHash(requestScopedSnapshots),
          originalOrder: requestScopedSnapshots,
          requestOrderById: new Map(
            affectedRequestIds.map((clientRequestId, index) => [clientRequestId, index] as const),
          ),
          // 网关 request-scoped 列表 = ORDER BY created_at ASC, id ASC。
          inputOrder: 'asc',
        }),
      };
    }
  }

  const sessionScopedResult = await input.client.list(input.accessToken, input.sessionId);
  const filteredSnapshots = filterAffectedSnapshotsByTimestamp({
    snapshots: sessionScopedResult.trees,
    messages: input.messages,
    ...(input.sourceMessageId !== undefined ? { sourceMessageId: input.sourceMessageId } : {}),
  });
  return {
    failed: false,
    snapshots: sortSnapshotsByCreatedAt({
      snapshots: filteredSnapshots,
      originalOrder: sessionScopedResult.trees,
      // 网关 session-scoped 列表 = ORDER BY created_at DESC, id DESC。
      inputOrder: 'desc',
    }),
  };
}

// ─── 网络：按 request 的文件变更投影 ──────────────────────────────────

async function loadAffectedFileChanges(input: {
  accessToken: string;
  client: ReturnType<typeof createSessionsClient>;
  requestIds: readonly string[];
  sessionId: string;
}): Promise<DiffLoadResult> {
  if (input.requestIds.length === 0) {
    return { entries: [], failed: false };
  }

  const results = await Promise.allSettled(
    input.requestIds.map((clientRequestId) =>
      input.client.getRequestFileChanges(input.accessToken, input.sessionId, clientRequestId),
    ),
  );

  const entries: AffectedFileEntry[] = [];
  let failed = false;
  for (const result of results) {
    if (result.status === 'fulfilled') {
      entries.push(...toAffectedFileEntriesFromDiffs(result.value.fileChanges.fileDiffs));
    } else {
      failed = true;
    }
  }
  return { entries, failed };
}

// ─── 网络：可恢复性计划 ────────────────────────────────────────────────

async function buildRestorePlan(input: {
  accessToken: string;
  client: ReturnType<typeof createSnapshotTreesClient>;
  sessionId: string;
  snapshots: readonly SnapshotTreeEntry[];
}): Promise<SnapshotRestorePlan> {
  const earliestSnapshot = input.snapshots[0];
  if (!earliestSnapshot) {
    return EMPTY_RESTORE_PLAN;
  }

  let detailLoadFailed = false;
  const snapshotFilesByPath = new Map<string, SnapshotTreeFileEntry>();

  await Promise.all(
    input.snapshots.map(async (snapshot) => {
      try {
        const detail = await input.client.detail(
          input.accessToken,
          input.sessionId,
          snapshot.treeHash,
        );
        for (const file of detail.files) {
          snapshotFilesByPath.set(file.filePath, file);
        }
      } catch {
        detailLoadFailed = true;
      }
    }),
  );

  const snapshotFiles = [...snapshotFilesByPath.values()].sort((left, right) =>
    left.filePath.localeCompare(right.filePath),
  );
  const filePaths = snapshotFiles.map((file) => file.filePath);

  return {
    filePaths,
    snapshotFiles,
    targetTreeHash: earliestSnapshot.parentTreeHash,
    detailLoadFailed,
  };
}

// ─── 编排：一次检测上下文 ──────────────────────────────────────────────

async function loadAffectedChangeContext(input: {
  accessToken: string;
  gatewayUrl: string;
  messages: readonly ChatMessage[];
  sessionId: string;
  sourceMessageId?: string;
}): Promise<AffectedChangeContext> {
  const snapshotTreesClient = createSnapshotTreesClient(input.gatewayUrl);
  const sessionsClient = createSessionsClient(input.gatewayUrl);
  const requestIds = collectAffectedRequestIds({
    messages: input.messages,
    ...(input.sourceMessageId !== undefined ? { sourceMessageId: input.sourceMessageId } : {}),
  });
  const traceFiles = collectAffectedFileChangesFromTrace({
    messages: input.messages,
    ...(input.sourceMessageId !== undefined ? { sourceMessageId: input.sourceMessageId } : {}),
  });

  const snapshotResult = await Promise.allSettled([
    loadAffectedSnapshots({
      accessToken: input.accessToken,
      client: snapshotTreesClient,
      messages: input.messages,
      sessionId: input.sessionId,
      ...(input.sourceMessageId !== undefined ? { sourceMessageId: input.sourceMessageId } : {}),
    }),
    loadAffectedFileChanges({
      accessToken: input.accessToken,
      client: sessionsClient,
      requestIds,
      sessionId: input.sessionId,
    }),
  ]);

  const snapshotLoad: SnapshotLoadResult =
    snapshotResult[0].status === 'fulfilled'
      ? snapshotResult[0].value
      : { failed: true, snapshots: [] };
  const diffLoad: DiffLoadResult =
    snapshotResult[1].status === 'fulfilled'
      ? snapshotResult[1].value
      : { entries: [], failed: true };

  let plan = EMPTY_RESTORE_PLAN;
  if (snapshotLoad.snapshots.length > 0) {
    try {
      plan = await buildRestorePlan({
        accessToken: input.accessToken,
        client: snapshotTreesClient,
        sessionId: input.sessionId,
        snapshots: snapshotLoad.snapshots,
      });
    } catch {
      plan = { ...EMPTY_RESTORE_PLAN, detailLoadFailed: true };
    }
  }

  const files = mergeAffectedFileChanges({
    traceFiles,
    diffFiles: diffLoad.entries,
    snapshotFiles: toAffectedFileEntriesFromSnapshotFiles(plan.snapshotFiles),
  });

  const detection = buildAffectedChangeDetection({
    files,
    snapshots: snapshotLoad.snapshots,
    detectionIncomplete: snapshotLoad.failed || diffLoad.failed || plan.detailLoadFailed,
  });

  // 无证据 + 检测不完整 = 「无法确认」（不是「无法恢复」）：用统一措辞。
  // 有证据但快照读取失败 = 恢复不可用（无法保证完整恢复）。
  let restoreUnavailableReason: string | null;
  if (!detection.changesDetected) {
    restoreUnavailableReason = DETECTION_FAILED_REASON;
  } else if (snapshotLoad.failed) {
    restoreUnavailableReason = SNAPSHOT_READ_FAILED_REASON;
  } else {
    restoreUnavailableReason = deriveRestoreUnavailableReason({
      detailLoadFailed: plan.detailLoadFailed,
      parentTreeHash: plan.targetTreeHash,
      filePathCount: plan.filePaths.length,
    });
  }

  return { detection, plan, restoreUnavailableReason };
}

// ─── Hook ──────────────────────────────────────────────────────────────

export function useSnapshotAwareAction(
  input: UseSnapshotAwareActionInput,
): UseSnapshotAwareActionReturn {
  const accessToken = useAuthStore((state) => state.accessToken);
  const [open, setOpen] = useState(false);
  const [affectedSnapshots, setAffectedSnapshots] = useState<SnapshotTreeEntry[]>([]);
  const [affectedFiles, setAffectedFiles] = useState<readonly AffectedFileEntry[]>([]);
  const [changeSummary, setChangeSummary] = useState<AffectedChangeSummary | null>(null);
  const [action, setAction] = useState<'edit' | 'retry'>('edit');
  const [restoring, setRestoring] = useState(false);
  const [restorePlan, setRestorePlan] = useState<SnapshotRestorePlan>(EMPTY_RESTORE_PLAN);
  const [restoreUnavailableReason, setRestoreUnavailableReason] = useState<string | null>(null);
  const [restoreErrorMessage, setRestoreErrorMessage] = useState<string | null>(null);
  const [detectionIncomplete, setDetectionIncomplete] = useState(false);

  // Stable client instance (recreated only when gatewayUrl changes)
  const client = useMemo(() => createSnapshotTreesClient(input.gatewayUrl), [input.gatewayUrl]);

  // Store the pending proceed callback
  const pendingProceedRef = useRef<(() => void) | null>(null);

  // Request generation counter: incremented on each checkAndExecute call.
  // If a newer call arrives before the previous one resolves, the older
  // response is discarded (stale closure check).
  const requestGenRef = useRef(0);

  // Debounce guard: prevent double-fire within 300ms
  const lastFireRef = useRef(0);

  const resetDialogState = useCallback(() => {
    setAffectedSnapshots([]);
    setAffectedFiles([]);
    setChangeSummary(null);
    setRestorePlan(EMPTY_RESTORE_PLAN);
    setRestoreUnavailableReason(null);
    setRestoreErrorMessage(null);
    setDetectionIncomplete(false);
  }, []);

  /**
   * 不需要弹窗时的统一收敛：若上一次调用留下了未决弹窗（pending 回调 / 打开的
   * 对话框），先清干净再执行，避免旧回调被二次触发或旧弹窗残留。
   */
  const finishWithoutDialog = useCallback(
    (proceed: () => void) => {
      if (pendingProceedRef.current !== null) {
        pendingProceedRef.current = null;
        setOpen(false);
        resetDialogState();
      }
      proceed();
    },
    [resetDialogState],
  );

  const checkAndExecute = useCallback(
    (execInput: CheckAndExecuteInput) => {
      if (!input.sessionId || !accessToken) {
        execInput.onProceed();
        return;
      }
      const sessionId = input.sessionId;

      // Debounce: ignore rapid repeated calls (< 300ms)
      const now = Date.now();
      if (now - lastFireRef.current < 300) return;
      lastFireRef.current = now;

      // Increment generation to invalidate any in-flight request
      requestGenRef.current += 1;
      const thisGen = requestGenRef.current;

      void (async () => {
        let context: AffectedChangeContext | null = null;
        try {
          context = await loadAffectedChangeContext({
            accessToken,
            gatewayUrl: input.gatewayUrl,
            messages: input.messages,
            sessionId,
            ...(execInput.sourceMessageId !== undefined
              ? { sourceMessageId: execInput.sourceMessageId }
              : {}),
          });
        } catch {
          // 编排整体异常（非单个信号，正常不可达）：按「检测不完整」处理——
          // 不得把异常当成「没有变更」而静默放行。
          context = null;
        }

        if (thisGen !== requestGenRef.current) return;

        // 产品口径：仅检测到变更时弹窗；无变更直接执行原动作。
        // 例外：检测不完整（任一信号读取失败）时不得静默放行——没有证据不等于没有变更。
        if (
          context &&
          !context.detection.changesDetected &&
          !context.detection.detectionIncomplete
        ) {
          finishWithoutDialog(execInput.onProceed);
          return;
        }

        pendingProceedRef.current = execInput.onProceed;
        if (context) {
          setAffectedSnapshots([...context.detection.snapshots]);
          setAffectedFiles(context.detection.files);
          setChangeSummary(context.detection.summary);
          setRestorePlan(context.plan);
          setRestoreUnavailableReason(context.restoreUnavailableReason);
          setDetectionIncomplete(context.detection.detectionIncomplete);
        } else {
          setAffectedSnapshots([]);
          setAffectedFiles([]);
          setChangeSummary(null);
          setRestorePlan(EMPTY_RESTORE_PLAN);
          setRestoreUnavailableReason(DETECTION_FAILED_REASON);
          setDetectionIncomplete(true);
        }
        setRestoreErrorMessage(null);
        setAction(execInput.action);
        setOpen(true);
      })();
    },
    [accessToken, finishWithoutDialog, input.gatewayUrl, input.messages, input.sessionId],
  );

  const handleCancel = useCallback(() => {
    setOpen(false);
    resetDialogState();
    pendingProceedRef.current = null;
  }, [resetDialogState]);

  const handleContinueWithoutRestore = useCallback(() => {
    setOpen(false);
    const proceed = pendingProceedRef.current;
    pendingProceedRef.current = null;
    resetDialogState();
    proceed?.();
  }, [resetDialogState]);

  const handleOpenFileChangesPanel = useCallback(() => {
    // 「打开面板」语义 = 取消本次操作并转到面板处理；用户处理完可重新触发重试/编辑。
    setOpen(false);
    pendingProceedRef.current = null;
    resetDialogState();
    input.onOpenFileChangesPanel?.();
    toast('已打开文件变更面板，处理后可重新执行操作。', 'info');
  }, [input, resetDialogState]);

  const handleRestoreAndContinue = useCallback(() => {
    if (!input.sessionId || !accessToken || !restorePlan.targetTreeHash) return;
    if (restorePlan.filePaths.length === 0 || restoreUnavailableReason) return;
    const sessionId = input.sessionId;
    const targetTreeHash = restorePlan.targetTreeHash;

    setRestoring(true);
    setRestoreErrorMessage(null);

    void (async () => {
      try {
        await client.restoreToTree(accessToken, sessionId, {
          treeHash: targetTreeHash,
          mode: 'apply',
          files: [...restorePlan.filePaths],
          deleteMissing: true,
        });
        setRestoring(false);
        setOpen(false);
        // 恢复只覆盖「快照文件集」；展示过的其它变更（仅出现在 trace / 变更投影里）
        // 不会被回滚——不能笼统宣称「已恢复受影响文件」。
        const coveredPaths = new Set(restorePlan.filePaths);
        const uncoveredCount = affectedFiles.filter((file) => !coveredPaths.has(file.file)).length;
        if (uncoveredCount > 0) {
          toast(
            `已恢复快照覆盖的文件；另有 ${uncoveredCount} 个文件不在快照中，未恢复。`,
            'warning',
          );
        } else {
          toast('已恢复受影响文件，继续执行操作。', 'success');
        }
        const proceed = pendingProceedRef.current;
        pendingProceedRef.current = null;
        resetDialogState();
        proceed?.();
      } catch (error) {
        setRestoring(false);
        setRestoreErrorMessage(error instanceof Error ? error.message : '恢复失败，请稍后重试。');
      }
    })();
  }, [
    accessToken,
    affectedFiles,
    client,
    input.sessionId,
    resetDialogState,
    restorePlan,
    restoreUnavailableReason,
  ]);

  const dialogProps: Omit<SnapshotRestoreConfirmDialogProps, 'restoring'> = {
    open,
    affectedSnapshots,
    files: affectedFiles,
    changeSummary,
    detectionIncomplete,
    action,
    onContinueWithoutRestore: handleContinueWithoutRestore,
    onRestoreAndContinue: handleRestoreAndContinue,
    onCancel: handleCancel,
    ...(input.onOpenFileChangesPanel ? { onOpenFileChangesPanel: handleOpenFileChangesPanel } : {}),
    restoreTargetTreeHash: restorePlan.targetTreeHash,
    restoreUnavailableReason,
    restoreErrorMessage,
  };

  return {
    checkAndExecute,
    dialogProps,
    restoring,
  };
}
