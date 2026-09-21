import { useEffect, useMemo, useState } from 'react';
import { useUIStateStore } from '../../../stores/ui/uiState.js';
import { ReviewPanelArtifactSection } from './ReviewPanelArtifactSection.js';
import { ReviewPanelDiffPreview } from './ReviewPanelDiffPreview.js';
import './ReviewPanelContent.css';
import { ReviewPanelEmptyState } from './ReviewPanelEmptyState.js';
import { ReviewPanelFileList } from './ReviewPanelFileList.js';
import { ReviewPanelHeader } from './ReviewPanelHeader.js';
import { ReviewPanelMutationFeedback } from './ReviewPanelMutationFeedback.js';
import {
  REVIEW_PANEL_SECTION_OPTIONS,
  formatReviewPanelArtifactsStatus,
  formatReviewPanelSectionLabel,
  type ReviewPanelSection,
} from './review-panel-artifact-model.js';
import {
  type ChangeScope,
  type DiffViewMode,
  type ReviewPanelContentState,
  formatReviewPanelStatus,
  selectReviewPanelFiles,
  selectReviewPanelPendingFiles,
} from './review-panel-model.js';
import { useReviewPanelArtifacts } from './useReviewPanelArtifacts.js';
import { useReviewPanelFileActions } from './use-review-panel-file-actions.js';

export interface FusionReviewTabProps {
  readonly changeScope: ChangeScope;
  readonly diffViewMode: DiffViewMode;
  readonly gatewayUrl: string;
  readonly onChangeScope: (scope: ChangeScope) => void;
  readonly onChangeViewMode: (mode: DiffViewMode) => void;
  readonly onReviewMutated: () => void;
  readonly revision: number;
  readonly sessionId: string | null;
  readonly state: ReviewPanelContentState;
  readonly token: string | null;
}

export function FusionReviewTab({
  changeScope,
  diffViewMode,
  gatewayUrl,
  onChangeScope,
  onChangeViewMode,
  onReviewMutated,
  revision,
  sessionId,
  state,
  token,
}: FusionReviewTabProps) {
  const reviewPanelOpened = useUIStateStore((s) => s.reviewPanelOpened);
  const toggleReviewPanelOpened = useUIStateStore((s) => s.toggleReviewPanelOpened);
  const activeState: ReviewPanelContentState = reviewPanelOpened
    ? state
    : { kind: 'waiting', message: '等待会话上下文' };
  const files = useMemo(
    () =>
      activeState.kind === 'ready'
        ? selectReviewPanelFiles(activeState.projection, changeScope)
        : [],
    [activeState, changeScope],
  );
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [reviewSection, setReviewSection] = useState<ReviewPanelSection>('files');

  useEffect(() => {
    setSelectedFilePath((previous) =>
      previous && files.some((file) => file.file === previous)
        ? previous
        : (files[0]?.file ?? null),
    );
  }, [files]);

  const actions = useReviewPanelFileActions({
    files,
    gatewayUrl,
    onRefetch: onReviewMutated,
    revision,
    sessionId,
    token,
  });

  const artifacts = useReviewPanelArtifacts({
    gatewayUrl,
    opened: reviewPanelOpened,
    revision,
    sessionId,
    token,
  });

  const selectedFile = files.find((file) => file.file === selectedFilePath) ?? files[0] ?? null;
  const status =
    reviewSection === 'artifacts'
      ? formatReviewPanelArtifactsStatus(artifacts.artifactsState)
      : formatReviewPanelStatus(activeState, changeScope);
  const actionableCount = selectReviewPanelPendingFiles(files).length;

  const sectionCounts: Record<ReviewPanelSection, number | null> = {
    artifacts:
      artifacts.artifactsState.kind === 'ready' ? artifacts.artifactsState.artifacts.length : null,
    files: activeState.kind === 'ready' ? files.length : null,
  };
  const sectionSwitcher = (
    <div role="group" aria-label="审查分区" className="review-panel-header__segmented-group">
      {REVIEW_PANEL_SECTION_OPTIONS.map((option) => {
        const active = reviewSection === option.value;
        const className = active
          ? 'review-panel-header__segmented-button review-panel-header__segmented-button--active'
          : 'review-panel-header__segmented-button';

        return (
          <button
            key={option.value}
            aria-pressed={active}
            className={className}
            onClick={() => setReviewSection(option.value)}
            type="button"
          >
            {formatReviewPanelSectionLabel(option.label, sectionCounts[option.value])}
          </button>
        );
      })}
    </div>
  );

  return (
    <>
      <ReviewPanelHeader
        bulkActionableCount={actionableCount}
        bulkPending={actions.bulkPending}
        changeScope={changeScope}
        diffViewMode={diffViewMode}
        onAcceptAll={actions.acceptAll}
        onChangeScope={onChangeScope}
        onChangeViewMode={onChangeViewMode}
        onClose={toggleReviewPanelOpened}
        onRejectAll={actions.rejectAll}
        sectionSwitcher={sectionSwitcher}
        showDiffControls={reviewSection === 'files'}
        status={status}
      />
      <div className="fusion-side-panel__review-body">
        {reviewSection === 'artifacts' ? (
          <ReviewPanelArtifactSection
            artifactsState={artifacts.artifactsState}
            onReload={artifacts.reload}
            onSelectArtifact={artifacts.selectArtifact}
            preview={artifacts.preview}
            selectedArtifact={artifacts.selectedArtifact}
            sessionId={sessionId}
          />
        ) : activeState.kind === 'ready' ? (
          <>
            {actions.feedback ? (
              <ReviewPanelMutationFeedback
                busy={actions.busy}
                feedback={actions.feedback}
                onDismiss={actions.dismissFeedback}
                onRetryWithForce={actions.retryWithForce}
              />
            ) : null}
            <div className="fusion-side-panel__review-split">
              <ReviewPanelFileList
                actionsDisabled={actions.busy}
                changeScope={changeScope}
                files={files}
                isFilePending={actions.isFilePending}
                onAcceptFile={actions.acceptFile}
                onRejectFile={actions.rejectFile}
                onSelectFilePath={setSelectedFilePath}
                selectedFile={selectedFile}
              />
              <ReviewPanelDiffPreview diffViewMode={diffViewMode} selectedFile={selectedFile} />
            </div>
          </>
        ) : (
          <ReviewPanelEmptyState>
            {activeState.kind === 'loading' ? '正在加载文件变更...' : activeState.message}
          </ReviewPanelEmptyState>
        )}
      </div>
    </>
  );
}
