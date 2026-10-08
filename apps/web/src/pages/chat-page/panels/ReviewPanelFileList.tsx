import type { SessionFileDiffEntry } from '@openAwork/web-client';
import {
  ReviewPanelDecisionBadge,
  ReviewPanelFileRowActions,
} from './ReviewPanelFileActions.js';
import {
  formatFileStatus,
  getReviewPanelFileActionKey,
  type ChangeScope,
} from './review-panel-model.js';
import { ReviewPanelEmptyState } from './ReviewPanelEmptyState.js';

function formatScopeLabel(changeScope: ChangeScope): string {
  return changeScope === 'all' ? '全部轮次' : '当前轮次';
}

/**
 * 目录前缀最多保留的段数。
 *
 * 侧栏左列固定约 380px，扣掉列表内边距、两个操作按钮和卡片自身内边距后，
 * 路径行只剩 ~290px：一个 30+ 字符的文件名本身就吃掉 200px 以上，
 * 目录再保留 2 段就注定把文件名截断。这里只保留最后 1 段，更浅的层级用「…」
 * 代替——文件名优先完整，完整路径仍可通过 title 悬停查看。
 */
const MAX_DIR_SEGMENTS = 1;

function splitFilePath(filePath: string): { readonly dir: string; readonly name: string } {
  const segments = filePath.split(/[/\\]+/).filter((segment) => segment.length > 0);
  const name = segments.at(-1);
  if (name === undefined) {
    return { dir: '', name: filePath };
  }
  const dirSegments = segments.slice(0, -1);
  const keptDirSegments = dirSegments.slice(-MAX_DIR_SEGMENTS);
  const separator = filePath.includes('\\') ? '\\' : '/';
  const elided = keptDirSegments.length === 0 ? '' : `…${separator}`;
  return {
    dir: elided + keptDirSegments.join(separator) + (keptDirSegments.length > 0 ? separator : ''),
    name,
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
        {dir ? <span className="review-panel-file-button__dir">{dir}</span> : null}
        <span className="review-panel-file-button__name">{name}</span>
      </span>
      <span className="review-panel-file-button__meta">
        <ReviewPanelDecisionBadge file={file} />
        <span className="review-panel-file-button__status">{statusLabel}</span>
        <span className="review-panel-file-button__additions">+{file.additions}</span>
        <span className="review-panel-file-button__deletions">-{file.deletions}</span>
        {file.toolName ? (
          <span className="review-panel-file-button__tool">{file.toolName}</span>
        ) : null}
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
