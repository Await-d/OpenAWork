/* ── LSP 符号列表（document 大纲 / workspace 搜索） ── */

import { useFileEditorContext } from '../../../../App.js';
import type { LspSymbolEntry } from '../shared/lsp-symbol-view.js';
import { computeCommonPathPrefix, PathPrefixBadge, StyledPath } from '../shared/path-display.js';

const MONO =
  'ui-monospace, SFMono-Regular, SFMono, Menlo, Monaco, Consolas, Liberation Mono, monospace';

/** 符号列表渲染上限（大纲通常几十行，工作区搜索可能上百条）。 */
const MAX_ROWS = 200;

/** document 模式按层级缩进；每层 12px，超过 6 层不再继续右移（避免窄屏被挤满）。 */
function indentForDepth(depth: number): number {
  return Math.min(depth, 6) * 12;
}

export function LspSymbolPreview({
  entries,
  filePath,
}: {
  entries: readonly LspSymbolEntry[];
  /** document 模式没有逐行路径，点击跳转用调用方的入参路径补全。 */
  filePath?: string;
}) {
  const { openRef, isAvailable } = useFileEditorContext();

  if (entries.length === 0) {
    return <div className="tool-call-inline-empty">（没有符号）</div>;
  }

  const workspacePaths = entries
    .map((entry) => entry.filePath ?? '')
    .filter((path) => path.length > 0);
  const prefix = workspacePaths.length > 1 ? computeCommonPathPrefix(workspacePaths) : '';
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
        {visible.map((entry, index) => {
          const targetPath =
            entry.filePath !== undefined && entry.filePath.length > 0 ? entry.filePath : filePath;
          const canJump = isAvailable && targetPath !== undefined && entry.line !== undefined;

          return (
            <li
              key={`${entry.depth}:${entry.name}:${entry.line ?? 0}:${index}`}
              style={{
                display: 'flex',
                alignItems: 'baseline',
                flexWrap: 'wrap',
                gap: '0 6px',
                minWidth: 0,
                paddingLeft: indentForDepth(entry.depth),
                fontSize: 11,
                lineHeight: 1.55,
              }}
            >
              {canJump ? (
                <button
                  type="button"
                  title={`点击打开 ${targetPath}:${entry.line}`}
                  style={{
                    appearance: 'none',
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--fg-strong)',
                    padding: 0,
                    margin: 0,
                    font: 'inherit',
                    fontFamily: MONO,
                    fontWeight: 600,
                    cursor: 'pointer',
                    textAlign: 'left',
                    minWidth: 0,
                    wordBreak: 'break-all',
                  }}
                  onClick={() => {
                    const open = openRef.current;
                    if (open && targetPath !== undefined && entry.line !== undefined) {
                      open(targetPath, { line: entry.line });
                    }
                  }}
                >
                  {entry.name}
                </button>
              ) : (
                <span
                  style={{
                    minWidth: 0,
                    fontFamily: MONO,
                    fontWeight: 600,
                    color: 'var(--fg-strong)',
                    wordBreak: 'break-all',
                  }}
                >
                  {entry.name}
                </span>
              )}

              <span style={{ flexShrink: 0, fontSize: 10, color: 'var(--fg-muted)' }}>
                {entry.kindLabel}
              </span>
              {entry.containerName && (
                <span style={{ flexShrink: 0, fontSize: 10, color: 'var(--fg-subtle)' }}>
                  in {entry.containerName}
                </span>
              )}

              {entry.filePath !== undefined && entry.filePath.length > 0 ? (
                <span
                  style={{ display: 'inline-flex', alignItems: 'baseline', gap: 4, minWidth: 0 }}
                >
                  <StyledPath path={entry.filePath} prefix={prefix} line={entry.line} />
                  {entry.line !== undefined && (
                    <span style={{ color: 'var(--fg-muted)', fontFamily: MONO }}>
                      {entry.line}
                      {entry.column !== undefined ? `:${entry.column}` : ''}
                    </span>
                  )}
                </span>
              ) : (
                entry.line !== undefined && (
                  <span
                    style={{
                      flexShrink: 0,
                      color: 'var(--fg-muted)',
                      fontFamily: MONO,
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    line {entry.line}
                  </span>
                )
              )}
            </li>
          );
        })}
      </ol>
      {entries.length > visible.length && (
        <div style={{ fontSize: 10, color: 'var(--fg-muted)' }}>
          还有 {entries.length - visible.length} 个符号未展示…
        </div>
      )}
    </div>
  );
}
