import { useEffect, useState } from 'react';
import type { TeamClient, TeamRuntimeSessionRecord } from '@openAwork/web-client';
import { useTeamEventsConnectionStore } from '../../../../stores/team/team-events.js';

export function useGlobalTeamRuntimeSessions(
  accessToken: string | null,
  teamClient: TeamClient,
): TeamRuntimeSessionRecord[] {
  const teamEventsRecoveredAt = useTeamEventsConnectionStore((state) => state.lastRecoveredAt);
  const [globalSessions, setGlobalSessions] = useState<TeamRuntimeSessionRecord[]>([]);
  useEffect(() => {
    if (!accessToken) {
      setGlobalSessions([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      // try 里只留请求本身：`result.ok && result.runtime` 是值块，留在 try 内会让编译器报
      // "Support value blocks ... within a try/catch statement"。
      let result: Awaited<ReturnType<typeof teamClient.getRuntimeResult>> | null = null;
      try {
        result = await teamClient.getRuntimeResult(accessToken);
      } catch {
        // 全局 sessions 加载失败不影响主流程，侧边栏回退到当前工作区数据
      }
      if (cancelled || !result) return;
      if (result.ok && result.runtime) {
        setGlobalSessions(result.runtime.sessions);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accessToken, teamClient, teamEventsRecoveredAt]);

  const [globalSessionsTick, setGlobalSessionsTick] = useState(0);
  useEffect(() => {
    if (!accessToken) return undefined;
    const intervalId = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      setGlobalSessionsTick((v) => v + 1);
    }, 30_000);
    return () => window.clearInterval(intervalId);
  }, [accessToken]);

  useEffect(() => {
    if (!accessToken || globalSessionsTick === 0) return;
    let cancelled = false;
    void (async () => {
      // 同上：try 里只留请求，值块判定移到 try 外。
      let result: Awaited<ReturnType<typeof teamClient.getRuntimeResult>> | null = null;
      try {
        result = await teamClient.getRuntimeResult(accessToken);
      } catch {
        // 轮询失败不影响已有数据
      }
      if (cancelled || !result) return;
      if (result.ok && result.runtime) {
        setGlobalSessions(result.runtime.sessions);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accessToken, teamClient, globalSessionsTick]);

  return globalSessions;
}
