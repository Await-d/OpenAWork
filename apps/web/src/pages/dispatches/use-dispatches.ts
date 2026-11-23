import type { DispatchDetail, DispatchList } from '@openAwork/shared';
import { createDispatchesClient, HttpError } from '@openAwork/web-client';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { usePageActivation } from '../../components/common/routing/CachedRouteOutlet.js';
import { useAuthStore } from '../../stores/auth/auth.js';

const AUTH_EXPIRED = '登录已失效，请重新登录。';

export function dispatchError(error: unknown, fallback: string): string {
  if (!(error instanceof HttpError)) return fallback;
  if (error.status === 401) return AUTH_EXPIRED;
  if (error.status === 404) return '找不到这条记录，或当前网关尚未提供派工功能。';
  return error.message;
}

export function useDispatches(gatewayUrl: string, email: string | null, id?: string) {
  const active = usePageActivation();
  const client = useMemo(() => createDispatchesClient(gatewayUrl), [gatewayUrl]);
  const [page, setPage] = useState<{ list: DispatchList; cursor?: string } | null>(null);
  const [detail, setDetail] = useState<DispatchDetail | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [cursor, setCursor] = useState<string>();
  const reading = useRef<AbortController | null>(null);
  const writing = useRef(false);
  const unauthorized = useRef(false);
  const activeVisit = useRef<object | null>(null);

  useLayoutEffect(() => {
    activeVisit.current = active ? {} : null;
    return () => {
      activeVisit.current = null;
    };
  }, [active, gatewayUrl, email, id]);

  function clearUnauthorized() {
    unauthorized.current = true;
    setPage(null);
    setDetail(null);
    setError(AUTH_EXPIRED);
  }

  function currentToken() {
    const auth = useAuthStore.getState();
    return auth.gatewayUrl === gatewayUrl && auth.email === email ? auth.accessToken : null;
  }

  useEffect(() => {
    if (!active) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;
    const poll = async () => {
      if (closed || document.visibilityState === 'hidden' || reading.current || writing.current)
        return;
      const token = currentToken();
      if (!token) {
        clearUnauthorized();
        return;
      }
      const controller = new AbortController();
      reading.current = controller;
      try {
        const next = await client.list(token, cursor, controller.signal);
        if (controller.signal.aborted) return;
        if (id) {
          const snapshot = await client.detail(token, id, controller.signal);
          if (controller.signal.aborted) return;
          setDetail(snapshot);
        }
        unauthorized.current = false;
        setPage({ list: next, cursor });
        setError('');
      } catch (cause) {
        if (!controller.signal.aborted) {
          if (cause instanceof HttpError && cause.status === 401) clearUnauthorized();
          else setError(dispatchError(cause, '无法刷新派工，请检查网关连接。'));
        }
      } finally {
        if (reading.current === controller) {
          reading.current = null;
          if (!closed) timer = setTimeout(poll, 4000);
        }
      }
    };
    const stop = () => {
      clearTimeout(timer);
      reading.current?.abort();
      reading.current = null;
    };
    const onVisibility = () => {
      stop();
      void poll();
    };
    void poll();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      closed = true;
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [active, client, cursor, email, gatewayUrl, id, refresh]);

  async function mutate(
    operation: (api: typeof client, token: string) => Promise<DispatchDetail>,
    onActiveSuccess?: (snapshot: DispatchDetail) => void | Promise<void>,
  ) {
    const token = currentToken();
    if (!token || unauthorized.current) throw new HttpError(AUTH_EXPIRED, 401);
    const visit = activeVisit.current;
    if (writing.current) throw new HttpError('已有操作正在处理，请稍候。', 429);
    writing.current = true;
    reading.current?.abort();
    setBusy(true);
    try {
      const snapshot = await operation(client, token);
      if (!currentToken())
        throw new HttpError('账户或网关已切换，请在对应账户下查看派工记录。', 401);
      if (id) setDetail(snapshot);
      if (visit && visit === activeVisit.current) await onActiveSuccess?.(snapshot);
      return snapshot;
    } catch (cause) {
      if (cause instanceof HttpError && cause.status === 401) clearUnauthorized();
      throw cause;
    } finally {
      writing.current = false;
      setBusy(false);
      setRefresh((value) => value + 1);
    }
  }

  return {
    list: page?.list ?? null,
    nextCursor: page && page.cursor === cursor ? page.list.nextCursor : null,
    pageLoading: !error && (!page || page.cursor !== cursor),
    detail,
    error,
    busy,
    mutate,
    cursor,
    setCursor,
    reload: () => setRefresh((n) => n + 1),
  };
}
