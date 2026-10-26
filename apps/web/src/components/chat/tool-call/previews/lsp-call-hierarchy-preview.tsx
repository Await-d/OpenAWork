/* ── lsp_call_hierarchy（符号 + 调用方 / 被调用方） ── */

import type {
  LspCallHierarchyEntry,
  LspCallHierarchyView,
} from '../shared/lsp-call-hierarchy-view.js';
import { computeCommonPathPrefix, PathPrefixBadge, StyledPath } from '../shared/path-display.js';

const MONO =
  'ui-monospace, SFMono-Regular, SFMono, Menlo, Monaco, Consolas, Liberation Mono, monospace';

const MAX_ROWS_PER_GROUP = 50;

function EntryRow({ entry, prefix }: { entry: LspCallHierarchyEntry; prefix: string }) {
  return (
    <li
      style={{
        display: 'flex',
        alignItems: 'baseline',
        flexWrap: 'wrap',
        gap: '0 6px',
        minWidth: 0,
        fontSize: 11,
        lineHeight: 1.55,
      }}
    >
      <span
        style={{
          minWidth: 0,
          fontFamily: MONO,
          fontWeight: 500,
          color: 'var(--fg-strong)',
          wordBreak: 'break-all',
        }}
      >
        {entry.name}
      </span>
      {entry.detail && (
        <span style={{ flexShrink: 0, fontSize: 10, color: 'var(--fg-subtle)' }}>
          {entry.detail}
        </span>
      )}
      <StyledPath path={entry.filePath} prefix={prefix} line={entry.line} />
      <span
        style={{
          flexShrink: 0,
          color: 'var(--fg-muted)',
          fontFamily: MONO,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {entry.line}
        {entry.column !== undefined ? `:${entry.column}` : ''}
      </span>
    </li>
  );
}

function Group({
  title,
  entries,
  empty,
  prefix,
}: {
  title: string;
  entries: readonly LspCallHierarchyEntry[];
  empty: string;
  prefix: string;
}) {
  const visible = entries.slice(0, MAX_ROWS_PER_GROUP);
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--fg-muted)' }}>
        {title}（{entries.length}）
      </div>
      {entries.length === 0 ? (
        <div className="tool-call-inline-empty" style={{ fontSize: 10 }}>
          {empty}
        </div>
      ) : (
        <ul
          style={{
            margin: 0,
            padding: 0,
            listStyle: 'none',
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
          }}
        >
          {visible.map((entry, index) => (
            <EntryRow
              key={`${entry.filePath}:${entry.line}:${index}`}
              entry={entry}
              prefix={prefix}
            />
          ))}
        </ul>
      )}
      {entries.length > visible.length && (
        <div style={{ fontSize: 10, color: 'var(--fg-muted)' }}>
          还有 {entries.length - visible.length} 条未展示…
        </div>
      )}
    </section>
  );
}

export function LspCallHierarchyPreview({ view }: { view: LspCallHierarchyView }) {
  const allPaths = [
    ...(view.symbol ? [view.symbol.filePath] : []),
    ...view.incoming.map((entry) => entry.filePath),
    ...view.outgoing.map((entry) => entry.filePath),
  ];
  const prefix = allPaths.length > 1 ? computeCommonPathPrefix(allPaths) : '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {view.symbol && (
        <div style={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: '0 6px' }}>
          <span
            style={{
              minWidth: 0,
              fontFamily: MONO,
              fontWeight: 600,
              color: 'var(--fg-strong)',
              wordBreak: 'break-all',
            }}
          >
            {view.symbol.name}
          </span>
          {view.symbol.detail && (
            <span style={{ flexShrink: 0, fontSize: 10, color: 'var(--fg-subtle)' }}>
              {view.symbol.detail}
            </span>
          )}
          <StyledPath path={view.symbol.filePath} prefix={prefix} line={view.symbol.line} />
          <span style={{ flexShrink: 0, color: 'var(--fg-muted)', fontFamily: MONO }}>
            {view.symbol.line}
            {view.symbol.column !== undefined ? `:${view.symbol.column}` : ''}
          </span>
        </div>
      )}

      {prefix.length > 0 && <PathPrefixBadge prefix={prefix} />}

      <Group title="↑ 调用方" entries={view.incoming} empty="没有调用方" prefix={prefix} />
      <Group title="↓ 被调用" entries={view.outgoing} empty="没有调用其它符号" prefix={prefix} />
    </div>
  );
}
