/**
 * team-conversation-view-top-bar · `<TeamConversationView/>` 默认 topBar 插槽
 *
 * classic 工作台直接透传外层 topBar；否则渲染 reception 运行横幅 / 其它层
 * substate 进度条，右侧挂待处理交互 chip 与视图模式切换。
 */

import type { ReactNode } from 'react';
import type { TeamRuntimeDiagnostics } from '@openAwork/web-client';
import type { SessionStateStatus } from '../../../components/conversation-runtime/session/session-runtime.js';
import { TeamRunStateBanner } from './extras/TeamRunStateBanner.js';
import { TeamPendingInteractionChip } from './extras/TeamPendingInteractionChip.js';
import { TeamSubstateProgressBar } from './extras/TeamSubstateProgressBar.js';
import {
  TeamViewModeToggle,
  type MultiLayerViewMode,
  type ViewMode,
} from './extras/TeamViewModeToggle.js';

export interface TeamConversationViewTopBarProps {
  activePendingPermissionCount: number;
  clarificationPendingCount: number;
  classicWorkbench: boolean;
  diagnostics: TeamRuntimeDiagnostics | undefined;
  dualDisabled: boolean;
  multiLayerMode: MultiLayerViewMode;
  onFocusPendingInteraction: () => void;
  onMultiLayerModeChange: (mode: MultiLayerViewMode) => void;
  onViewModeChange: (mode: ViewMode) => void;
  roleLayer: string | null;
  sessionId: string;
  sessionStateStatus: SessionStateStatus | null;
  substate: string | null;
  topBar?: ReactNode;
  viewMode: ViewMode;
}

export function TeamConversationViewTopBar({
  activePendingPermissionCount,
  clarificationPendingCount,
  classicWorkbench,
  diagnostics,
  dualDisabled,
  multiLayerMode,
  onFocusPendingInteraction,
  onMultiLayerModeChange,
  onViewModeChange,
  roleLayer,
  sessionId,
  sessionStateStatus,
  substate,
  topBar,
  viewMode,
}: TeamConversationViewTopBarProps) {
  if (classicWorkbench) {
    return topBar ?? null;
  }

  return (
    <>
      {topBar ??
        (roleLayer === 'reception' ? (
          <TeamRunStateBanner
            diagnostics={diagnostics}
            receptionStateStatus={sessionStateStatus}
            sessionId={sessionId}
            rightSlot={
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <TeamPendingInteractionChip
                  pendingPermissionCount={activePendingPermissionCount}
                  pendingClarificationCount={clarificationPendingCount}
                  onClick={onFocusPendingInteraction}
                />
                <TeamViewModeToggle
                  viewMode={viewMode}
                  multiLayerMode={multiLayerMode}
                  dualDisabled={dualDisabled}
                  onViewModeChange={onViewModeChange}
                  onMultiLayerModeChange={onMultiLayerModeChange}
                />
              </div>
            }
          />
        ) : (
          <TeamSubstateProgressBar
            roleLayer={roleLayer}
            substate={substate}
            stateStatus={sessionStateStatus}
            rightSlot={
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <TeamPendingInteractionChip
                  pendingPermissionCount={activePendingPermissionCount}
                  pendingClarificationCount={clarificationPendingCount}
                  onClick={onFocusPendingInteraction}
                />
                <TeamViewModeToggle
                  viewMode={viewMode}
                  multiLayerMode={multiLayerMode}
                  dualDisabled={dualDisabled}
                  onViewModeChange={onViewModeChange}
                  onMultiLayerModeChange={onMultiLayerModeChange}
                />
              </div>
            }
          />
        ))}
    </>
  );
}
