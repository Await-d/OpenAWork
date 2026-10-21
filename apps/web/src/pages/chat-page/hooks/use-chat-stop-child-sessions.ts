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

/**
 * 停止子代理的统一包装：`onStart` 置忙 → try → catch 归一 toast → `onFinally` 清忙。
 *
 * 必须留在模块级：React Compiler 1.0.0 不支持 `try/catch` 的 finally 子句，本 hook 2 处
 * 这类 try 会让整个 hook 脱靶（实测）。语义逐字照搬。
 */
async function runStopChildSessionsActionOnce(ctx: {
  onStart?: () => void;
  onError: (error: unknown) => void;
  onFinally: () => void;
  run: () => Promise<void>;
}): Promise<void> {
  ctx.onStart?.();
  try {
    await ctx.run();
  } catch (error) {
    ctx.onError(error);
  } finally {
    ctx.onFinally();
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
      // try/catch/finally 下沉到模块级 `runStopChildSessionsActionOnce`（见其注释）。
      await runStopChildSessionsActionOnce({
        onError: (error) => {
          toast(error instanceof Error ? error.message : '停止子代理失败', 'error');
        },
        onFinally: () => {
          setStoppingSubAgentIds((previous) => {
            const next = new Set(previous);
            next.delete(childSessionId);
            return next;
          });
        },
        run: async () => {
          const result = await createSessionsClient(gatewayUrl).stopChildren(
            token,
            currentSessionId,
            {
              childSessionIds: [childSessionId],
            },
          );
          reportStopResult(result, false);
          requestSessionListRefresh();
        },
      });
    },
    [currentSessionId, gatewayUrl, requestSessionListRefresh, token],
  );

  const handleStopAllChildSessions = useCallback(async () => {
    if (!currentSessionId || !token) {
      return;
    }
    // 同单个停止：整段下沉到模块级 `runStopChildSessionsActionOnce`（见其注释）。
    await runStopChildSessionsActionOnce({
      onStart: () => {
        setStoppingAllSubAgents(true);
      },
      onError: (error) => {
        toast(error instanceof Error ? error.message : '停止全部子代理失败', 'error');
      },
      onFinally: () => {
        setStoppingAllSubAgents(false);
      },
      run: async () => {
        const result = await createSessionsClient(gatewayUrl).stopChildren(
          token,
          currentSessionId,
          {
            all: true,
          },
        );
        reportStopResult(result, true);
        requestSessionListRefresh();
      },
    });
  }, [currentSessionId, gatewayUrl, requestSessionListRefresh, token]);

  return {
    stoppingSubAgentIds,
    stoppingAllSubAgents,
    handleStopChildSession,
    handleStopAllChildSessions,
  };
}
