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
import { useAuthStore } from '../../../stores/auth/auth.js';
import type { SnapshotRestoreConfirmDialogProps } from './SnapshotRestoreConfirmDialog.js';

// ─── 类型 ──────────────────────────────────────────────────────────────

interface UseSnapshotAwareActionInput {
  sessionId: string | null;
  gatewayUrl: string;
}

interface CheckAndExecuteInput {
  /** 操作类型 */
  action: 'edit' | 'retry';
  /** 实际执行操作的回调（在用户确认后调用） */
  onProceed: () => void;
}

interface UseSnapshotAwareActionReturn {
  /** 检查快照并执行（如果有快照则弹出确认） */
  checkAndExecute: (input: CheckAndExecuteInput) => void;
  /** 传给 SnapshotRestoreConfirmDialog 的 props */
  dialogProps: Omit<SnapshotRestoreConfirmDialogProps, 'restoring'>;
  /** 是否正在恢复中 */
  restoring: boolean;
}

// ─── Hook ──────────────────────────────────────────────────────────────

export function useSnapshotAwareAction(
  input: UseSnapshotAwareActionInput,
): UseSnapshotAwareActionReturn {
  const accessToken = useAuthStore((state) => state.accessToken);
  const [open, setOpen] = useState(false);
  const [affectedSnapshots, setAffectedSnapshots] = useState<SnapshotTreeEntry[]>([]);
  const [action, setAction] = useState<'edit' | 'retry'>('edit');
  const [restoring, setRestoring] = useState(false);

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

      // Debounce: ignore rapid repeated calls (< 300ms)
      const now = Date.now();
      if (now - lastFireRef.current < 300) return;
      lastFireRef.current = now;

      // Increment generation to invalidate any in-flight request
      requestGenRef.current += 1;
      const thisGen = requestGenRef.current;

      void (async () => {
        try {
          const result = await client.list(accessToken, input.sessionId!);

          // Stale check: if a newer call was made, discard this result
          if (thisGen !== requestGenRef.current) return;

          const snapshots = result.trees;

          if (snapshots.length === 0) {
            execInput.onProceed();
            return;
          }

          // Has snapshots → show confirmation dialog
          pendingProceedRef.current = execInput.onProceed;
          setAffectedSnapshots(snapshots);
          setAction(execInput.action);
          setOpen(true);
        } catch {
          // If the check fails, just proceed (graceful degradation)
          if (thisGen === requestGenRef.current) {
            execInput.onProceed();
          }
        }
      })();
    },
    [input.sessionId, input.gatewayUrl, accessToken, client],
  );

  const handleCancel = useCallback(() => {
    setOpen(false);
    setAffectedSnapshots([]);
    pendingProceedRef.current = null;
  }, []);

  const handleContinueWithoutRestore = useCallback(() => {
    setOpen(false);
    const proceed = pendingProceedRef.current;
    pendingProceedRef.current = null;
    setAffectedSnapshots([]);
    proceed?.();
  }, []);

  const handleRestoreAndContinue = useCallback(
    (treeHash: string) => {
      if (!input.sessionId || !accessToken) return;

      setRestoring(true);

      void (async () => {
        try {
          await client.restoreToTree(accessToken, input.sessionId!, {
            treeHash,
            mode: 'apply',
          });
        } catch {
          // Restore failed — still proceed (user explicitly chose to continue)
        } finally {
          setRestoring(false);
          setOpen(false);
          const proceed = pendingProceedRef.current;
          pendingProceedRef.current = null;
          setAffectedSnapshots([]);
          proceed?.();
        }
      })();
    },
    [input.sessionId, input.gatewayUrl, accessToken, client],
  );

  const dialogProps: Omit<SnapshotRestoreConfirmDialogProps, 'restoring'> = {
    open,
    affectedSnapshots,
    action,
    onContinueWithoutRestore: handleContinueWithoutRestore,
    onRestoreAndContinue: handleRestoreAndContinue,
    onCancel: handleCancel,
  };

  return {
    checkAndExecute,
    dialogProps,
    restoring,
  };
}
