/* ── repo_overview result preview (P1-SCOUT) ──
 *
 * Renders the structured snapshot returned by the gateway tool: the
 * resolved path / git ref, detected ecosystems + package manager,
 * dependency manifests, candidate entrypoints, and a depth-limited
 * structure tree. We deliberately keep this dense — the LLM has a
 * long structure list and we want the user to skim it quickly.
 */

export interface RepoOverviewOutputShape {
  path: string;
  repository?: string;
  branch?: string;
  head?: string;
  packageManager?: string;
  ecosystems: string[];
  dependencyFiles: string[];
  entrypoints: string[];
  depth: number;
  truncated: boolean;
  structure: string[];
}

export function extractRepoOverviewFromOutput(output: unknown): RepoOverviewOutputShape | null {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return null;
  const r = output as Record<string, unknown>;
  if (typeof r.path !== 'string' || typeof r.depth !== 'number') return null;
  const ecosystems = Array.isArray(r.ecosystems)
    ? r.ecosystems.filter((s): s is string => typeof s === 'string')
    : null;
  const dependencyFiles = Array.isArray(r.dependencyFiles)
    ? r.dependencyFiles.filter((s): s is string => typeof s === 'string')
    : null;
  const entrypoints = Array.isArray(r.entrypoints)
    ? r.entrypoints.filter((s): s is string => typeof s === 'string')
    : null;
  const structure = Array.isArray(r.structure)
    ? r.structure.filter((s): s is string => typeof s === 'string')
    : null;
  // Without these arrays the payload is not a real overview — fall
  // back to the JSON dump to avoid rendering an empty card.
  if (!ecosystems || !dependencyFiles || !entrypoints || !structure) {
    return null;
  }
  return {
    path: r.path,
    repository: typeof r.repository === 'string' ? r.repository : undefined,
    branch: typeof r.branch === 'string' ? r.branch : undefined,
    head: typeof r.head === 'string' ? r.head : undefined,
    packageManager: typeof r.packageManager === 'string' ? r.packageManager : undefined,
    ecosystems,
    dependencyFiles,
    entrypoints,
    depth: r.depth,
    truncated: r.truncated === true,
    structure,
  };
}

const CHIP_STYLE: React.CSSProperties = {
  fontSize: 11,
  padding: '2px 8px',
  borderRadius: 999,
  background: 'color-mix(in srgb, var(--accent) 10%, transparent)',
  color: 'var(--accent)',
  fontWeight: 600,
  whiteSpace: 'nowrap',
};

const PILL_NEUTRAL: React.CSSProperties = {
  ...CHIP_STYLE,
  background: 'var(--bg-surface)',
  color: 'var(--fg-default)',
};

function ChipRow({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      <span style={{ fontSize: 11, color: 'var(--fg-muted)', fontWeight: 600 }}>{label}</span>
      {items.map((item) => (
        <span key={item} style={CHIP_STYLE}>
          {item}
        </span>
      ))}
    </div>
  );
}

export function RepoOverviewPreview({ data }: { data: RepoOverviewOutputShape }) {
  // Cap the visible structure block — the gateway already truncates
  // server-side based on depth, but the array can still be long; we
  // surface a "+N more" tail rather than rendering hundreds of rows
  // (the full payload is still in the raw expandable view).
  const STRUCTURE_VISIBLE_LIMIT = 80;
  const visibleStructure = data.structure.slice(0, STRUCTURE_VISIBLE_LIMIT);
  const hiddenCount = data.structure.length - visibleStructure.length;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: '8px 10px',
        border: '1px solid var(--border-subtle)',
        borderRadius: 6,
        background: 'var(--bg-overlay)',
        fontSize: 12,
        lineHeight: 1.5,
      }}
    >
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {data.repository ? (
          <span style={{ fontWeight: 700, color: 'var(--fg-strong)' }}>{data.repository}</span>
        ) : (
          <span
            style={{
              fontWeight: 700,
              color: 'var(--fg-strong)',
              fontFamily: 'var(--mono)',
              wordBreak: 'break-all',
            }}
          >
            {data.path}
          </span>
        )}
        {data.packageManager && <span style={CHIP_STYLE}>pm: {data.packageManager}</span>}
        <span style={PILL_NEUTRAL}>depth ≤ {data.depth}</span>
        {data.truncated && <span style={PILL_NEUTRAL}>truncated</span>}
      </div>

      {/* Path/ref strip — duplicated path under the title is intentional
          when `repository` is set so users see both the human-readable
          name and the absolute cache location. */}
      {data.repository && (
        <div style={{ color: 'var(--fg-default)', fontFamily: 'var(--mono)', wordBreak: 'break-all' }}>
          {data.path}
        </div>
      )}
      {(data.branch || data.head) && (
        <div style={{ display: 'flex', gap: 12, color: 'var(--fg-muted)', flexWrap: 'wrap' }}>
          {data.branch && (
            <span>
              分支：<code>{data.branch}</code>
            </span>
          )}
          {data.head && (
            <span style={{ fontFamily: 'var(--mono)' }}>HEAD: {data.head.slice(0, 12)}</span>
          )}
        </div>
      )}

      <ChipRow label="生态" items={data.ecosystems} />
      <ChipRow label="入口" items={data.entrypoints} />
      <ChipRow label="依赖文件" items={data.dependencyFiles} />

      {visibleStructure.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 11, color: 'var(--fg-muted)', fontWeight: 600 }}>结构</span>
          <pre
            style={{
              margin: 0,
              padding: '6px 8px',
              borderRadius: 4,
              background: 'var(--bg-surface)',
              color: 'var(--fg-default)',
              fontFamily: 'var(--mono)',
              fontSize: 11,
              lineHeight: 1.5,
              whiteSpace: 'pre',
              overflowX: 'auto',
            }}
          >
            {visibleStructure.join('\n')}
            {hiddenCount > 0 ? `\n… +${hiddenCount} 行（展开下方原始输出查看）` : ''}
          </pre>
        </div>
      )}
    </div>
  );
}
