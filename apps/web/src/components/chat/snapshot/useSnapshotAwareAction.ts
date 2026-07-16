/**
 * useSnapshotAwareAction
 * ──────────────────────
 *
 * Hook that wraps edit/retry actions with snapshot-awareness:
 *
 *  1. Before executing the action, queries snapshot_trees for the affected range
 *  2. If snapshots exist, shows the SnapshotRestoreConfirmDialog
 *  3. Based on user choice, either proceeds directly or restores first
 *
 * Usage:
 * ```tsx
 * const { checkAndExecute, dialogProps, restoring } = useSnapshotAwareAction({
 *   sessionId,
 *   gatewayUrl,
 * });
 *
 * // When user clicks "edit and resend":
 * checkAndExecute({
 *   action: 'edit',
 *   onProceed: () => { ... },
 * });
 *
 * // Render the dialog:
 * <SnapshotRestoreConfirmDialog {...dialogProps} restoring={restoring} />
 * ```
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import type { SnapshotTreeEntry } from '@openAwork/web-client';
import { createSnapshotTreesClient } from '@openAwork/web-client';
import { readAssistantTracePayload } from '../../conversation-runtime/messages/support.js';
import type { ChatMessage } from '../../conversation-runtime/messages/support.js';
import { useAuthStore } from '../../../stores/auth/auth.js';
import type { SnapshotRestoreConfirmDialogProps } from './SnapshotRestoreConfirmDialog.js';

// ─── 类型 ──────────────────────────────────────────────────────────────

interface UseSnapshotAwareActionInput {
  sessionId: string | null;
  gatewayUrl: string;
  messages: readonly ChatMessage[];
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
  readonly targetTreeHash: string | null;
  readonly unavailableReason: string | null;
}

const EMPTY_RESTORE_PLAN: SnapshotRestorePlan = {
  filePaths: [],
  targetTreeHash: null,
  unavailableReason: null,
};

function toTimestamp(value: string | number | undefined): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function sortSnapshotsByCreatedAt(input: {
  snapshots: readonly SnapshotTreeEntry[];
  originalOrder: readonly SnapshotTreeEntry[];
  requestOrderById?: ReadonlyMap<string, number>;
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
    return (
      (originalIndexByTreeHash.get(right.treeHash) ?? 0) -
      (originalIndexByTreeHash.get(left.treeHash) ?? 0)
    );
  });
}

function filterAffectedSnapshotsByTimestamp(input: {
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

function collectRequestIdsFromAssistantMessage(message: ChatMessage): readonly string[] {
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

function collectAffectedRequestIds(input: {
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

  for (const message of input.messages.slice(sourceIndex + 1)) {
    for (const requestId of collectRequestIdsFromAssistantMessage(message)) {
      if (!seenRequestIds.has(requestId)) {
        seenRequestIds.add(requestId);
        requestIds.push(requestId);
      }
    }
  }

  return requestIds;
}

function dedupeSnapshotsByTreeHash(
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

async function loadAffectedSnapshots(input: {
  accessToken: string;
  client: ReturnType<typeof createSnapshotTreesClient>;
  messages: readonly ChatMessage[];
  sessionId: string;
  sourceMessageId?: string;
}): Promise<readonly SnapshotTreeEntry[]> {
  const affectedRequestIds = collectAffectedRequestIds({
    messages: input.messages,
    sourceMessageId: input.sourceMessageId,
  });

  if (affectedRequestIds.length > 0) {
    const requestScopedResults = await Promise.all(
      affectedRequestIds.map((clientRequestId) =>
        input.client.list(input.accessToken, input.sessionId, { clientRequestId }),
      ),
    );
    const requestScopedSnapshots = requestScopedResults.flatMap((result) => result.trees);
    if (requestScopedSnapshots.length > 0) {
      return sortSnapshotsByCreatedAt({
        snapshots: dedupeSnapshotsByTreeHash(requestScopedSnapshots),
        originalOrder: requestScopedSnapshots,
        requestOrderById: new Map(
          affectedRequestIds.map((clientRequestId, index) => [clientRequestId, index] as const),
        ),
      });
    }
  }

  const sessionScopedResult = await input.client.list(input.accessToken, input.sessionId);
  const filteredSnapshots = filterAffectedSnapshotsByTimestamp({
    snapshots: sessionScopedResult.trees,
    messages: input.messages,
    sourceMessageId: input.sourceMessageId,
  });
  return sortSnapshotsByCreatedAt({
    snapshots: filteredSnapshots,
    originalOrder: sessionScopedResult.trees,
  });
}

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
  const filePathSet = new Set<string>();

  await Promise.all(
    input.snapshots.map(async (snapshot) => {
      try {
        const detail = await input.client.detail(
          input.accessToken,
          input.sessionId,
          snapshot.treeHash,
        );
        for (const file of detail.files) {
          filePathSet.add(file.filePath);
        }
      } catch {
        detailLoadFailed = true;
      }
    }),
  );

  const filePaths = [...filePathSet].sort((left, right) => left.localeCompare(right));

  if (detailLoadFailed) {
    return {
      filePaths,
      targetTreeHash: null,
      unavailableReason:
        '读取受影响文件列表失败，无法保证完整恢复。可先保留文件并继续，或稍后重试。',
    };
  }

  if (!earliestSnapshot.parentTreeHash) {
    return {
      filePaths,
      targetTreeHash: null,
      unavailableReason: '当前回退范围之前没有可用快照，暂时无法自动恢复文件。',
    };
  }

  if (filePaths.length === 0) {
    return {
      filePaths,
      targetTreeHash: null,
      unavailableReason: '当前回退范围没有可恢复的文件记录。',
    };
  }

  return {
    filePaths,
    targetTreeHash: earliestSnapshot.parentTreeHash,
    unavailableReason: null,
  };
}

export function useSnapshotAwareAction(
  input: UseSnapshotAwareActionInput,
): UseSnapshotAwareActionReturn {
  const accessToken = useAuthStore((state) => state.accessToken);
  const [open, setOpen] = useState(false);
  const [affectedSnapshots, setAffectedSnapshots] = useState<SnapshotTreeEntry[]>([]);
  const [action, setAction] = useState<'edit' | 'retry'>('edit');
  const [restoring, setRestoring] = useState(false);
  const [restorePlan, setRestorePlan] = useState<SnapshotRestorePlan>(EMPTY_RESTORE_PLAN);
  const [restoreErrorMessage, setRestoreErrorMessage] = useState<string | null>(null);

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
        try {
          const snapshots = await loadAffectedSnapshots({
            accessToken,
            client,
            messages: input.messages,
            sessionId,
            sourceMessageId: execInput.sourceMessageId,
          });

          if (snapshots.length === 0) {
            execInput.onProceed();
            return;
          }

          const nextRestorePlan = await buildRestorePlan({
            accessToken,
            client,
            sessionId,
            snapshots,
          });

          if (thisGen !== requestGenRef.current) return;

          pendingProceedRef.current = execInput.onProceed;
          setAffectedSnapshots([...snapshots]);
          setRestorePlan(nextRestorePlan);
          setRestoreErrorMessage(null);
          setAction(execInput.action);
          setOpen(true);
        } catch {
          if (thisGen === requestGenRef.current) {
            execInput.onProceed();
          }
        }
      })();
    },
    [accessToken, client, input.messages, input.sessionId],
  );

  const handleCancel = useCallback(() => {
    setOpen(false);
    setAffectedSnapshots([]);
    setRestorePlan(EMPTY_RESTORE_PLAN);
    setRestoreErrorMessage(null);
    pendingProceedRef.current = null;
  }, []);

  const handleContinueWithoutRestore = useCallback(() => {
    setOpen(false);
    const proceed = pendingProceedRef.current;
    pendingProceedRef.current = null;
    setAffectedSnapshots([]);
    setRestorePlan(EMPTY_RESTORE_PLAN);
    setRestoreErrorMessage(null);
    proceed?.();
  }, []);

  const handleRestoreAndContinue = useCallback(() => {
    if (!input.sessionId || !accessToken || !restorePlan.targetTreeHash) return;
    if (restorePlan.filePaths.length === 0 || restorePlan.unavailableReason) return;
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
        const proceed = pendingProceedRef.current;
        pendingProceedRef.current = null;
        setAffectedSnapshots([]);
        setRestorePlan(EMPTY_RESTORE_PLAN);
        setRestoreErrorMessage(null);
        proceed?.();
      } catch (error) {
        setRestoring(false);
        setRestoreErrorMessage(error instanceof Error ? error.message : '恢复失败，请稍后重试。');
      }
    })();
  }, [accessToken, client, input.sessionId, restorePlan]);

  const dialogProps: Omit<SnapshotRestoreConfirmDialogProps, 'restoring'> = {
    open,
    affectedSnapshots,
    action,
    onContinueWithoutRestore: handleContinueWithoutRestore,
    onRestoreAndContinue: handleRestoreAndContinue,
    onCancel: handleCancel,
    restoreTargetTreeHash: restorePlan.targetTreeHash,
    restoreUnavailableReason: restorePlan.unavailableReason,
    restoreErrorMessage,
  };

  return {
    checkAndExecute,
    dialogProps,
    restoring,
  };
}
