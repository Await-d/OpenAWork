/* ── ast_grep_search / ast_grep_replace（匹配位置 + 片段） ── */

import type { AstGrepMatch } from '../shared/ast-grep-view.js';
import { computeCommonPathPrefix, PathPrefixBadge, StyledPath } from '../shared/path-display.js';

const MONO =
  'ui-monospace, SFMono-Regular, SFMono, Menlo, Monaco, Consolas, Liberation Mono, monospace';

/** 匹配条数与单条片段行数上限：AST 搜索一次可能有几十处，超出折叠成提示。 */
const MAX_ROWS = 20;
const MAX_SNIPPET_LINES = 12;

export function AstGrepPreview({ matches }: { matches: readonly AstGrepMatch[] }) {
  if (matches.length === 0) {
    return <div className="tool-call-inline-empty">（未找到匹配）</div>;
  }

  // 多文件时把公共目录提到顶部徽标，行内只留相对路径。
  const prefix = computeCommonPathPrefix(matches.map((match) => match.filePath));
  const visible = matches.slice(0, MAX_ROWS);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: 10, color: 'var(--fg-muted)' }}>找到 {matches.length} 处匹配</div>
      {prefix.length > 0 && <PathPrefixBadge prefix={prefix} />}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {visible.map((match, index) => {
          const lines = match.snippet.split('\n');
          const shown = lines.slice(0, MAX_SNIPPET_LINES);
          const hidden = lines.length - shown.length;

          return (
            <div
              key={`${match.filePath}:${match.line}:${index}`}
              data-ast-grep-match={index}
              style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  flexWrap: 'wrap',
                  gap: '0 6px',
                  minWidth: 0,
                  fontSize: 11,
                }}
              >
                <StyledPath path={match.filePath} prefix={prefix} line={match.line} />
                <span
                  style={{
                    flexShrink: 0,
                    color: 'var(--fg-muted)',
                    fontFamily: MONO,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {match.line}:{match.column}
                </span>
              </div>

              {match.snippet.length > 0 && (
                <pre
                  style={{
                    margin: 0,
                    padding: '6px 8px',
                    borderRadius: 4,
                    background: 'var(--bg-overlay)',
                    border: '1px solid var(--border-default)',
                    color: 'var(--fg-default)',
                    fontFamily: MONO,
                    fontSize: 10.5,
                    lineHeight: 1.5,
                    // 横向滚动限制在片段内部，不撑宽外层卡片（窄视口依赖这一点）。
                    overflowX: 'auto',
                    whiteSpace: 'pre',
                  }}
                >
                  {shown.join('\n')}
                </pre>
              )}

              {hidden > 0 && (
                <span style={{ fontSize: 10, color: 'var(--fg-muted)' }}>
                  … 还有 {hidden} 行未展示
                </span>
              )}
            </div>
          );
        })}
      </div>

      {matches.length > visible.length && (
        <div style={{ fontSize: 10, color: 'var(--fg-muted)' }}>
          还有 {matches.length - visible.length} 处未展示…
        </div>
      )}
    </div>
  );
}
