import { useEffect, useState } from 'react';
import { createSessionsClient, type Session } from '@openAwork/web-client';

/**
 * 「投递到会话」选择器的数据源。
 *
 * 只在**弹层打开时**拉取（`enabled`），页面本身不多一次请求；网关的
 * `GET /sessions` 一次最多回 100 条（无 offset 分页），对"挑一个最近会话"够用，
 * 关键词过滤在本地做（也避免每敲一个字打一次接口）。
 */
export interface SessionOption {
  id: string;
  title: string;
  updatedAt: number | null;
}

interface SessionOptionsResult {
  sessions: SessionOption[];
  loading: boolean;
  error: string | null;
}

function toOptions(list: Session[]): SessionOption[] {
  return list
    .map((session) => ({
      id: session.id,
      title: session.title?.trim().length ? session.title.trim() : '(未命名会话)',
      updatedAt: session.updatedAt ?? null,
    }))
    .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0));
}

export function useSessionOptions(options: {
  enabled: boolean;
  gatewayUrl: string;
  token: string | null;
}): SessionOptionsResult {
  const { enabled, gatewayUrl, token } = options;
  const [sessions, setSessions] = useState<SessionOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || token === null) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const list = await createSessionsClient(gatewayUrl).list(token);
        if (cancelled) return;
        setSessions(toOptions(list));
      } catch (reason) {
        if (cancelled) return;
        setError(reason instanceof Error ? reason.message : '读取会话列表失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, gatewayUrl, token]);

  return { sessions, loading, error };
}
