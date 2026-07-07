function ReviewPanelStatCard({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="review-panel-stat-card">
      <div className="review-panel-stat-card__label">{label}</div>
      <div className="review-panel-stat-card__value">{value}</div>
    </div>
  );
}

export function ReviewPanelStats({
  additions,
  deletions,
  fileCount,
}: {
  readonly additions: number;
  readonly deletions: number;
  readonly fileCount: number;
}) {
  return (
    <div className="review-panel-stats">
      <ReviewPanelStatCard label="变更文件" value={String(fileCount)} />
      <ReviewPanelStatCard label="行级变更" value={`+${additions} / -${deletions}`} />
    </div>
  );
}
