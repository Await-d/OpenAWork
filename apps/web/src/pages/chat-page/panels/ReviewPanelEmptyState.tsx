import type { ReactNode } from 'react';

export function ReviewPanelEmptyState({ children }: { readonly children: ReactNode }) {
  return (
    <div className="review-panel-empty-state">
      <div className="review-panel-empty-state__content">
        <svg
          aria-hidden="true"
          className="review-panel-empty-state__icon"
          fill="none"
          height="28"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.5"
          viewBox="0 0 24 24"
          width="28"
        >
          <path d="M12 2L2 7l10 5 10-5-10-5z" />
          <path d="M2 17l10 5 10-5" />
          <path d="M2 12l10 5 10-5" />
        </svg>
        <p className="review-panel-empty-state__text">{children}</p>
      </div>
    </div>
  );
}
