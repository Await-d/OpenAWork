/**
 * 260516-team-page-v2 · feature flag 切换器（T-12 阶段：V2 默认启用）
 *
 * 根据 feature flag 决定渲染新 TeamPageV2 还是旧 TeamPage（fallback）。
 *
 * **默认行为已切换为 V2**（T-12 完成后）。
 *
 * 切换方式：
 *   - 默认：渲染 TeamPageV2（新布局）
 *   - localStorage['teamV2.enabled'] = '0' → 显式回退到旧 TeamPage
 *   - VITE_OPENAWORK_TEAM_V2_LAYOUT = '0' → 构建期回退（影响所有用户）
 *
 * 旧布局保留作为 1-2 周观察期 fallback，验证 V2 稳定后会在 T-12b 中物理删除。
 *
 * 备份位置：`.backup/team-page-v1/`
 */

import { useState, useEffect } from 'react';
import TeamPage from '../TeamPage.js';
import TeamPageV2 from './TeamPageV2.js';

/**
 * 判断是否启用 V2 布局。
 *
 * V2 现已成为默认布局。仅当用户显式设置 `localStorage['teamV2.enabled']='0'`
 * 或构建期注入 `VITE_OPENAWORK_TEAM_V2_LAYOUT='0'` 时才回退到旧布局。
 */
export function isTeamV2LayoutDefault(): boolean {
  if (typeof window === 'undefined') return true;
  const ls = window.localStorage.getItem('teamV2.enabled');
  if (ls === '0') return false;
  if (ls === '1') return true;
  const importMeta = import.meta as unknown as { env?: Record<string, string | undefined> };
  const envFlag = importMeta.env?.['VITE_OPENAWORK_TEAM_V2_LAYOUT'];
  if (envFlag === '0') return false;
  // 默认启用 V2
  return true;
}

export default function TeamPageDispatcher() {
  const [v2Enabled, setV2Enabled] = useState<boolean>(() => isTeamV2LayoutDefault());

  // 监听 storage 变化，让用户在 settings 切换 flag 后立刻生效
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handler = (e: StorageEvent) => {
      if (e.key === 'teamV2.enabled') {
        setV2Enabled(isTeamV2LayoutDefault());
      }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);

  return v2Enabled ? <TeamPageV2 /> : <TeamPage />;
}
