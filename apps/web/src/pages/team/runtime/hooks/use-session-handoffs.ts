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
 *   - 网络异常 / 网关 5xx 时保留上一次成功快照，并按指数退避自动重试
 *   - team-events 重连恢复或浏览器重新联网后，主动补拉一次完整快照
 *
 * 退化策略：
 *   - 没登录 / 没 gatewayUrl → 返回空数组与 loading=false
 *   - 网络错误 → 保留上次缓存 + 设置 error，UI 可继续显示陈旧数据并等待恢复
 */

import { useEffect, useRef, useState } from 'react';
import {
  createTeamHandoffsClient,
  type HandoffRecord,
  type TeamHandoffListBySessionResult,
  type TeamHandoffsClient,
} from '@openAwork/web-client';
import {
  computeExponentialRetryDelay,
  formatRecoverableLoadError,
} from '../../hooks/recoverable-read-model.js';
import { useRecoverableRetryController } from '../../hooks/use-recoverable-retry.js';
import type { HandoffEntry } from '../../../../stores/team/team-events.js';
import {
  useHandoffStore,
  useTeamEventsConnectionStore,
} from '../../../../stores/team/team-events.js';
import { useAuthStore } from '../../../../stores/auth/auth.js';

const SESSION_HANDOFFS_RETRY_BASE_MS = 2_000;
const SESSION_HANDOFFS_RETRY_MAX_MS = 15_000;

export interface UseSessionHandoffsResult {
  applyPreview: (handoffs: HandoffRecord[]) => void;
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
  const parts: string[] = [];
  for (const [id, entry] of handoffsMap.entries()) {
    parts.push(`${id}:${entry.updatedAt ?? 0}`);
  }
  parts.sort();
  return parts.join('|');
}

function sortHandoffs(records: HandoffRecord[]): HandoffRecord[] {
  return [...records].sort((left, right) => left.createdAt.localeCompare(right.createdAt, 'zh-CN'));
}

function isHandoffRelevantToSession(record: HandoffRecord, sessionId: string): boolean {
  return record.fromSessionId === sessionId || record.toSessionId === sessionId;
}

