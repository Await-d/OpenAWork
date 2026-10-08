/**
 * 当前会话的产物（`GET /sessions/:id/artifacts`）单一数据源。
 *
 * ## 为什么合并
 *
 * 切换会话时同一条产物读模型被两条链路各拉一次：
 *
 * 1. ChatPage 里的图片编辑参考图列表（会话级 state）
 * 2. 右栏概览的产物计数（`contentArtifactCount`）
 *
 * 两者请求参数完全一致（同一 session、无额外 query），响应体的
 * `contentArtifacts` 数组既能派生参考图列表、也能派生计数 —— 拆成两个 hook
 * 纯属重复往返。本 hook 一次请求同时喂给两个消费方。
 *
 * ## 关于消息数变化时的刷新
 *
 * 产物计数过去挂在「消息条数变化」上（`sessionReloadNonce + messages.length`），
 * 于是流式输出每落一条消息就打一次产物列表。这里改成**去抖补拉**：消息数变化
 * 只重置一个定时器，等消息流安静 `ARTIFACT_REFRESH_DEBOUNCE_MS` 之后才补一次
 * 拉取。会话切换与显式重载（`reloadKey`）走立即路径，不额外等待。
 */

import { useEffect, useRef, useState } from 'react';
import {
  toImageEditReferenceArtifacts,
  type ImageEditReferenceArtifact,
} from '../render/image-edit-reference-artifacts.js';
import { fetchSessionArtifactsOnce } from '../../../../utils/session/session-artifacts-flight.js';

interface UseSessionContentArtifactsOptions {
  currentSessionId: string | null;
  gatewayUrl: string;
  /** 软重载 / 手动重载信号，变化时立即重新拉取。 */
  reloadKey: number;
  /** 会话消息条数，仅用于在流式输出安静后去抖补拉。 */
  messageCount: number;
  token: string | null;
}

export type SessionContentArtifactsStatus = 'idle' | 'loading' | 'ready' | 'error';

/** 消息流停止变化多久后补拉一次产物列表。 */
const ARTIFACT_REFRESH_DEBOUNCE_MS = 800;

export function useSessionContentArtifacts({
  currentSessionId,
  gatewayUrl,
  reloadKey,
  messageCount,
  token,
}: UseSessionContentArtifactsOptions): {
  referenceArtifacts: ImageEditReferenceArtifact[];
  contentArtifactCount: number;
  status: SessionContentArtifactsStatus;
} {
  const [referenceArtifacts, setReferenceArtifacts] = useState<ImageEditReferenceArtifact[]>([]);
  const [contentArtifactCount, setContentArtifactCount] = useState(0);
  const [status, setStatus] = useState<SessionContentArtifactsStatus>('idle');
  const [debouncedRefreshNonce, setDebouncedRefreshNonce] = useState(0);

  useEffect(() => {
    if (!currentSessionId || !token) {
      setReferenceArtifacts([]);
      setContentArtifactCount(0);
      setStatus('idle');
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    setStatus('loading');

    void fetchSessionArtifactsOnce({
      gatewayUrl,
      token,
      sessionId: currentSessionId,
      signal: controller.signal,
    })
      .then((payload) => {
        if (cancelled) {
          return;
        }
        const artifacts = payload.contentArtifacts;
        setReferenceArtifacts(toImageEditReferenceArtifacts(artifacts));
        setContentArtifactCount(artifacts.length);
        setStatus('ready');
      })
      .catch((error: unknown) => {
        if (cancelled || (error instanceof DOMException && error.name === 'AbortError')) {
          return;
        }

        setReferenceArtifacts([]);
        setContentArtifactCount(0);
        setStatus('error');
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [currentSessionId, debouncedRefreshNonce, gatewayUrl, reloadKey, token]);

  // 消息数变化只做去抖补拉：流式输出期间不逐条打网关。
  //
  // 切换会话时消息数会跳变，但那不是「新产物产生」，必须排除，否则切换一次
  // 会话反而多打两遍 /artifacts：
  // - `sessionChanged`：会话边界，跳变来自另一个会话的快照，立即路径已拉过。
  // - `previousMessageCount === 0`：从空态被快照填充（无缓存切换路径会先
  //   `setMessages([])` 再填充），跳变不代表新产物。
  // 两者之外才是真正的流式追加 / 新消息落地，走去抖补拉。
  const lastSessionIdRef = useRef<string | null>(null);
  const lastMessageCountRef = useRef<number | null>(null);
  useEffect(() => {
    if (!currentSessionId || !token) {
      lastSessionIdRef.current = null;
      lastMessageCountRef.current = null;
      return;
    }

    const sessionChanged = lastSessionIdRef.current !== currentSessionId;
    lastSessionIdRef.current = currentSessionId;
    const previousMessageCount = lastMessageCountRef.current;
    lastMessageCountRef.current = messageCount;

    if (sessionChanged || previousMessageCount === null || previousMessageCount === 0) {
      return;
    }

    const handle = window.setTimeout(() => {
      setDebouncedRefreshNonce((value) => value + 1);
    }, ARTIFACT_REFRESH_DEBOUNCE_MS);

    return () => window.clearTimeout(handle);
  }, [currentSessionId, messageCount, token]);

  return {
    referenceArtifacts,
    contentArtifactCount,
    status,
  };
}
