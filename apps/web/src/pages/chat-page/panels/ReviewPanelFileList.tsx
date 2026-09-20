import type { SessionFileDiffEntry } from '@openAwork/web-client';
import { ReviewPanelFileRowActions } from './ReviewPanelFileActions.js';
import {
  formatFileStatus,
  getReviewPanelFileActionKey,
  type ChangeScope,
} from './review-panel-model.js';
import { ReviewPanelEmptyState } from './ReviewPanelEmptyState.js';

function formatScopeLabel(changeScope: ChangeScope): string {
  return changeScope === 'all' ? '全部轮次' : '当前轮次';
}

function splitFilePath(filePath: string): { readonly dir: string; readonly name: string } {
  const separatorIndex = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  if (separatorIndex < 0) {
    return { dir: '', name: filePath };
  }
  return {
    dir: filePath.slice(0, separatorIndex + 1),
    name: filePath.slice(separatorIndex + 1),
  };
}

function ReviewPanelFileButton({
  file,
  selected,
  onSelect,
}: {
  readonly file: SessionFileDiffEntry;
  readonly onSelect: () => void;
  readonly selected: boolean;
}) {
  const statusLabel = formatFileStatus(file.status);
  const className = selected
    ? 'review-panel-file-button review-panel-file-button--selected'
    : 'review-panel-file-button';
  const { dir, name } = splitFilePath(file.file);

  return (
    <button
      aria-current={selected ? 'true' : undefined}
      aria-label={`${file.file}，${statusLabel}，新增 ${file.additions} 行，删除 ${file.deletions} 行`}
      aria-pressed={selected}
      className={className}
      onClick={onSelect}
      type="button"
    >
      <span className="review-panel-file-button__path" title={file.file}>
        <span className="review-panel-file-button__dir">{dir}</span>
        <span className="review-panel-file-button__name">{name}</span>
      </span>
      <span className="review-panel-file-button__meta">
        <span>{statusLabel}</span>
        <span className="review-panel-file-button__additions">+{file.additions}</span>
        <span className="review-panel-file-button__deletions">-{file.deletions}</span>
        {file.toolName ? <span>{file.toolName}</span> : null}
      </span>
    </button>
  );
}

export function ReviewPanelFileList({
  actionsDisabled,
  changeScope,
  files,
  isFilePending,
  onAcceptFile,
  onRejectFile,
  onSelectFilePath,
  selectedFile,
}: {
  readonly actionsDisabled: boolean;
  readonly changeScope: ChangeScope;
  readonly files: readonly SessionFileDiffEntry[];
  readonly isFilePending: (file: SessionFileDiffEntry) => boolean;
  readonly onAcceptFile: (file: SessionFileDiffEntry) => void;
  readonly onRejectFile: (file: SessionFileDiffEntry) => void;
  readonly onSelectFilePath: (filePath: string) => void;
  readonly selectedFile: SessionFileDiffEntry | null;
}) {
  return (
    <section aria-label="文件变更" className="review-panel-file-list">
      <div className="review-panel-file-list__header">
        <span className="review-panel-file-list__title">文件变更</span>
        <span className="review-panel-file-list__scope">{formatScopeLabel(changeScope)}</span>
      </div>
      {files.length === 0 ? (
        <ReviewPanelEmptyState>
          暂无文件变更
          <br />
          <span className="review-panel-file-list__empty-hint">
            Agent 修改文件后会在这里显示 Diff
          </span>
        </ReviewPanelEmptyState>
      ) : (
        <ul aria-label="文件变更列表" className="review-panel-file-list__items">
          {files.map((file) => (
            <li className="review-panel-file-list__item" key={getReviewPanelFileActionKey(file)}>
              <ReviewPanelFileButton
                file={file}
                selected={file.file === selectedFile?.file}
                onSelect={() => onSelectFilePath(file.file)}
              />
              <ReviewPanelFileRowActions
                busy={actionsDisabled}
                file={file}
                onAccept={onAcceptFile}
                onReject={onRejectFile}
                pending={isFilePending(file)}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
