import { useEffect, useMemo, useState } from 'react';
import { useUIStateStore } from '../../../stores/ui/uiState.js';
import { ReviewPanelDiffPreview } from './ReviewPanelDiffPreview.js';
import './ReviewPanelContent.css';
import { ReviewPanelEmptyState } from './ReviewPanelEmptyState.js';
import { ReviewPanelFileList } from './ReviewPanelFileList.js';
import { ReviewPanelHeader } from './ReviewPanelHeader.js';
import { ReviewPanelStats } from './ReviewPanelStats.js';
import {
  type ChangeScope,
  type DiffViewMode,
  type ReviewPanelContentState,
  formatReviewPanelStatus,
  selectReviewPanelFiles,
} from './review-panel-model.js';

export interface FusionReviewTabProps {
  readonly changeScope: ChangeScope;
  readonly diffViewMode: DiffViewMode;
  readonly onChangeScope: (scope: ChangeScope) => void;
  readonly onChangeViewMode: (mode: DiffViewMode) => void;
  readonly state: ReviewPanelContentState;
}

export function FusionReviewTab({
  changeScope,
  diffViewMode,
  onChangeScope,
  onChangeViewMode,
  state,
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

  useEffect(() => {
    setSelectedFilePath((previous) =>
      previous && files.some((file) => file.file === previous)
        ? previous
        : (files[0]?.file ?? null),
    );
  }, [files]);

  const selectedFile = files.find((file) => file.file === selectedFilePath) ?? files[0] ?? null;
  const additions = files.reduce((sum, file) => sum + file.additions, 0);
  const deletions = files.reduce((sum, file) => sum + file.deletions, 0);
  const status = formatReviewPanelStatus(activeState, changeScope);

  return (
    <>
      <ReviewPanelHeader
        changeScope={changeScope}
        diffViewMode={diffViewMode}
        onChangeScope={onChangeScope}
        onChangeViewMode={onChangeViewMode}
        onClose={toggleReviewPanelOpened}
        status={status}
      />
      <div className="fusion-side-panel__review-body">
        {activeState.kind === 'ready' ? (
          <>
            <ReviewPanelStats
              additions={additions}
              deletions={deletions}
              fileCount={files.length}
            />
            <div className="fusion-side-panel__review-split">
              <ReviewPanelFileList
                changeScope={changeScope}
                files={files}
                selectedFile={selectedFile}
                onSelectFilePath={setSelectedFilePath}
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
