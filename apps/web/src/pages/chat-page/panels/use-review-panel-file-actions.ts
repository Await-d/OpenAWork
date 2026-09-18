import { useEffect, useState } from 'react';
import {
  createSessionsClient,
  type SessionFileDiffEntry,
  type SessionFileReviewDecision,
} from '@openAwork/web-client';
import { toast } from '../../../components/common/feedback/ToastNotification.js';
import {
  getReviewPanelActionErrorMessage,
  getReviewPanelFileActionKey,
  isReviewPanelConflictError,
  readReviewPanelConflictDetails,
  selectReviewPanelPendingFiles,
  selectReviewPanelReviewTarget,
  type ReviewPanelConflictDetails,
  type ReviewPanelReviewTarget,
} from './review-panel-model.js';

export type ReviewPanelMutationFailureKind = 'conflict' | 'error';

export interface ReviewPanelMutationFeedback {
  readonly conflicts: ReviewPanelConflictDetails | null;
  readonly decision: SessionFileReviewDecision;
  readonly kind: ReviewPanelMutationFailureKind;
  readonly message: string;
  readonly processedCount?: number;
  readonly target: ReviewPanelReviewTarget;
}

export interface UseReviewPanelFileActionsInput {
  readonly files: readonly SessionFileDiffEntry[];
  readonly gatewayUrl: string;
  readonly onRefetch: () => void;
  readonly revision: number;
  readonly sessionId: string | null;
  readonly token: string | null;
}

export interface UseReviewPanelFileActionsResult {
  readonly acceptAll: () => void;
  readonly acceptFile: (file: SessionFileDiffEntry) => void;
  readonly bulkPending: SessionFileReviewDecision | null;
  readonly busy: boolean;
  readonly dismissFeedback: () => void;
  readonly feedback: ReviewPanelMutationFeedback | null;
  readonly isFilePending: (file: SessionFileDiffEntry) => boolean;
  readonly rejectAll: () => void;
  readonly rejectFile: (file: SessionFileDiffEntry) => void;
  readonly retryWithForce: (feedback: ReviewPanelMutationFeedback) => void;
}

interface MutationFailure {
  readonly error: unknown;
  readonly kind: ReviewPanelMutationFailureKind;
  readonly message: string;
}

type MutationOutcome =
  { readonly ok: true } | { readonly ok: false; readonly failure: MutationFailure };

const MISSING_CONTEXT_MESSAGE = '会话上下文缺失，无法提交审查决定。';

function formatDecisionLabel(decision: SessionFileReviewDecision): string {
  return decision === 'accepted' ? '接受' : '拒绝';
}

function toMutationFailure(error: unknown, fallback: string): MutationFailure {
  return {
    error,
    kind: isReviewPanelConflictError(error) ? 'conflict' : 'error',
    message: getReviewPanelActionErrorMessage(error, fallback),
  };
}

function buildFeedback(
  failure: MutationFailure,
  target: ReviewPanelReviewTarget,
  decision: SessionFileReviewDecision,
  processedCount?: number,
): ReviewPanelMutationFeedback {
  return {
    conflicts: failure.kind === 'conflict' ? readReviewPanelConflictDetails(failure.error) : null,
    decision,
    kind: failure.kind,
    message: failure.message,
    target,
    ...(processedCount === undefined ? {} : { processedCount }),
  };
}

function confirmRejectFile(filePath: string): boolean {
  return window.confirm(
    `确定要拒绝「${filePath}」吗？该文件会被回滚到变更前内容（新增文件将被删除），此操作不可撤销。`,
  );
}

function confirmRejectAll(count: number): boolean {
  return window.confirm(
    `确定要拒绝当前范围内的 ${count} 个文件变更吗？这些文件会被回滚到变更前内容（新增文件将被删除），此操作不可撤销。`,
  );
}

