import { UnifiedCodeDiff } from '@openAwork/shared-ui';
import type { SessionFileDiffEntry } from '@openAwork/web-client';
import type { DiffViewMode } from './review-panel-model.js';
import { formatGuaranteeLevel, formatSourceKind } from './review-panel-model.js';
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
        <>
          <div className="review-panel-diff-preview__meta">
            <span>{formatSourceKind(selectedFile.sourceKind)}</span>
            <span>{formatGuaranteeLevel(selectedFile.guaranteeLevel)}</span>
            <span>{selectedFile.toolName ?? '未知工具'}</span>
          </div>
          <UnifiedCodeDiff
            afterText={selectedFile.after}
            beforeText={selectedFile.before}
            chrome="minimal"
            filePath={selectedFile.file}
            maxHeight={320}
            viewMode={diffViewMode}
          />
        </>
      ) : (
        <ReviewPanelEmptyState>选择文件后查看 Diff。</ReviewPanelEmptyState>
      )}
    </section>
  );
}
