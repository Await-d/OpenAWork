import { useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';

import type { SubagentNotice } from '@openAwork/shared';
import type { RollbackReceipt, Session, SessionTask } from '@openAwork/web-client';

import { resolveRollbackDerivedState } from '../conversation/snapshot/rollback-derived-state.js';

type UseRollbackDerivedCleanupDeps = {
  readonly childSessions: Session[];
  readonly sessionTasks: SessionTask[];
  readonly setChildSessions: Dispatch<SetStateAction<Session[]>>;
  readonly setSelectedChildSessionId: Dispatch<SetStateAction<string | null>>;
  readonly setSessionTasks: Dispatch<SetStateAction<SessionTask[]>>;
  readonly setSubagentNotices: Dispatch<SetStateAction<SubagentNotice[]>>;
  readonly subagentNotices: SubagentNotice[];
};

/**
 * 回退（截断生效）后清理「子代理派生状态」：后端只删该回合的派生物（任务图节点 /
 * run events / 团队记录…），**子会话本身保留**；这里把属于被作废回合的子会话、
 * 任务与完成通知从展示中摘掉，避免回退后子代理信息仍挂在页面上。
 */
export function useRollbackDerivedCleanup(deps: UseRollbackDerivedCleanupDeps) {
  const {
    childSessions,
    sessionTasks,
    setChildSessions,
    setSelectedChildSessionId,
    setSessionTasks,
    setSubagentNotices,
    subagentNotices,
  } = deps;

  return useCallback(
    (receipt: RollbackReceipt | null) => {
      const next = resolveRollbackDerivedState({
        receipt,
        childSessions,
        subagentNotices,
        sessionTasks,
      });
      const changed =
        next.childSessions.length !== childSessions.length ||
        next.sessionTasks.length !== sessionTasks.length ||
        next.subagentNotices.length !== subagentNotices.length;
      if (!changed) {
        return;
      }
      setChildSessions(next.childSessions);
      setSessionTasks(next.sessionTasks);
      setSubagentNotices(next.subagentNotices);
      setSelectedChildSessionId((previous) =>
        previous && next.removedChildSessionIds.includes(previous) ? null : previous,
      );
    },
    [
      childSessions,
      sessionTasks,
      setChildSessions,
      setSelectedChildSessionId,
      setSessionTasks,
      setSubagentNotices,
      subagentNotices,
    ],
  );
}
