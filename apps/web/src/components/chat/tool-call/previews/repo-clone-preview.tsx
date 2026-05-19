/* ── repo_clone result preview (P1-SCOUT) ──
 *
 * Surfaces the four high-signal fields the LLM tool returns so the
 * user can confirm at a glance: (1) which repo was resolved, (2) the
 * cache disposition (cached / cloned / refreshed), (3) the absolute
 * local path so they can copy-paste into a follow-up tool, and (4)
 * the ref information when present. Anything else from the JSON
 * payload still shows up in the raw expandable body underneath.
 */

export interface RepoCloneOutputShape {
  repository: string;
  host: string;
  remote: string;
  localPath: string;
  status: 'cached' | 'cloned' | 'refreshed';
  head?: string;
  branch?: string;
}

export function extractRepoCloneFromOutput(output: unknown): RepoCloneOutputShape | null {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return null;
  const record = output as Record<string, unknown>;
  // The shape is generated from the gateway tool's outputSchema. We
  // verify the must-have fields and bail otherwise so a partially
  // serialized error envelope does not get rendered as if it were a
  // successful clone.
  const repository = typeof record.repository === 'string' ? record.repository : null;
  const host = typeof record.host === 'string' ? record.host : null;
  const remote = typeof record.remote === 'string' ? record.remote : null;
  const localPath = typeof record.localPath === 'string' ? record.localPath : null;
  const status = record.status;
  const isStatus = status === 'cached' || status === 'cloned' || status === 'refreshed';
  if (!repository || !host || !remote || !localPath || !isStatus) {
    return null;
  }
  return {
    repository,
    host,
    remote,
    localPath,
    status,
    head: typeof record.head === 'string' ? record.head : undefined,
    branch: typeof record.branch === 'string' ? record.branch : undefined,
  };
}

const STATUS_LABEL: Record<RepoCloneOutputShape['status'], { label: string; tone: string }> = {
  cached: { label: '使用缓存', tone: 'var(--fg-default)' },
  cloned: { label: '首次克隆', tone: 'var(--accent)' },
  refreshed: { label: '已刷新', tone: 'var(--accent)' },
};

export function RepoClonePreview({ data }: { data: RepoCloneOutputShape }) {
  const status = STATUS_LABEL[data.status];
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: '8px 10px',
        border: '1px solid var(--border-subtle)',
        borderRadius: 6,
        background: 'var(--bg-overlay)',
        fontSize: 12,
        lineHeight: 1.5,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 700, color: 'var(--fg-strong)' }}>{data.repository}</span>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            padding: '2px 8px',
            borderRadius: 999,
            background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
            color: status.tone,
          }}
        >
          {status.label}
        </span>
        {data.branch && (
          <span style={{ color: 'var(--fg-muted)', fontSize: 11 }}>
            分支：<code>{data.branch}</code>
          </span>
        )}
      </div>
      <div
        style={{ color: 'var(--fg-default)', fontFamily: 'var(--mono)', wordBreak: 'break-all' }}
      >
        {data.localPath}
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', color: 'var(--fg-muted)' }}>
        <span>host: {data.host}</span>
        <span style={{ fontFamily: 'var(--mono)', wordBreak: 'break-all' }}>
          remote: {data.remote}
        </span>
        {data.head && (
          <span style={{ fontFamily: 'var(--mono)' }}>HEAD: {data.head.slice(0, 12)}</span>
        )}
      </div>
    </div>
  );
}
