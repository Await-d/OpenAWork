import { useCallback, useState } from 'react';
import { createSessionsClient } from '@openAwork/web-client';
import type { StopChildrenResult } from '@openAwork/web-client';
import { toast } from '../../../components/common/feedback/ToastNotification.js';

interface UseChatStopChildSessionsOptions {
  readonly currentSessionId: string | null;
  readonly gatewayUrl: string;
  readonly token: string | null;
  readonly requestSessionListRefresh: () => void;
}

function reportStopResult(result: StopChildrenResult, reportSuccess: boolean) {
  if (result.failed.length > 0) {
    const succeeded = result.stopped.length > 0 ? `已停止 ${result.stopped.length} 个子代理；` : '';
    const failures = result.failed
      .map(({ childSessionId, error }) => `${childSessionId}：${error}`)
      .join('；');
    toast(
      `${succeeded}${result.failed.length} 个子代理停止失败（${failures}）。请点击停止按钮重试。`,
      'error',
    );
  } else if (reportSuccess) {
    toast(
      result.stopped.length > 0 ? `已停止 ${result.stopped.length} 个子代理` : '没有可停止的子代理',
      'info',
    );
  }
}

export function useChatStopChildSessions({
  currentSessionId,
  gatewayUrl,
  token,
  requestSessionListRefresh,
}: UseChatStopChildSessionsOptions) {
  const [stoppingSubAgentIds, setStoppingSubAgentIds] = useState<ReadonlySet<string>>(new Set());
  const [stoppingAllSubAgents, setStoppingAllSubAgents] = useState(false);

  const handleStopChildSession = useCallback(
    async (childSessionId: string) => {
      if (!currentSessionId || !token) {
        return;
      }
      setStoppingSubAgentIds((previous) => {
        const next = new Set(previous);
        next.add(childSessionId);
        return next;
      });
      try {
        const result = await createSessionsClient(gatewayUrl).stopChildren(
          token,
          currentSessionId,
          {
            childSessionIds: [childSessionId],
          },
        );
        reportStopResult(result, false);
        requestSessionListRefresh();
      } catch (error) {
        toast(error instanceof Error ? error.message : '停止子代理失败', 'error');
      } finally {
        setStoppingSubAgentIds((previous) => {
          const next = new Set(previous);
          next.delete(childSessionId);
          return next;
        });
      }
    },
    [currentSessionId, gatewayUrl, requestSessionListRefresh, token],
  );

  const handleStopAllChildSessions = useCallback(async () => {
    if (!currentSessionId || !token) {
      return;
    }
    setStoppingAllSubAgents(true);
    try {
      const result = await createSessionsClient(gatewayUrl).stopChildren(token, currentSessionId, {
        all: true,
      });
      reportStopResult(result, true);
      requestSessionListRefresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : '停止全部子代理失败', 'error');
    } finally {
      setStoppingAllSubAgents(false);
    }
  }, [currentSessionId, gatewayUrl, requestSessionListRefresh, token]);

  return {
    stoppingSubAgentIds,
    stoppingAllSubAgents,
    handleStopChildSession,
    handleStopAllChildSessions,
  };
}
