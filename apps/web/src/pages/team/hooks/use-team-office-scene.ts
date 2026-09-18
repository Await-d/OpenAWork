/**
 * 团队页 3D 办公场景控制 hook。
 *
 * 3D 场景的缩放 / 平移 / 画布 ref（useOfficeSceneState）与「办公全屏」开关需要跨
 * 页体与全屏浮层共享同一份实例：TeamPageV2 把 officeSceneState 交给中间区，同时用它
 * 渲染全屏视图，因此只能在本 hook 里创建一次。全屏开关属于「按会话记忆」，由
 * TeamSessionViewStateControls（useTeamSessionViewState + 本目录 context）持有，
 * 本 hook 不直接读写 localStorage。
 *
 * TeamPageV2 自己渲染 <TeamSessionViewStateProvider>，其组件体不在该 Provider 内
 * （React context 只向下流动），因此调用方需显式注入同一个 viewState 实例；能读到
 * context 的场景优先用 context，保证这两条路径始终只有一份来源。
 */

import { useCallback, useEffect } from 'react';
import { useOfficeSceneState, type OfficeSceneState } from '../runtime/tabs/office/OfficeScene.js';
import { useTeamSessionViewStateContextOptional } from './team-session-view-state-context.js';
import type { TeamSessionViewStateControls } from './use-team-session-view-state.js';

export interface TeamOfficeSceneControls {
  /** 3D 场景状态（缩放 / 平移 / 画布 ref）；中间区与全屏视图共享同一实例。 */
  officeSceneState: OfficeSceneState;
  /** 办公全屏开关（按会话记忆）。 */
  showOfficeFullscreen: boolean;
  /** 退出办公全屏（ESC / 关闭按钮）。 */
  exitOfficeFullscreen: () => void;
}

export function useTeamOfficeScene(input?: {
  /** Provider 外调用（TeamPageV2 自身渲染 Provider）时注入同一 viewState 实例。 */
  readonly viewState?: TeamSessionViewStateControls;
}): TeamOfficeSceneControls {
  const contextViewState = useTeamSessionViewStateContextOptional();
  const viewState = contextViewState ?? input?.viewState;
  if (!viewState) {
    throw new Error(
      'useTeamOfficeScene 必须在 TeamSessionViewStateProvider 内使用，或显式传入 viewState',
    );
  }
  const { showOfficeFullscreen, setShowOfficeFullscreen } = viewState;

  const officeSceneState = useOfficeSceneState();

  const exitOfficeFullscreen = useCallback(() => {
    setShowOfficeFullscreen(false);
  }, [setShowOfficeFullscreen]);

  // 全屏打开时按 ESC 退出（关闭时不下发监听）。
  useEffect(() => {
    if (!showOfficeFullscreen) return;
    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowOfficeFullscreen(false);
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [showOfficeFullscreen, setShowOfficeFullscreen]);

  return { officeSceneState, showOfficeFullscreen, exitOfficeFullscreen };
}
