/* ── LSP 位置列表（定义 / 实现 / 引用） ── */

import type { LspLocationEntry } from '../shared/lsp-location-view.js';
import { computeCommonPathPrefix, PathPrefixBadge, StyledPath } from '../shared/path-display.js';

const MONO =
  'ui-monospace, SFMono-Regular, SFMono, Menlo, Monaco, Consolas, Liberation Mono, monospace';

/** 位置列表渲染上限（引用可能有几百条，不做虚拟化，超出给「还有 N 条」）。 */
const MAX_ROWS = 100;

export function LspLocationPreview({ entries }: { entries: readonly LspLocationEntry[] }) {
  if (entries.length === 0) {
    return <div className="tool-call-inline-empty">（没有位置结果）</div>;
  }

  // 多文件时把公共目录提到顶部徽标，行内只留相对路径 —— 深色窄屏下能少掉
  // 大段重复前缀，文件名才扫得动。
  const prefix = computeCommonPathPrefix(entries.map((entry) => entry.filePath));
  const visible = entries.slice(0, MAX_ROWS);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {prefix.length > 0 && <PathPrefixBadge prefix={prefix} />}
      <ol
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
          <li
            key={`${entry.filePath}:${entry.line}:${entry.column ?? 0}:${index}`}
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
        ))}
      </ol>
      {entries.length > visible.length && (
        <div style={{ fontSize: 10, color: 'var(--fg-muted)' }}>
          还有 {entries.length - visible.length} 条位置未展示…
        </div>
      )}
    </div>
  );
}
