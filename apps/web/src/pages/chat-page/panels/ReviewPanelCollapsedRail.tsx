import './ReviewPanelCollapsedRail.css';

function ChevronIcon() {
  return (
    <svg
      aria-hidden="true"
      className="review-panel-collapsed-rail__icon"
      fill="none"
      height="14"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="14"
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

export function ReviewPanelCollapsedRail({ onOpen }: { readonly onOpen: () => void }) {
  return (
    <button
      type="button"
      aria-label="展开审查面板"
      className="review-panel-collapsed-rail"
      title="展开审查面板"
      onClick={onOpen}
    >
      <ChevronIcon />
      <span className="review-panel-collapsed-rail__label">审查</span>
    </button>
  );
}
