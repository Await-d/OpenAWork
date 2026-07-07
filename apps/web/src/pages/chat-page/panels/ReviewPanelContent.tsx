import { useEffect, useMemo, useState } from 'react';
import './ReviewPanelContent.css';
import { ReviewPanelDiffPreview } from './ReviewPanelDiffPreview.js';
import { ReviewPanelEmptyState } from './ReviewPanelEmptyState.js';
import { ReviewPanelFileList } from './ReviewPanelFileList.js';
import { ReviewPanelStats } from './ReviewPanelStats.js';
import {
  selectReviewPanelFiles,
  type ChangeScope,
  type DiffViewMode,
  type ReviewPanelContentState,
} from './review-panel-model.js';

export interface ReviewPanelContentProps {
  readonly changeScope: ChangeScope;
  readonly diffViewMode: DiffViewMode;
  readonly state: ReviewPanelContentState;
}

export function ReviewPanelContent({ changeScope, diffViewMode, state }: ReviewPanelContentProps) {
  const projection = state.kind === 'ready' ? state.projection : null;
  const files = useMemo(() => {
    if (!projection) {
      return [];
    }

    return selectReviewPanelFiles(projection, changeScope);
  }, [changeScope, projection]);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);

  useEffect(() => {
    setSelectedFilePath((previous) => {
      if (previous && files.some((file) => file.file === previous)) {
        return previous;
      }
      return files[0]?.file ?? null;
    });
  }, [files]);

  const selectedFile = files.find((file) => file.file === selectedFilePath) ?? files[0] ?? null;
  const scopedAdditions = files.reduce((sum, file) => sum + file.additions, 0);
  const scopedDeletions = files.reduce((sum, file) => sum + file.deletions, 0);

  if (state.kind === 'waiting') {
    return <ReviewPanelEmptyState>{state.message}</ReviewPanelEmptyState>;
  }

  if (state.kind === 'loading') {
    return <ReviewPanelEmptyState>正在加载文件变更…</ReviewPanelEmptyState>;
  }

  if (state.kind === 'error') {
    return <ReviewPanelEmptyState>{state.message}</ReviewPanelEmptyState>;
  }

  return (
    <>
      <ReviewPanelStats
        additions={scopedAdditions}
        deletions={scopedDeletions}
        fileCount={files.length}
      />
      <ReviewPanelFileList
        changeScope={changeScope}
        files={files}
        selectedFile={selectedFile}
        onSelectFilePath={setSelectedFilePath}
      />
      <ReviewPanelDiffPreview diffViewMode={diffViewMode} selectedFile={selectedFile} />
    </>
  );
}
