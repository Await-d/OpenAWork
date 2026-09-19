import { UnifiedCodeDiff } from '@openAwork/shared-ui';
import type { SessionFileDiffEntry } from '@openAwork/web-client';
import type { DiffViewMode } from './review-panel-model.js';
import { ReviewPanelEmptyState } from './ReviewPanelEmptyState.js';

export function ReviewPanelDiffPreview({
  diffViewMode,
  selectedFile,
}: {
  readonly diffViewMode: DiffViewMode;
  readonly selectedFile: SessionFileDiffEntry | null;
}) {
  return (
    <section aria-label="Diff 预览" className="review-panel-diff-preview">
      {selectedFile ? (
        <UnifiedCodeDiff
          afterText={selectedFile.after}
          beforeText={selectedFile.before}
          chrome="minimal"
          maxHeight={320}
          revealFirstChange
          viewMode={diffViewMode}
        />
      ) : (
        <ReviewPanelEmptyState>选择文件后查看 Diff。</ReviewPanelEmptyState>
      )}
    </section>
  );
}
