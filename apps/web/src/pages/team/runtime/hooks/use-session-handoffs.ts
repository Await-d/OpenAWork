/**
 * 260517-team-page-v2 · 当前 session 的 handoff 实时拉取
 *
 * 用途：
 *   - 「任务 / 派发包」tab 显示 d→e/f/g 的派发列表与状态
 *   - 「任务 / 评审」tab 读取 d 完成时写回的 review_report.md
 *   - 「任务 / 任务流」tab 高亮 running/failed handoff
 *
 * 实现：
 *   - 首次挂载 + sessionId 变更 → REST GET 拉一次完整列表
 *   - 监听 useHandoffStore 的实时事件流：当受关联的 handoff id 计数有变化
 *     （新增 / 状态切换）时，触发 debounce 重拉一次完整列表，避免每个事件都打网关
 *
 * 退化策略：
 *   - 没登录 / 没 gatewayUrl → 返回空数组与 loading=false
 *   - 网络错误 → 保留上次缓存 + 设置 error，UI 自行判断
 */

import { useEffect, useRef, useState } from 'react';
import {
  createTeamHandoffsClient,
  type HandoffRecord,
  type TeamHandoffsClient,
} from '@openAwork/web-client';
import { useHandoffStore } from '../../../../stores/team/team-events.js';
import { useAuthStore } from '../../../../stores/auth.js';

export interface UseSessionHandoffsResult {
  handoffs: HandoffRecord[];
  loading: boolean;
  error: string | null;
  /** 手动触发重新拉取（例如用户点了「刷新」按钮）。 */
  refresh: () => void;
}

let sharedClient: { url: string; client: TeamHandoffsClient } | null = null;

function getClient(gatewayUrl: string): TeamHandoffsClient {
  if (sharedClient && sharedClient.url === gatewayUrl) return sharedClient.client;
  const client = createTeamHandoffsClient(gatewayUrl);
  sharedClient = { url: gatewayUrl, client };
  return client;
}

/**
 * 计算 store 中与当前 session 关联的 entries 摘要——用作 useEffect 依赖。
 * 同时返回最新的 updatedAt 集合作为「需要重拉」的信号源。
 */
function makeSignature(handoffsMap: Map<string, { updatedAt?: number }>): string {
  let parts: string[] = [];
  for (const [id, entry] of handoffsMap.entries()) {
    parts.push(`${id}:${entry.updatedAt ?? 0}`);
  }
  parts.sort();
  return parts.join('|');
}

export function useSessionHandoffs(sessionId: string | null): UseSessionHandoffsResult {
  const { gatewayUrl, accessToken } = useAuthStore();
  const [records, setRecords] = useState<HandoffRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const realtimeSignature = useHandoffStore((s) => makeSignature(s.handoffs));
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!sessionId || !gatewayUrl || !accessToken) {
      setRecords([]);
      setLoading(false);
      setError(null);
      return;
    }

    const client = getClient(gatewayUrl);
    setLoading(true);
    setError(null);

    void client
      .listHandoffsBySession(accessToken, sessionId)
      .then((list) => {
        if (cancelled) return;
        setRecords(list);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : '加载 handoff 列表失败');
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [sessionId, gatewayUrl, accessToken, reloadTick]);

  // 实时信号：handoff store 有变化时，节流后重拉一次。
  useEffect(() => {
    if (!sessionId || !gatewayUrl || !accessToken) return;
    if (debounceRef.current != null) {
      window.clearTimeout(debounceRef.current);
    }
    debounceRef.current = window.setTimeout(() => {
      setReloadTick((tick) => tick + 1);
    }, 250);
    return () => {
      if (debounceRef.current != null) {
        window.clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [realtimeSignature, sessionId, gatewayUrl, accessToken]);

  return {
    handoffs: records,
    loading,
    error,
    refresh: () => setReloadTick((tick) => tick + 1),
  };
}
