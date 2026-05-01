/* ── workspace_review_status (git status list) ── */

export interface ReviewChange {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  oldPath?: string;
  linesAdded?: number;
  linesDeleted?: number;
}

export interface ReviewChangesBundle {
  path?: string;
  changes: ReviewChange[];
}

export function extractReviewChangesFromOutput(output: unknown): ReviewChangesBundle | null {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return null;
  const record = output as Record<string, unknown>;
  const changes = record.changes;
  if (!Array.isArray(changes)) return null;
  return {
    path: typeof record.path === 'string' ? record.path : undefined,
    changes: changes as ReviewChange[],
  };
}

export function ReviewStatusPreview({ data }: { data: ReviewChangesBundle }) {
  if (data.changes.length === 0) {
    return <div className="tool-call-inline-empty">（工作区干净，无变更）</div>;
  }
  const statusGlyph: Record<ReviewChange['status'], string> = {
    added: 'A',
    modified: 'M',
    deleted: 'D',
    renamed: 'R',
  };
  return (
    <div className="tool-call-review-list">
      {data.changes.map((c, idx) => (
        <div key={`${c.path}-${idx}`} className="tool-call-review-row" data-status={c.status}>
          <span className="tool-call-review-glyph">{statusGlyph[c.status]}</span>
          <span className="tool-call-review-path">
            {c.status === 'renamed' && c.oldPath ? (
              <>
                <span className="tool-call-review-old">{c.oldPath}</span>
                <span className="tool-call-review-arrow"> → </span>
                {c.path}
              </>
            ) : (
              c.path
            )}
          </span>
          {(c.linesAdded !== undefined || c.linesDeleted !== undefined) && (
            <span className="tool-call-review-stats">
              {c.linesAdded !== undefined && c.linesAdded > 0 && (
                <span className="tool-call-review-add">+{c.linesAdded}</span>
              )}
              {c.linesDeleted !== undefined && c.linesDeleted > 0 && (
                <span className="tool-call-review-del">-{c.linesDeleted}</span>
              )}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
