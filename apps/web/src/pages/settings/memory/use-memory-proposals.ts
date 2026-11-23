import { useCallback, useEffect, useRef, useState } from 'react';
import { createMemoriesClient } from '@openAwork/web-client';
import type {
  DecideProposalInput,
  MemoryProposal,
  MemoryRevisionRecord,
} from '@openAwork/web-client';
import { logger } from '../../../utils/log/logger.js';
import type { MemoryActionFeedback, MemoryLoadStatus } from './memory-types.js';

/** 提议面板对外暴露的状态与动作。 */
export interface UseMemoryProposalsResult {
  proposals: MemoryProposal[];
  listStatus: MemoryLoadStatus;
  listError: string | null;
  pendingCount: number;
  countError: string | null;
  feedback: MemoryActionFeedback;
  clearFeedback: () => void;
  refresh: () => Promise<void>;
  decide: (
    proposalId: string,
    decision: DecideProposalInput,
  ) => Promise<{ ok: boolean; error?: string }>;
  /** 只读：给定记忆的历史版本列表。 */
  listRevisions: (memoryId: string) => Promise<MemoryRevisionRecord[]>;
  /** 回滚到指定历史版本；失败返回 error 文案（不抛错，便于 UI 显示冲突提示）。 */
  rollback: (revisionId: string) => Promise<{ ok: boolean; error?: string }>;
}

interface UseMemoryProposalsInput {
  gatewayUrl: string;
  token: string | null;
  active: boolean;
  /** 提议决策/回滚成功后回调（如刷新记忆列表与统计）。 */
  onChanged?: () => void;
}

const FEEDBACK_CLEAR_MS = 5000;

/**
 * 提议生命周期 hook：加载待确认、计数、决策、历史与回滚。
 *
 * `try/catch` 全部下沉到模块级函数：React Compiler 对 hook 内 try/finally 支持有限，
 * 语义与 `use-memory-management.ts` 的同名包装一致。
 */
async function runProposalAction(ctx: {
  onError: (error: unknown) => void;
  run: () => Promise<void>;
}): Promise<boolean> {
  try {
    await ctx.run();
    return true;
  } catch (error) {
    ctx.onError(error);
    return false;
  }
}

function toErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.length > 0 ? error.message : fallback;
}

