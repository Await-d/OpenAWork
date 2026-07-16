import { useState } from 'react';
import type { WorkspaceFileTreePanelProps } from '../../../components/layout/sidebar/WorkspaceFileTreePanel.js';
import type { ChatContextUsageSnapshot } from '../../../components/conversation-runtime/messages/context-usage.js';
import type { WorkspaceFileMentionItem } from '../../../components/conversation-runtime/messages/support.js';
import './FusionSessionSidePanel.css';
import { FusionContextTab } from './FusionContextTab.js';
import type {
  FusionContextOverviewProps,
  FusionContextRuntimeSummary,
} from './FusionContextTab.js';
import { FusionFilesTab } from './FusionFilesTab.js';
import type { FusionFilesEditorState } from './FusionFilesTab.js';
import { FusionReviewTab } from './FusionReviewTab.js';
import { SessionSidePanel } from './SessionSidePanel.js';
import type { SidePanelTabId } from './SessionSidePanel.js';
import type { ChangeScope, DiffViewMode } from './review-panel-model.js';
import { useReviewPanelFileChanges } from './use-review-panel-file-changes.js';

export interface FusionSessionSidePanelProps {
  readonly activeEditorFilePath: string | null;
  readonly activeTab: SidePanelTabId;
  readonly contextUsageSnapshot: ChatContextUsageSnapshot | null;
  readonly currentSessionId: string | null;
  readonly editorMode: boolean;
  readonly editorFileState: FusionFilesEditorState;
  readonly editorOpenFilePaths: readonly string[];
  readonly effectiveWorkingDirectory: string | null;
  readonly fetchTree: WorkspaceFileTreePanelProps['fetchTree'];
  readonly gatewayUrl: string;
  readonly handleSaveFile: (path: string) => Promise<void>;
  readonly onCompactSession: () => void;
  readonly onOpenFileInEditor: (path: string) => void;
  readonly onOpenWorkspace: () => void;
  readonly onShowEditor: () => void;
  readonly onTabChange: (tab: SidePanelTabId) => void;
  readonly overview?: FusionContextOverviewProps;
  readonly runtimeSummary?: FusionContextRuntimeSummary;
  readonly saving: boolean;
  readonly token: string | null;
  readonly workspaceFileItems: readonly WorkspaceFileMentionItem[];
}

export function FusionSessionSidePanel({
  activeEditorFilePath,
  activeTab,
  contextUsageSnapshot,
  currentSessionId,
  editorMode,
  editorFileState,
  editorOpenFilePaths,
  effectiveWorkingDirectory,
  fetchTree,
  gatewayUrl,
  handleSaveFile,
  onCompactSession,
  onOpenFileInEditor,
  onOpenWorkspace,
  onShowEditor,
  onTabChange,
  overview,
  runtimeSummary,
  saving,
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
          activeEditorFilePath={activeEditorFilePath}
          editorMode={editorMode}
          editorFileState={editorFileState}
          editorOpenFilePaths={editorOpenFilePaths}
          effectiveWorkingDirectory={effectiveWorkingDirectory}
          fetchTree={fetchTree}
          handleSaveFile={handleSaveFile}
          onOpenFileInEditor={onOpenFileInEditor}
          onOpenWorkspace={onOpenWorkspace}
          onShowEditor={onShowEditor}
          saving={saving}
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
