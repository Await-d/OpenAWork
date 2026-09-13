/**
 * 融合侧栏会话列表的三态展示：加载骨架 / 空态 / 错误态。
 */

export function FusionSidebarSkeleton() {
  return (
    <div className="sidebar-skeleton" aria-hidden="true">
      {[0, 1, 2, 3, 4].map((index) => (
        <span key={index} className="sidebar-skeleton-row" />
      ))}
    </div>
  );
}

export function FusionSidebarListState({
  title,
  hint,
  actionLabel,
  onAction,
}: {
  title: string;
  hint?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="sidebar-list-state">
      <span className="sidebar-list-state-title">{title}</span>
      {hint ? <span className="sidebar-list-state-hint">{hint}</span> : null}
      {actionLabel && onAction ? (
        <button type="button" className="sidebar-retry-button" onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}