export function useMemoryProposals({
  gatewayUrl,
  token,
  active,
  onChanged,
}: UseMemoryProposalsInput): UseMemoryProposalsResult {
  const [proposals, setProposals] = useState<MemoryProposal[]>([]);
  const [listStatus, setListStatus] = useState<MemoryLoadStatus>('idle');
  const [listError, setListError] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [countError, setCountError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<MemoryActionFeedback>({ status: 'idle', message: null });

  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasLoadedRef = useRef(false);
  const generationRef = useRef(0);
  const activeRef = useRef(false);

  useEffect(() => {
    activeRef.current = active && Boolean(token);
    generationRef.current += 1;
    hasLoadedRef.current = false;
    setProposals([]);
    setListStatus('idle');
    setListError(null);
    setPendingCount(0);
    setCountError(null);
    setFeedback({ status: 'idle', message: null });
    return () => {
      activeRef.current = false;
      generationRef.current += 1;
      if (feedbackTimerRef.current) {
        clearTimeout(feedbackTimerRef.current);
        feedbackTimerRef.current = null;
      }
    };
  }, [active, gatewayUrl, token]);

  const showFeedback = useCallback((status: MemoryActionFeedback['status'], message: string) => {
    if (feedbackTimerRef.current) {
      clearTimeout(feedbackTimerRef.current);
    }
    setFeedback({ status, message });
    if (status === 'success' || status === 'error') {
      feedbackTimerRef.current = setTimeout(() => {
        setFeedback({ status: 'idle', message: null });
        feedbackTimerRef.current = null;
      }, FEEDBACK_CLEAR_MS);
    }
  }, []);

  const clearFeedback = useCallback(() => {
    if (feedbackTimerRef.current) {
      clearTimeout(feedbackTimerRef.current);
      feedbackTimerRef.current = null;
    }
    setFeedback({ status: 'idle', message: null });
  }, []);

  const refresh = useCallback(async () => {
    if (!token || !activeRef.current) {
      return;
    }
    const generation = generationRef.current;
    const isCurrent = () => activeRef.current && generationRef.current === generation;
    setListStatus('loading');
    setListError(null);
    const ok = await runProposalAction({
      onError: (error) => {
        if (!isCurrent()) return;
        const message = toErrorMessage(error, '加载待确认提议失败');
        setListError(message);
        setListStatus('error');
        logger.error('failed to load memory proposals', error);
      },
      run: async () => {
        const client = createMemoriesClient(gatewayUrl);
        const next = await client.listProposals(token, { status: 'pending', limit: 50, offset: 0 });
        if (!isCurrent()) return;
        setProposals(next);
        setListStatus('loaded');
      },
    });
    if (!ok || !isCurrent()) {
      return;
    }
    await runProposalAction({
      onError: (error) => {
        if (!isCurrent()) return;
        setCountError(toErrorMessage(error, '读取待确认数量失败'));
        logger.error('failed to count memory proposals', error);
      },
      run: async () => {
        const count = await createMemoriesClient(gatewayUrl).countPendingProposals(token);
        if (!isCurrent()) return;
        setPendingCount(count);
        setCountError(null);
      },
    });
  }, [gatewayUrl, token]);

  useEffect(() => {
    if (!active || !token || hasLoadedRef.current) {
      return;
    }
    hasLoadedRef.current = true;
    void refresh();
  }, [active, token, refresh]);

  const decide = useCallback(
    async (
      proposalId: string,
      decision: DecideProposalInput,
    ): Promise<{ ok: boolean; error?: string }> => {
      if (!token || !activeRef.current) {
        return { ok: false, error: '未登录或页面已关闭，无法确认。' };
      }
      const generation = generationRef.current;
      const isCurrent = () => activeRef.current && generationRef.current === generation;
      showFeedback('pending', '正在提交决策…');
      let failure: string | null = null;
      const ok = await runProposalAction({
        onError: (error) => {
          failure = toErrorMessage(error, '提交决策失败');
          logger.error('failed to decide memory proposal', error);
        },
        run: async () => {
          const result = await createMemoriesClient(gatewayUrl).decideProposal(
            token,
            proposalId,
            decision,
          );
          if (result.ok === false) failure = '提交决策失败';
        },
      });
      if (!isCurrent()) return { ok: false, error: '身份已切换或页面已关闭。' };
      if (!ok || failure !== null) {
        const message = failure ?? '提交决策失败';
        showFeedback('error', message);
        return { ok: false, error: message };
      }
      showFeedback('success', decision.decision === 'approve' ? '已接受' : '已拒绝');
      await refresh();
      if (!isCurrent()) return { ok: false, error: '身份已切换或页面已关闭。' };
      onChanged?.();
      return { ok: true };
    },
    [gatewayUrl, onChanged, refresh, showFeedback, token],
  );

  const listRevisions = useCallback(
    async (memoryId: string): Promise<MemoryRevisionRecord[]> => {
      if (!token || !activeRef.current) {
        return [];
      }
      const generation = generationRef.current;
      const client = createMemoriesClient(gatewayUrl);
      const revisions = await client.listRevisions(token, { memoryId, limit: 20 });
      return activeRef.current && generationRef.current === generation ? revisions : [];
    },
    [gatewayUrl, token],
  );

  const rollback = useCallback(
    async (revisionId: string): Promise<{ ok: boolean; error?: string }> => {
      if (!token || !activeRef.current) {
        return { ok: false, error: '未登录或页面已关闭，无法回滚。' };
      }
      const generation = generationRef.current;
      const isCurrent = () => activeRef.current && generationRef.current === generation;
      showFeedback('pending', '正在回滚…');
      let failure: string | null = null;
      const ok = await runProposalAction({
        onError: (error) => {
          failure = toErrorMessage(error, '回滚失败');
          logger.error('failed to rollback memory revision', error);
        },
        run: async () => {
          const result = await createMemoriesClient(gatewayUrl).rollbackRevision(token, revisionId);
          if (result.ok === false) failure = '回滚失败';
        },
      });
      if (!isCurrent()) return { ok: false, error: '身份已切换或页面已关闭。' };
      if (!ok || failure !== null) {
        const message = failure ?? '回滚失败';
        showFeedback('error', message);
        return { ok: false, error: message };
      }
      showFeedback('success', '已回滚到该版本');
      await refresh();
      if (!isCurrent()) return { ok: false, error: '身份已切换或页面已关闭。' };
      onChanged?.();
      return { ok: true };
    },
    [gatewayUrl, onChanged, refresh, showFeedback, token],
  );

  return {
    proposals,
    listStatus,
    listError,
    pendingCount,
    countError,
    feedback,
    clearFeedback,
    refresh,
    decide,
    listRevisions,
    rollback,
  };
}
