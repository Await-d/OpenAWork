/**
 * team 页 3D 办公场景全屏视图（纯展示组件）。
 *
 * 把 useTeamOfficeScene 的场景状态接到 OfficeThreeCanvas 上；TeamPageV2 只负责在树中
 * 摆放，全屏开关 / ESC 退出与场景状态的接线细节在上层 hook 与调用方。
 */

import { OfficeThreeCanvas } from '../runtime/tabs/office/OfficeThreeCanvas.js';
import type { OfficeSceneState } from '../runtime/tabs/office/OfficeScene.js';
import type { AgentTeamsSidebarTeam } from '../runtime/data/team-runtime-types.js';

export interface TeamPageOfficeSceneProps {
  /** 3D 场景状态（缩放 / 平移 / 画布 ref）。 */
  readonly officeSceneState: OfficeSceneState;
  readonly selectedAgentId: string;
  readonly runtimeStatus: AgentTeamsSidebarTeam['status'] | null;
  readonly selectedSessionTitle: string | null;
  readonly onSelectAgent: (agentId: string) => void;
  /** 退出全屏（ESC 关闭按钮）。 */
  readonly onExitFullscreen: () => void;
}

export function TeamPageOfficeScene({
  officeSceneState,
  selectedAgentId,
  runtimeStatus,
  selectedSessionTitle,
  onSelectAgent,
  onExitFullscreen,
}: TeamPageOfficeSceneProps) {
  return (
    <div
      className="team-v2-fullscreen-shell"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        display: 'flex',
        flexDirection: 'column',
      }}
      role="dialog"
      aria-label="3D 全屏视图"
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          padding: '8px 16px',
          borderBottom: '1px solid var(--border-default)',
          flexShrink: 0,
        }}
      >
        <button
          type="button"
          onClick={onExitFullscreen}
          style={{
            padding: '6px 14px',
            borderRadius: 8,
            border: '1px solid color-mix(in srgb, var(--border-default) 60%, transparent)',
            background: 'var(--bg-overlay)',
            color: 'var(--fg-strong)',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
          }}
          aria-label="关闭全屏"
        >
          ESC 关闭
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <OfficeThreeCanvas
          selectedAgentId={selectedAgentId}
          runtimeStatus={runtimeStatus}
          selectedSessionTitle={selectedSessionTitle}
          onSelectAgent={onSelectAgent}
          state={officeSceneState}
        />
      </div>
    </div>
  );
}
