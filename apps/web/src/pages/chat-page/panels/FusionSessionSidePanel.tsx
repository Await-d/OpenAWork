import { useState } from 'react';
import type { ChatContextUsageSnapshot } from '../../../components/conversation-runtime/messages/context-usage.js';
import type { WorkspaceFileMentionItem } from '../../../components/conversation-runtime/messages/support.js';
import './FusionSessionSidePanel.css';
import { FusionContextTab } from './FusionContextTab.js';
import type {
  FusionContextOverviewProps,
  FusionContextRuntimeSummary,
} from './FusionContextTab.js';
import { FusionFilesTab } from './FusionFilesTab.js';
import { FusionReviewTab } from './FusionReviewTab.js';
import { SessionSidePanel } from './SessionSidePanel.js';
import type { SidePanelTabId } from './SessionSidePanel.js';
import type { ChangeScope, DiffViewMode } from './review-panel-model.js';
import { useReviewPanelFileChanges } from './use-review-panel-file-changes.js';

export interface FusionSessionSidePanelProps {
  readonly activeTab: SidePanelTabId;
  readonly contextUsageSnapshot: ChatContextUsageSnapshot | null;
  readonly currentSessionId: string | null;
  readonly effectiveWorkingDirectory: string | null;
  readonly gatewayUrl: string;
  readonly onCompactSession: () => void;
  readonly onOpenWorkspace: () => void;
  readonly onTabChange: (tab: SidePanelTabId) => void;
  readonly overview?: FusionContextOverviewProps;
  readonly runtimeSummary?: FusionContextRuntimeSummary;
  readonly token: string | null;
  readonly workspaceFileItems: readonly WorkspaceFileMentionItem[];
}

export function FusionSessionSidePanel({
  activeTab,
  contextUsageSnapshot,
  currentSessionId,
  effectiveWorkingDirectory,
  gatewayUrl,
  onCompactSession,
  onOpenWorkspace,
  onTabChange,
  overview,
  runtimeSummary,
  token,
  workspaceFileItems,
}: FusionSessionSidePanelProps) {
  const reviewState = useReviewPanelFileChanges({
    gatewayUrl,
    opened: true,
    sessionId: currentSessionId,
    token,
  });
  const reviewCount = reviewState.kind === 'ready' ? reviewState.projection.fileDiffs.length : 0;
  const [changeScope, setChangeScope] = useState<ChangeScope>('all');
  const [diffViewMode, setDiffViewMode] = useState<DiffViewMode>('unified');

  return (
    <SessionSidePanel
      activeTab={activeTab}
      onAddFile={onOpenWorkspace}
      onTabChange={onTabChange}
      reviewCount={reviewCount}
    >
      {activeTab === 'review' ? (
        <FusionReviewTab
          changeScope={changeScope}
          diffViewMode={diffViewMode}
          onChangeScope={setChangeScope}
          onChangeViewMode={setDiffViewMode}
          state={reviewState}
        />
      ) : activeTab === 'files' ? (
        <FusionFilesTab
          effectiveWorkingDirectory={effectiveWorkingDirectory}
          onOpenWorkspace={onOpenWorkspace}
          workspaceFileItems={workspaceFileItems}
        />
      ) : (
        <FusionContextTab
          contextUsageSnapshot={contextUsageSnapshot}
          currentSessionId={currentSessionId}
          effectiveWorkingDirectory={effectiveWorkingDirectory}
          onCompactSession={onCompactSession}
          overview={overview}
          runtimeSummary={runtimeSummary}
          workspaceFileItems={workspaceFileItems}
        />
      )}
    </SessionSidePanel>
  );
}
