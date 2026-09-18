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
      try {
        const result = await teamClient.getRuntimeResult(accessToken);
        if (cancelled) return;
        if (result.ok && result.runtime) {
          setGlobalSessions(result.runtime.sessions);
        }
      } catch {
        // 全局 sessions 加载失败不影响主流程，侧边栏回退到当前工作区数据
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
      try {
        const result = await teamClient.getRuntimeResult(accessToken);
        if (cancelled) return;
        if (result.ok && result.runtime) {
          setGlobalSessions(result.runtime.sessions);
        }
      } catch {
        // 轮询失败不影响已有数据
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accessToken, teamClient, globalSessionsTick]);

  return globalSessions;
}
