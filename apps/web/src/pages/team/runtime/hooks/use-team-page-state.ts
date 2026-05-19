/**
 * 260516-team-page-v2 · T-13 / T-14
 *
 * Team 页面级状态机 + 响应式断点 hook。
 *
 * 三态：
 *   - 'idle'：无活跃任务（启动状态，引导式 UI）
 *   - 'running'：有任务运行中（默认状态）
 *   - 'paused'：用户暂停了所有任务（最小化 UI，强提示恢复）
 *
 * 断点：
 *   - 'mobile'：< 768px（隐藏 3D，右面板底部上滑）
 *   - 'tablet'：768-1023px（右面板覆盖式抽屉）
 *   - 'desktop'：≥ 1024px（左主区 + 右面板并排）
 */

import { useEffect, useState } from 'react';
import { useHandoffStore } from '../../../../stores/team/team-events.js';
import { useTeamNotificationStore } from '../../../../stores/team/team-events.js';

export type TeamPageMode = 'idle' | 'running' | 'paused';
export type TeamPageBreakpoint = 'mobile' | 'tablet' | 'desktop';

const PAUSED_FLAG_KEY = 'teamV2.paused';

export function useTeamPageMode(): TeamPageMode {
  const handoffs = useHandoffStore((s) => s.handoffs);
  const [paused, setPaused] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(PAUSED_FLAG_KEY) === '1';
  });

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handler = (e: StorageEvent) => {
      if (e.key === PAUSED_FLAG_KEY) {
        setPaused(e.newValue === '1');
      }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);

  if (paused) return 'paused';

  // 任何活跃 handoff 都视为 running
  for (const h of handoffs.values()) {
    if (h.state === 'pending' || h.state === 'running' || h.state === 'claimed') {
      return 'running';
    }
  }

  return 'idle';
}

export function setTeamPagePaused(paused: boolean): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(PAUSED_FLAG_KEY, paused ? '1' : '0');
  // 触发同窗口的 storage 事件（默认不会触发，需要手动）
  window.dispatchEvent(
    new StorageEvent('storage', {
      key: PAUSED_FLAG_KEY,
      newValue: paused ? '1' : '0',
    }),
  );
}

export function useBreakpoint(): TeamPageBreakpoint {
  const [bp, setBp] = useState<TeamPageBreakpoint>(() => {
    if (typeof window === 'undefined') return 'desktop';
    const w = window.innerWidth;
    if (w < 768) return 'mobile';
    if (w < 1024) return 'tablet';
    return 'desktop';
  });

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handler = () => {
      const w = window.innerWidth;
      if (w < 768) setBp('mobile');
      else if (w < 1024) setBp('tablet');
      else setBp('desktop');
    };
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  return bp;
}

/** 通知 store 中的最近事件（用于推断 ETA / 异常状态） */
export function useLatestEventTimestamp(): number | null {
  const events = useTeamNotificationStore((s) => s.events);
  return events.length > 0 ? (events[events.length - 1]?.timestamp ?? null) : null;
}
