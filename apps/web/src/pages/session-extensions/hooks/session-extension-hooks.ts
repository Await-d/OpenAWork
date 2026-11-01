/**
 * 会话扩展页面的数据与副作用层（`apps/web/AGENTS.md`：数据获取 / 副作用 → 独立 hook）。
 *
 * 抽取前的状态：面板页与确认页各自把「建客户端 → 取数 → 提交 → 反馈 → 重新加载」
 * 写在组件里，页面因此又长又难读，且两页对「未登录」的处理还不一致（面板会永远
 * 停在「正在加载」，确认页会提示登录）。这里统一成同一套：无令牌即 `unauthenticated`。
 */

import { useCallback, useMemo, useState } from 'react';
import { createSessionExtensionsClient } from '@openAwork/web-client';
import type {
  SessionExtensionOperationDetail,
  SessionExtensionOperationSummary,
  SessionExtensionState,
} from '@openAwork/web-client';
import { useAuthStore } from '../../../stores/auth/auth.js';
import type { SessionExtensionPhase } from '../shared/session-extension-display.js';

/** 客户端与令牌：两页完全一致的前置条件。 */
export function useSessionExtensionClient(): {
  client: ReturnType<typeof createSessionExtensionsClient>;
  accessToken: string | null;
} {
  const gatewayUrl = useAuthStore((s) => s.gatewayUrl);
  const accessToken = useAuthStore((s) => s.accessToken);
  const client = useMemo(() => createSessionExtensionsClient(gatewayUrl), [gatewayUrl]);
  return { client, accessToken };
}

/** 面板页的数据层：会话扩展状态 + 待确认提案 + 一个「跑动作」的包装。 */
export function useSessionExtensionPanelState(sessionId: string): {
  phase: SessionExtensionPhase;
  state: SessionExtensionState | null;
  pending: SessionExtensionOperationSummary[];
  busy: boolean;
  feedback: string | null;
  reload: () => Promise<void>;
  run: (action: () => Promise<unknown>, successText: string) => Promise<void>;
} {
  const { client, accessToken } = useSessionExtensionClient();
  const [phase, setPhase] = useState<SessionExtensionPhase>('loading');
  const [state, setState] = useState<SessionExtensionState | null>(null);
  const [pending, setPending] = useState<SessionExtensionOperationSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!accessToken) {
      setPhase('unauthenticated');
      return;
    }
    if (!sessionId) return;
    try {
      const [nextState, operations] = await Promise.all([
        client.getState(accessToken, sessionId),
        client.listOperations(accessToken, sessionId),
      ]);
      setState(nextState);
      setPending(operations.operations);
      setPhase('ready');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // 404 同时覆盖「不存在」与「不属于我」，与网关的防枚举语义一致。
      setPhase(/不存在|无权限/.test(message) ? 'not-found' : 'error');
      setFeedback(message);
    }
  }, [accessToken, client, sessionId]);

  const run = useCallback(
    async (action: () => Promise<unknown>, successText: string) => {
      setBusy(true);
      setFeedback(null);
      try {
        await action();
        setFeedback(successText);
        await reload();
      } catch (error) {
        setFeedback(error instanceof Error ? error.message : String(error));
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );

  return { phase, state, pending, busy, feedback, reload, run };
}

/** 确认页的数据层：提案详情 + 会话状态 + 同会话其他待处理提案，以及决策动作。 */
export function useSessionExtensionOperation(
  sessionId: string,
  operationId: string,
): {
  phase: SessionExtensionPhase;
  errorText: string | null;
  detail: SessionExtensionOperationDetail | null;
  state: SessionExtensionState | null;
  siblings: SessionExtensionOperationSummary[];
  busy: boolean;
  feedback: string | null;
  reload: () => Promise<void>;
  decide: (decision: 'approve' | 'reject') => Promise<void>;
} {
  const { client, accessToken } = useSessionExtensionClient();
  const [phase, setPhase] = useState<SessionExtensionPhase>('loading');
  const [errorText, setErrorText] = useState<string | null>(null);
  const [detail, setDetail] = useState<SessionExtensionOperationDetail | null>(null);
  const [state, setState] = useState<SessionExtensionState | null>(null);
  const [siblings, setSiblings] = useState<SessionExtensionOperationSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!accessToken) {
      setPhase('unauthenticated');
      return;
    }
    if (!sessionId || !operationId) {
      setPhase('not-found');
      setErrorText('链接缺少会话或操作参数，请回到会话中重新发起。');
      return;
    }
    setPhase('loading');
    try {
      const [operation, extensionState, pending] = await Promise.all([
        client.getOperation(accessToken, sessionId, operationId),
        // 附加信息允许失败：委托管理员只能读审批详情，读不到状态/列表不该挡住确认。
        client.getState(accessToken, sessionId).catch(() => null),
        client.listOperations(accessToken, sessionId).catch(() => null),
      ]);
      setDetail(operation.operation);
      setState(extensionState);
      setSiblings(pending?.operations.filter((item) => item.operationId !== operationId) ?? []);
      setPhase('ready');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // 404（不存在 / 非归属）与其余错误分开提示，避免把「无权访问」说成「系统故障」。
      setErrorText(message);
      setPhase(/不存在|404/.test(message) ? 'not-found' : 'error');
    }
  }, [accessToken, client, operationId, sessionId]);

  const decide = useCallback(
    async (decision: 'approve' | 'reject') => {
      // 提交前再验一次本页持有的凭证：过期或缺失就不发请求（网关也会拒，但没必要往返）。
      if (
        !accessToken ||
        !detail?.nonce ||
        detail.status !== 'pending_approval' ||
        detail.expiresAt <= Date.now()
      ) {
        return;
      }
      setBusy(true);
      setFeedback(null);
      try {
        const result = await client.decide(accessToken, sessionId, operationId, {
          decision,
          nonce: detail.nonce,
        });
        if (result.decision === 'approved') {
          setFeedback(
            result.applied && (result.applied as { kind?: string }).kind === 'succeeded'
              ? '已确认并生效，下一轮对话即可使用。'
              : '已确认。若探活失败，状态会显示为「配置已保存但不可用」，请检查配置或凭据。',
          );
        } else if (result.decision === 'rejected') {
          setFeedback('已拒绝该提案，未做任何变更。');
        } else {
          setFeedback(`当前状态不允许该操作（${result.decision}）。`);
        }
        await reload();
      } catch (error) {
        setFeedback(error instanceof Error ? error.message : String(error));
      } finally {
        setBusy(false);
      }
    },
    [accessToken, client, detail, operationId, reload, sessionId],
  );

  return { phase, errorText, detail, state, siblings, busy, feedback, reload, decide };
}
