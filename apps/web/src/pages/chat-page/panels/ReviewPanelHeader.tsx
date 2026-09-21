import type { ReactNode } from 'react';
import type { SessionFileReviewDecision } from '@openAwork/web-client';
import './ReviewPanelHeader.css';
import {
  CHANGE_SCOPE_OPTIONS,
  DIFF_VIEW_MODE_OPTIONS,
  type ChangeScope,
  type DiffViewMode,
} from './review-panel-model.js';

export interface ReviewPanelHeaderProps {
  readonly bulkActionableCount: number;
  readonly bulkPending: SessionFileReviewDecision | null;
  readonly changeScope: ChangeScope;
  readonly diffViewMode: DiffViewMode;
  readonly onAcceptAll: () => void;
  readonly onChangeScope: (scope: ChangeScope) => void;
  readonly onChangeViewMode: (mode: DiffViewMode) => void;
  readonly onClose: () => void;
  readonly onRejectAll: () => void;
  /** 审查面板的二级分区切换器（文件变更 / 产物），由调用方构造。 */
  readonly sectionSwitcher?: ReactNode;
  /** diff 专属控件（变更范围 / 视图模式 / 批量审查）是否可见；产物分区应传 false。 */
  readonly showDiffControls?: boolean;
  readonly status: string;
}

function LayersIcon() {
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
      <path d="M12 2L2 7l10 5 10-5-10-5z" />
      <path d="M2 17l10 5 10-5" />
      <path d="M2 12l10 5 10-5" />
    </svg>
  );
}

function CloseIcon() {
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
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

function CloseButton({ onClose }: { readonly onClose: () => void }) {
  return (
    <button
      type="button"
      aria-label="收起审查面板"
      className="review-panel-header__close-button"
      onClick={onClose}
    >
      <CloseIcon />
    </button>
  );
}

function SegmentedButton({
  active,
  label,
  onClick,
}: {
  readonly active: boolean;
  readonly label: string;
  readonly onClick: () => void;
}) {
  const className = active
    ? 'review-panel-header__segmented-button review-panel-header__segmented-button--active'
    : 'review-panel-header__segmented-button';

  return (
    <button type="button" aria-pressed={active} className={className} onClick={onClick}>
      {label}
    </button>
  );
}

function BulkReviewButtons({
  actionableCount,
  onAcceptAll,
  onRejectAll,
  pending,
}: {
  readonly actionableCount: number;
  readonly onAcceptAll: () => void;
  readonly onRejectAll: () => void;
  readonly pending: SessionFileReviewDecision | null;
}) {
  const disabled = actionableCount === 0 || pending !== null;

  return (
    <div role="group" aria-label="批量审查" className="review-panel-header__bulk-group">
      <button
        aria-label={`全部接受当前范围的 ${actionableCount} 个待审查文件`}
        className="review-panel-header__bulk-button review-panel-header__bulk-button--accept"
        disabled={disabled}
        onClick={onAcceptAll}
        title={`接受当前范围内 ${actionableCount} 个待审查文件`}
        type="button"
      >
        {pending === 'accepted' ? '接受中…' : '全部接受'}
      </button>
      <button
        aria-label={`全部拒绝当前范围的 ${actionableCount} 个待审查文件`}
        className="review-panel-header__bulk-button review-panel-header__bulk-button--reject"
        disabled={disabled}
        onClick={onRejectAll}
        title={`拒绝当前范围内 ${actionableCount} 个待审查文件`}
        type="button"
      >
        {pending === 'rejected' ? '拒绝中…' : '全部拒绝'}
      </button>
    </div>
  );
}

export function ReviewPanelHeader({
  bulkActionableCount,
  bulkPending,
  changeScope,
  diffViewMode,
  onAcceptAll,
  onChangeScope,
  onChangeViewMode,
  onClose,
  onRejectAll,
  sectionSwitcher,
  showDiffControls = true,
  status,
}: ReviewPanelHeaderProps) {
  return (
    <div className="review-panel-header">
      <div className="review-panel-header__top">
        <div className="review-panel-header__identity">
          <span className="review-panel-header__title">
            <LayersIcon />
            审查
          </span>
          <span className="review-panel-header__status" title={status}>
            {status}
          </span>
        </div>

        <CloseButton onClose={onClose} />
      </div>

      <div className="review-panel-header__controls">
        {sectionSwitcher}

        {showDiffControls ? (
          <>
            <div
              role="group"
              aria-label="变更范围"
              className="review-panel-header__segmented-group"
            >
              {CHANGE_SCOPE_OPTIONS.map((scope) => (
                <SegmentedButton
                  key={scope.value}
                  active={changeScope === scope.value}
                  label={scope.label}
                  onClick={() => onChangeScope(scope.value)}
                />
              ))}
            </div>

            <div
              role="group"
              aria-label="Diff 视图模式"
              className="review-panel-header__segmented-group"
            >
              {DIFF_VIEW_MODE_OPTIONS.map((mode) => (
                <SegmentedButton
                  key={mode.value}
                  active={diffViewMode === mode.value}
                  label={mode.label}
                  onClick={() => onChangeViewMode(mode.value)}
                />
              ))}
            </div>

            <BulkReviewButtons
              actionableCount={bulkActionableCount}
              onAcceptAll={onAcceptAll}
              onRejectAll={onRejectAll}
              pending={bulkPending}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}
