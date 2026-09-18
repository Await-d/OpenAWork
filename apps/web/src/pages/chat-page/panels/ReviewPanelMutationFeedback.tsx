import type { ReviewPanelMutationFeedback as ReviewPanelMutationFeedbackState } from './use-review-panel-file-actions.js';
import './ReviewPanelMutationFeedback.css';

export interface ReviewPanelMutationFeedbackProps {
  readonly busy: boolean;
  readonly feedback: ReviewPanelMutationFeedbackState;
  readonly onDismiss: () => void;
  readonly onRetryWithForce: (feedback: ReviewPanelMutationFeedbackState) => void;
}

const MAX_LISTED_CONFLICT_FILES = 3;

function AlertIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="14"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="14"
    >
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" x2="12" y1="9" y2="13" />
      <line x1="12" x2="12.01" y1="17" y2="17" />
    </svg>
  );
}

function formatConflictDetail(feedback: ReviewPanelMutationFeedbackState): string | null {
  const conflicts = feedback.conflicts;
  if (!conflicts || conflicts.count === 0) {
    return null;
  }
  const listed = conflicts.files.slice(0, MAX_LISTED_CONFLICT_FILES);
  const suffix = conflicts.count > listed.length ? ' 等' : '';
  const files = listed.length > 0 ? `：${listed.join('、')}${suffix}` : '';
  return `工作区有 ${conflicts.count} 处冲突${files}`;
}

export function ReviewPanelMutationFeedback({
  busy,
  feedback,
  onDismiss,
  onRetryWithForce,
}: ReviewPanelMutationFeedbackProps) {
  const isConflict = feedback.kind === 'conflict';
  const conflictDetail = formatConflictDetail(feedback);
  const className = isConflict
    ? 'review-panel-mutation-feedback review-panel-mutation-feedback--conflict'
    : 'review-panel-mutation-feedback review-panel-mutation-feedback--error';

  return (
    <div className={className} role="alert">
      <div className="review-panel-mutation-feedback__head">
        <AlertIcon />
        <span className="review-panel-mutation-feedback__title">
          {isConflict ? '检测到工作区冲突' : '审查操作失败'}
        </span>
      </div>
      <p className="review-panel-mutation-feedback__message">{feedback.message}</p>
      {conflictDetail ? (
        <p className="review-panel-mutation-feedback__detail">{conflictDetail}</p>
      ) : null}
      {feedback.processedCount !== undefined && feedback.processedCount > 0 ? (
        <p className="review-panel-mutation-feedback__detail">
          {`已处理 ${feedback.processedCount} 个文件后中止。`}
        </p>
      ) : null}
      <p className="review-panel-mutation-feedback__detail">
        {`目标文件：${feedback.target.filePath}`}
      </p>
      <div className="review-panel-mutation-feedback__actions">
        {isConflict ? (
          <button
            className="review-panel-mutation-feedback__button review-panel-mutation-feedback__button--force"
            disabled={busy}
            onClick={() => onRetryWithForce(feedback)}
            type="button"
          >
            {busy ? '处理中…' : '强制覆盖'}
          </button>
        ) : null}
        <button
          className="review-panel-mutation-feedback__button review-panel-mutation-feedback__button--dismiss"
          disabled={busy}
          onClick={onDismiss}
          type="button"
        >
          忽略
        </button>
      </div>
    </div>
  );
}
