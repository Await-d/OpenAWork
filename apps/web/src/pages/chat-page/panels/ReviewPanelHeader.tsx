import './ReviewPanelHeader.css';
import {
  CHANGE_SCOPE_OPTIONS,
  DIFF_VIEW_MODE_OPTIONS,
  type ChangeScope,
  type DiffViewMode,
} from './review-panel-model.js';

export interface ReviewPanelHeaderProps {
  readonly changeScope: ChangeScope;
  readonly diffViewMode: DiffViewMode;
  readonly onChangeScope: (scope: ChangeScope) => void;
  readonly onChangeViewMode: (mode: DiffViewMode) => void;
  readonly onClose: () => void;
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

export function ReviewPanelHeader({
  changeScope,
  diffViewMode,
  onChangeScope,
  onChangeViewMode,
  onClose,
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
        <div role="group" aria-label="变更范围" className="review-panel-header__segmented-group">
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
      </div>
    </div>
  );
}