export function useReviewPanelFileActions({
  files,
  gatewayUrl,
  onRefetch,
  revision,
  sessionId,
  token,
}: UseReviewPanelFileActionsInput): UseReviewPanelFileActionsResult {
  const [pendingKeys, setPendingKeys] = useState<readonly string[]>([]);
  const [bulkPending, setBulkPending] = useState<SessionFileReviewDecision | null>(null);
  const [feedback, setFeedback] = useState<ReviewPanelMutationFeedback | null>(null);

  useEffect(() => {
    setFeedback(null);
  }, [revision]);

  function isFilePending(file: SessionFileDiffEntry): boolean {
    return pendingKeys.includes(getReviewPanelFileActionKey(file));
  }

  async function runMutation(
    target: ReviewPanelReviewTarget,
    decision: SessionFileReviewDecision,
    forceConflicts: boolean,
  ): Promise<MutationOutcome> {
    if (!token || !sessionId) {
      return {
        ok: false,
        failure: { error: null, kind: 'error', message: MISSING_CONTEXT_MESSAGE },
      };
    }

    const key = `${target.requestId}\u0000${target.filePath}`;
    setPendingKeys((previous) => [...previous, key]);
    try {
      await createSessionsClient(gatewayUrl).reviewFileChange(token, sessionId, {
        decision,
        filePath: target.filePath,
        requestId: target.requestId,
        ...(forceConflicts ? { forceConflicts: true } : {}),
      });
      setFeedback(null);
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        failure: toMutationFailure(error, `提交文件审查决定失败：${target.filePath}`),
      };
    } finally {
      setPendingKeys((previous) => previous.filter((item) => item !== key));
    }
  }

  async function runSingleFile(
    file: SessionFileDiffEntry,
    decision: SessionFileReviewDecision,
  ): Promise<void> {
    const target = selectReviewPanelReviewTarget(file);
    if (!target) {
      toast('该文件变更缺少可提交的请求标识，无法审查。', 'warning');
      return;
    }
    if (decision === 'rejected' && !confirmRejectFile(target.filePath)) {
      return;
    }

    const outcome = await runMutation(target, decision, false);
    if (outcome.ok) {
      toast(`已${formatDecisionLabel(decision)}：${target.filePath}`, 'success');
      onRefetch();
      return;
    }

    setFeedback(buildFeedback(outcome.failure, target, decision));
    toast(
      outcome.failure.kind === 'conflict'
        ? `检测到工作区冲突：${target.filePath}`
        : `审查失败：${target.filePath}`,
      outcome.failure.kind === 'conflict' ? 'warning' : 'error',
    );
  }

  async function runBulk(decision: SessionFileReviewDecision): Promise<void> {
    const targets: ReviewPanelReviewTarget[] = [];
    for (const file of selectReviewPanelPendingFiles(files)) {
      const target = selectReviewPanelReviewTarget(file);
      if (target) {
        targets.push(target);
      }
    }

    if (targets.length === 0) {
      toast('当前范围内没有待审查的文件变更。', 'info');
      return;
    }
    if (decision === 'rejected' && !confirmRejectAll(targets.length)) {
      return;
    }

    setBulkPending(decision);
    setFeedback(null);
    const label = formatDecisionLabel(decision);
    let processedCount = 0;
    let failedTarget: ReviewPanelReviewTarget | null = null;
    let failure: MutationFailure | null = null;

    for (const target of targets) {
      const outcome = await runMutation(target, decision, false);
      if (outcome.ok) {
        processedCount += 1;
        continue;
      }
      failedTarget = target;
      failure = outcome.failure;
      break;
    }

    setBulkPending(null);

    if (processedCount > 0) {
      onRefetch();
    }

    if (!failure || !failedTarget) {
      toast(`已${label} ${processedCount} 个文件变更。`, 'success');
      return;
    }

    setFeedback(buildFeedback(failure, failedTarget, decision, processedCount));
    toast(
      `批量${label}在处理 ${processedCount} 个文件后中止：${failedTarget.filePath}`,
      failure.kind === 'conflict' ? 'warning' : 'error',
    );
  }

  async function runForcedRetry(entry: ReviewPanelMutationFeedback): Promise<void> {
    const outcome = await runMutation(entry.target, entry.decision, true);
    if (outcome.ok) {
      toast(
        `已强制覆盖并${formatDecisionLabel(entry.decision)}：${entry.target.filePath}`,
        'success',
      );
      onRefetch();
      return;
    }

    setFeedback(buildFeedback(outcome.failure, entry.target, entry.decision, entry.processedCount));
    toast(`强制覆盖失败：${entry.target.filePath}`, 'error');
  }

  return {
    acceptAll: () => {
      void runBulk('accepted');
    },
    acceptFile: (file) => {
      void runSingleFile(file, 'accepted');
    },
    bulkPending,
    busy: bulkPending !== null || pendingKeys.length > 0,
    dismissFeedback: () => {
      setFeedback(null);
    },
    feedback,
    isFilePending,
    rejectAll: () => {
      void runBulk('rejected');
    },
    rejectFile: (file) => {
      void runSingleFile(file, 'rejected');
    },
    retryWithForce: (entry) => {
      void runForcedRetry(entry);
    },
  };
}