function parseTimestampMs(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function mapHandoffRecordToEntry(record: HandoffRecord): HandoffEntry {
  const updatedAt = parseTimestampMs(record.updatedAt) ?? Date.now();
  return {
    ...(parseTimestampMs(record.completedAt)
      ? { endedAt: parseTimestampMs(record.completedAt) }
      : record.state !== 'running' && record.state !== 'claimed' && record.state !== 'pending'
        ? { endedAt: updatedAt }
        : {}),
    fromSessionId: record.fromSessionId,
    fromRoleLayer: record.fromRoleLayer,
    id: record.id,
    sessionId: record.toSessionId ?? record.fromSessionId,
    startedAt: parseTimestampMs(record.startedAt) ?? parseTimestampMs(record.claimedAt),
    state: record.state,
    toSessionId: record.toSessionId,
    toRoleLayer: record.toRoleLayer,
    ...(record.failureReason !== undefined ? { failureReason: record.failureReason } : {}),
    ...(record.retryCount !== undefined ? { retryCount: record.retryCount } : {}),
    ...(record.recoverableFailure !== undefined
      ? { recoverableFailure: record.recoverableFailure }
      : {}),
    updatedAt,
  };
}

function mergeHandoffStorePreview(preview: HandoffRecord[]): void {
  if (preview.length === 0) {
    return;
  }
  useHandoffStore.setState((state) => {
    const handoffs = new Map(state.handoffs);
    for (const record of preview) {
      handoffs.set(record.id, mapHandoffRecordToEntry(record));
    }
    return { handoffs };
  });
}

export function mergeSessionHandoffsPreview(
  current: HandoffRecord[],
  preview: HandoffRecord[],
  sessionId: string,
): HandoffRecord[] {
  const merged = new Map(current.map((record) => [record.id, record]));
  for (const record of preview) {
    if (isHandoffRelevantToSession(record, sessionId)) {
      merged.set(record.id, record);
      continue;
    }
    merged.delete(record.id);
  }
  return sortHandoffs(
    [...merged.values()].filter((record) => isHandoffRelevantToSession(record, sessionId)),
  );
}

export function computeSessionHandoffsRetryDelay(attempt: number): number {
  return computeExponentialRetryDelay({
    attempt,
    baseMs: SESSION_HANDOFFS_RETRY_BASE_MS,
    maxMs: SESSION_HANDOFFS_RETRY_MAX_MS,
  });
}

export function formatSessionHandoffsLoadError(input: {
  hasCachedSnapshot?: boolean;
  nextRetryAtMs?: number | null;
  result: TeamHandoffListBySessionResult;
}): string {
  return formatRecoverableLoadError({
    baseMessage: input.result.errorMessage ?? '加载 handoff 列表失败。',
    hasRetainedData: input.hasCachedSnapshot ?? true,
    nextRetryAtMs: input.nextRetryAtMs,
    retainedDataLabel: '快照',
    retryable: input.result.retryable,
  });
}

export function useSessionHandoffs(sessionId: string | null): UseSessionHandoffsResult {
  const { gatewayUrl, accessToken } = useAuthStore();
  const [records, setRecords] = useState<HandoffRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const realtimeSignature = useHandoffStore((state) => makeSignature(state.handoffs));
  const teamEventsRecoveredAt = useTeamEventsConnectionStore((state) => state.lastRecoveredAt);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const realtimeReadyRef = useRef(false);
  const {
    clearRetry: clearRetry,
    resetRetry: resetRetry,
    scheduleRetry: scheduleRetry,
  } = useRecoverableRetryController();
  const recordsRef = useRef<HandoffRecord[]>([]);

  useEffect(() => {
    recordsRef.current = records;
  }, [records]);

  useEffect(() => {
    return () => {
      if (debounceRef.current !== null) {
        globalThis.clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    clearRetry();

    if (!sessionId || !gatewayUrl || !accessToken) {
      resetRetry();
      setRecords([]);
      setLoading(false);
      setError(null);
      return;
    }

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      resetRetry();
      setLoading(false);
      setError(
        formatSessionHandoffsLoadError({
          hasCachedSnapshot: recordsRef.current.length > 0,
          result: {
            handoffs: [],
            ok: false,
            retryable: true,
            errorMessage: '当前网络离线，handoff 列表暂时不可用。',
          },
        }),
      );
      return;
    }

    const client = getClient(gatewayUrl);
    setLoading(recordsRef.current.length === 0);
    setError(null);

    void client.listHandoffsBySessionResult(accessToken, sessionId).then((result) => {
      if (cancelled) return;

      if (result.ok) {
        resetRetry();
        setRecords(result.handoffs);
        setLoading(false);
        setError(null);
        return;
      }

      const nextRetryAtMs = scheduleRetry({
        computeDelay: computeSessionHandoffsRetryDelay,
        onRetry: () => {
          setReloadTick((tick) => tick + 1);
        },
        retryable: result.retryable,
      });
      setLoading(false);
      setError(
        formatSessionHandoffsLoadError({
          hasCachedSnapshot: recordsRef.current.length > 0,
          nextRetryAtMs,
          result,
        }),
      );
    });

    return () => {
      cancelled = true;
    };
  }, [sessionId, gatewayUrl, accessToken, reloadTick]);

  // 实时信号：handoff store 有变化时，节流后重拉一次。
  useEffect(() => {
    if (!sessionId || !gatewayUrl || !accessToken) return;
    if (!realtimeReadyRef.current) {
      realtimeReadyRef.current = true;
      return;
    }
    if (debounceRef.current != null) {
      globalThis.clearTimeout(debounceRef.current);
    }
    debounceRef.current = globalThis.setTimeout(() => {
      resetRetry();
      setReloadTick((tick) => tick + 1);
    }, 250);
    return () => {
      if (debounceRef.current != null) {
        globalThis.clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [realtimeSignature, sessionId, gatewayUrl, accessToken]);

  useEffect(() => {
    if (!teamEventsRecoveredAt || !sessionId || !gatewayUrl || !accessToken) {
      return;
    }
    resetRetry();
    setReloadTick((tick) => tick + 1);
  }, [accessToken, gatewayUrl, sessionId, teamEventsRecoveredAt]);

  useEffect(() => {
    if (!sessionId || !gatewayUrl || !accessToken || typeof window === 'undefined') {
      return;
    }
    const handleOnline = () => {
      resetRetry();
      setReloadTick((tick) => tick + 1);
    };
    const handleOffline = () => {
      resetRetry();
      setLoading(false);
      setError(
        formatSessionHandoffsLoadError({
          hasCachedSnapshot: recordsRef.current.length > 0,
          result: {
            handoffs: [],
            ok: false,
            retryable: true,
            errorMessage: '当前网络离线，handoff 列表暂时不可用。',
          },
        }),
      );
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [accessToken, gatewayUrl, sessionId]);

  return {
    applyPreview: (handoffs) => {
      if (!sessionId || handoffs.length === 0) {
        return;
      }
      mergeHandoffStorePreview(handoffs);
      setRecords((current) => mergeSessionHandoffsPreview(current, handoffs, sessionId));
    },
    handoffs: records,
    loading,
    error,
    refresh: () => {
      resetRetry();
      setReloadTick((tick) => tick + 1);
    },
  };
}
