import type { SessionFileDiffEntry, SessionFileReviewDecision } from '@openAwork/web-client';
import { formatReviewDecision, isReviewPanelManualRevert } from './review-panel-model.js';
import './ReviewPanelFileActions.css';

export interface ReviewPanelFileActionProps {
  readonly busy: boolean;
  readonly file: SessionFileDiffEntry;
  readonly onAccept: (file: SessionFileDiffEntry) => void;
  readonly onReject: (file: SessionFileDiffEntry) => void;
  readonly pending: boolean;
}

function CheckIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="12"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2.5"
      viewBox="0 0 24 24"
      width="12"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function RevertIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="12"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2.5"
      viewBox="0 0 24 24"
      width="12"
    >
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  );
}

function ReviewDecisionBadge({ file }: { readonly file: SessionFileDiffEntry }) {
  if (isReviewPanelManualRevert(file)) {
    return (
      <span className="review-panel-review-badge review-panel-review-badge--reverted">已回滚</span>
    );
  }
  if (!file.reviewStatus) {
    return null;
  }
  return (
    <span className={`review-panel-review-badge review-panel-review-badge--${file.reviewStatus}`}>
      {formatReviewDecision(file.reviewStatus)}
    </span>
  );
}

function resolveActionTitle(
  file: SessionFileDiffEntry,
  decision: SessionFileReviewDecision,
): string | undefined {
  if (isReviewPanelManualRevert(file)) {
    return '该变更已回滚，不能再提交审查决定';
  }
  if (!file.requestId) {
    return '该变更缺少请求标识，无法提交审查决定';
  }
  if (file.reviewStatus === decision) {
    return `已提交过「${formatReviewDecision(decision)}」决定`;
  }
  return undefined;
}

function isAcceptDisabled(props: ReviewPanelFileActionProps): boolean {
  return (
    !props.file.requestId ||
    props.busy ||
    props.pending ||
    props.file.reviewStatus === 'accepted' ||
    isReviewPanelManualRevert(props.file)
  );
}

function isRejectDisabled(props: ReviewPanelFileActionProps): boolean {
  return (
    !props.file.requestId ||
    props.busy ||
    props.pending ||
    props.file.reviewStatus === 'rejected' ||
    isReviewPanelManualRevert(props.file)
  );
}

export function ReviewPanelFileRowActions(props: ReviewPanelFileActionProps) {
  const { file, onAccept, onReject } = props;

  return (
    <div className="review-panel-file-row-actions">
      <ReviewDecisionBadge file={file} />
      <button
        aria-label={`接受 ${file.file}`}
        className="review-panel-file-row-actions__button review-panel-file-row-actions__button--accept"
        disabled={isAcceptDisabled(props)}
        onClick={() => onAccept(file)}
        title={resolveActionTitle(file, 'accepted')}
        type="button"
      >
        <CheckIcon />
      </button>
      <button
        aria-label={`拒绝 ${file.file}`}
        className="review-panel-file-row-actions__button review-panel-file-row-actions__button--reject"
        disabled={isRejectDisabled(props)}
        onClick={() => onReject(file)}
        title={resolveActionTitle(file, 'rejected')}
        type="button"
      >
        <RevertIcon />
      </button>
    </div>
  );
}
