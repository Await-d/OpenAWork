import { useCallback, useEffect, useRef, useState } from 'react';
import { createPermissionsClient, createSessionsClient } from '@openAwork/web-client';
import type { PendingPermissionRequest, Session, SessionTask } from '@openAwork/web-client';
import type { Message } from '@openAwork/shared';
import {
  normalizeChatMessages,
  type ChatMessage,
} from '../../../components/conversation-runtime/messages/support.js';
import { filterTranscriptMessages } from '../../../components/conversation-runtime/messages/transcript-visibility.js';

export interface SubSessionDetailState {
  error: string | null;
  loading: boolean;
  messages: ChatMessage[];
  pendingPermissions: PendingPermissionRequest[];
  session: Session | null;
  tasks: SessionTask[];
}

const EMPTY_STATE: SubSessionDetailState = {
  error: null,
  loading: false,
  messages: [],
  pendingPermissions: [],
  session: null,
  tasks: [],
};

/**
 * 消息指纹。用于判断「服务端这一拍返回的消息是否与上一拍等价」，等价时复用上一
 * 拍的 `normalizeChatMessages` 结果——那是本 hook 里最贵的一步（全量消息遍历 +
 * 归一化），而 2.5s 一次的轮询在子代理跑完后绝大多数拍的返回值完全一致。
 *
 * 指纹只用**廉价且稳定**的字段（id / role / createdAt / status / content 段数），
 * 刻意不做深度比较：深度比较的成本与直接归一化同量级，省不下来。
 */
function messageFingerprint(messages: readonly Message[] | undefined): string {
  if (!messages || messages.length === 0) return '';
  let fingerprint = String(messages.length);
  for (const message of messages) {
    fingerprint += `|${message.id}:${message.role}:${message.createdAt}:${message.status ?? ''}:${message.content.length}`;
  }
  return fingerprint;
}

/**
 * 指纹相同时是否可以安全复用上一拍的归一化结果。
 *
 * 指纹只看结构性字段，理论上可能漏掉「同一条消息 content 内部被改写」的情况。
 * 这里加两道守卫：会话非 running、且没有任何消息处于 `streaming` 状态——即
 * 追加写入已经结束。此时内容不会再变，复用是安全的。反之（正在流式）一律重算，
 * 保证 UI 不会漏掉增量输出。
 */
function canReuseNormalizedMessages(
  fingerprint: string,
  lastFingerprint: string | null,
  session: Session,
): boolean {
  if (lastFingerprint === null || fingerprint !== lastFingerprint) return false;
  if (session.state_status === 'running') return false;
  const messages = session.messages;
  if (!messages) return true;
  for (const message of messages) {
    if (message.status === 'streaming') return false;
  }
  return true;
}

/** 按主键序列比较两个小列表；用于任务 / 待审批的等价判断，避免每拍换新引用。 */
function sameByKey(
  left: readonly { id: string }[] | readonly { requestId: string }[],
  right: readonly { id: string }[] | readonly { requestId: string }[],
): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index] as { id?: string; requestId?: string } | undefined;
    const b = right[index] as { id?: string; requestId?: string } | undefined;
    if ((a?.id ?? a?.requestId) !== (b?.id ?? b?.requestId)) return false;
  }
  return true;
}

export function useSubSessionDetail(
  childSessionId: string | null,
  gatewayUrl: string,
  token: string | null,
) {
  const [state, setState] = useState<SubSessionDetailState>(EMPTY_STATE);
  const refreshNonceRef = useRef(0);
  /**
   * 单飞标记。
   *
   * 这个 hook 每 2.5s 轮询一次，一次要并发 3 个请求，其中 `GET /sessions/:id`
   * 拉的是**无分页上限的全量消息历史**——单次往返很容易超过 2.5s。定时器不会
   * 等上一轮结束，于是请求会持续叠加；而本 hook 是「每个打开的子会话面板一条」，
   * N 个面板就是 N 倍。`refresh()`（手动/外部触发）仍可强制发起，`force` 区分二者。
   */
  const inFlightRef = useRef(false);
  /** 上一拍的消息指纹与归一化结果，供等价时复用。 */
  const lastFingerprintRef = useRef<string | null>(null);
  const lastNormalizedRef = useRef<ChatMessage[]>([]);

  const runRefresh = useCallback(
    async (options: { force: boolean }) => {
      if (!childSessionId || !token) {
        setState(EMPTY_STATE);
        return;
      }
      if (!options.force && inFlightRef.current) {
        return;
      }

      inFlightRef.current = true;
      const requestId = refreshNonceRef.current + 1;
      refreshNonceRef.current = requestId;
      setState((previous) =>
        previous.loading && previous.error === null
          ? previous
          : { ...previous, error: null, loading: true },
      );

      try {
        const sessionsClient = createSessionsClient(gatewayUrl);
        const permissionsClient = createPermissionsClient(gatewayUrl);
        const [session, tasksResult, permissionsResult] = await Promise.all([
          sessionsClient.get(token, childSessionId),
          sessionsClient
            .getTasks(token, childSessionId)
            .then((tasks) => ({ ok: true as const, tasks }))
            .catch(() => ({ ok: false as const, tasks: [] as SessionTask[] })),
          permissionsClient
            .listPending(token, childSessionId)
            .then((perms) => ({ ok: true as const, perms }))
            .catch(() => ({ ok: false as const, perms: [] as PendingPermissionRequest[] })),
        ]);

        if (refreshNonceRef.current !== requestId) {
          return;
        }

        const fingerprint = messageFingerprint(session.messages);
        let messages: ChatMessage[];
        if (canReuseNormalizedMessages(fingerprint, lastFingerprintRef.current, session)) {
          messages = lastNormalizedRef.current;
        } else {
          messages = filterTranscriptMessages(normalizeChatMessages(session.messages));
          lastFingerprintRef.current = fingerprint;
          lastNormalizedRef.current = messages;
        }

        setState((previous) => ({
          error: null,
          loading: false,
          messages,
          pendingPermissions: sameByKey(previous.pendingPermissions, permissionsResult.perms)
            ? previous.pendingPermissions
            : permissionsResult.perms,
          session,
          tasks: sameByKey(previous.tasks, tasksResult.tasks) ? previous.tasks : tasksResult.tasks,
        }));
      } catch (error) {
        if (refreshNonceRef.current !== requestId) {
          return;
        }

        lastFingerprintRef.current = null;
        lastNormalizedRef.current = [];
        setState({
          error: error instanceof Error ? error.message : '加载子代理详情失败',
          loading: false,
          messages: [],
          pendingPermissions: [],
          session: null,
          tasks: [],
        });
      } finally {
        inFlightRef.current = false;
      }
    },
    [childSessionId, gatewayUrl, token],
  );

  /** 手动 / 外部触发的刷新：总是发起新请求，不受单飞限制。 */
  const refresh = useCallback(() => runRefresh({ force: true }), [runRefresh]);

  useEffect(() => {
    if (!childSessionId || !token) {
      lastFingerprintRef.current = null;
      lastNormalizedRef.current = [];
      setState(EMPTY_STATE);
      return;
    }

    void runRefresh({ force: true });
    const intervalId = window.setInterval(() => {
      // 页面不可见时跳过：每个打开的子会话面板各有一条 2.5s 轮询，
      // 后台叠加会成为多会话场景下的请求风暴。
      if (typeof document !== 'undefined' && document.hidden) return;
      void runRefresh({ force: false });
    }, 2500);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [childSessionId, runRefresh, token]);

  return {
    ...state,
    refresh,
  };
}
