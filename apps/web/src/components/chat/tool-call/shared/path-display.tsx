/**
 * Shared utilities for rendering file paths in tool output previews.
 *
 * Why centralised: every preview that shows paths (grep groups, glob lists,
 * workspace_search hits, grep counts) used to render the full absolute path
 * on every row. With deep monorepo paths this wastes ~70% of the visual
 * width on a repeated prefix and makes filenames hard to scan.
 *
 * Two helpers solve this:
 *   - `computeCommonPathPrefix(paths)` finds the longest shared directory
 *     prefix across a list of paths so previews can hoist it into a header.
 *   - `<StyledPath>` splits a path into "dir/" + "filename.ext" so the
 *     filename can be emphasised while the directory stays muted.
 *
 * Both work on POSIX-style separators; we normalise `\` → `/` on input so
 * Windows-shaped paths render the same way.
 */

import type { CSSProperties, ReactElement } from 'react';
import { useFileEditorContext } from '../../../../App.js';

/**
 * Find the longest directory prefix shared by every path in the list.
 *
 * Rules:
 *   - Returns "" for fewer than 2 paths or when there is no shared
 *     directory segment. Single-path callers should treat the whole path
 *     as a leaf and skip the prefix badge.
 *   - The result always ends in "/" so callers can do `path.slice(prefix.length)`
 *     and get a clean relative path.
 *   - We compare directory *segments*, not raw characters — `src/foo.ts`
 *     and `src/foo-bar.ts` should NOT yield `src/foo` as a prefix.
 *   - The trailing filename segment of each path is excluded from the
 *     comparison so we never strip a filename from one of the inputs.
 */
export function computeCommonPathPrefix(paths: string[]): string {
  if (paths.length < 2) return '';
  const segmented = paths.map((p) => {
    const norm = p.replace(/\\/g, '/');
    const segs = norm.split('/');
    // Trailing empty segment from "foo/" — drop so it doesn't poison the comparison.
    if (segs.length > 0 && segs[segs.length - 1] === '') segs.pop();
    // Reserve the last segment as the filename so we never collapse it
    // into the prefix even if every path happens to share it.
    return segs;
  });
  if (segmented.some((s) => s.length === 0)) return '';

  const minDirDepth = Math.min(...segmented.map((s) => s.length - 1));
  if (minDirDepth <= 0) return '';

  const head = segmented[0];
  if (!head) return '';
  let commonDepth = 0;
  for (let i = 0; i < minDirDepth; i++) {
    const seg = head[i];
    if (segmented.every((s) => s[i] === seg)) commonDepth = i + 1;
    else break;
  }
  if (commonDepth === 0) return '';

  const prefixSegs = head.slice(0, commonDepth);
  // Preserve a leading "/" for absolute paths (first segment is "").
  const joined = prefixSegs.join('/');
  return `${joined}/`;
}

/**
 * Strip a known prefix from a path. If the path doesn't start with the
 * prefix (defensive — shouldn't happen if `computeCommonPathPrefix` was
 * the source) the original is returned unchanged.
 */
export function stripPathPrefix(path: string, prefix: string): string {
  if (!prefix) return path;
  const norm = path.replace(/\\/g, '/');
  return norm.startsWith(prefix) ? norm.slice(prefix.length) : norm;
}

/**
 * Split a path into its directory portion (with trailing "/") and the
 * filename. Returns `{ dir: "", name: path }` for paths with no separator.
 */
export function splitPathParts(path: string): { dir: string; name: string } {
  const norm = path.replace(/\\/g, '/');
  const lastSlash = norm.lastIndexOf('/');
  if (lastSlash < 0) return { dir: '', name: norm };
  return { dir: norm.slice(0, lastSlash + 1), name: norm.slice(lastSlash + 1) };
}

/**
 * Render a path with the directory dimmed and the filename emphasised.
 * Honours an optional `prefix` which, when supplied, is removed from the
 * front of the path before splitting (the prefix is shown elsewhere as a
 * single header badge — repeating it on every row defeats the purpose).
 *
 * Becomes clickable when `App.tsx` has wired `FileEditorContext` (i.e.
 * the user is on the chat page with the editor pane available). Clicking
 * opens the file in the editor pane via `useFileEditor.openFile`, the
 * same path used by `MarkdownPathRef`. Outside the chat page (e.g. in a
 * standalone artifact viewer) the context is null and the path renders
 * as a passive span without any click affordance — no behaviour change
 * for non-chat consumers.
 */
export function StyledPath({
  path,
  prefix,
  className,
  interactive = true,
  line,
}: {
  path: string;
  prefix?: string;
  className?: string;
  /**
   * Set to `false` to force a passive span even when a FileEditor
   * context is available — useful for paths that are part of an
   * already-clickable card (e.g. row-level button).
   */
  interactive?: boolean;
  /**
   * Optional 1-based line to jump to when the path is clicked. Forwarded
   * to `openFile` so search/grep results land on the matched line instead
   * of the top of the file.
   */
  line?: number;
}): ReactElement {
  const fileEditorRef = useFileEditorContext();
  const relative = prefix ? stripPathPrefix(path, prefix) : path;
  const { dir, name } = splitPathParts(relative);
  const canOpen = interactive && fileEditorRef?.current !== null;

  const inner = (
    <>
      {dir && <span className="styled-path-dir">{dir}</span>}
      <span className="styled-path-name">{name}</span>
    </>
  );
  const composedClass = className ? `styled-path ${className}` : 'styled-path';

  if (!canOpen) {
    return (
      <span className={composedClass} title={path}>
        {inner}
      </span>
    );
  }

  // Inline cursor:pointer + hover underline via tokens; the parent
  // preview cards may already wrap the full row in a button, but those
  // wrappers swallow the click and we still want the path itself to
  // surface as the open trigger.
  const buttonStyle: CSSProperties = {
    border: 'none',
    background: 'transparent',
    color: 'inherit',
    padding: 0,
    margin: 0,
    font: 'inherit',
    cursor: 'pointer',
    textAlign: 'left',
    minWidth: 0,
  };
  return (
    <button
      type="button"
      className={`${composedClass} styled-path-clickable`}
      title={`点击打开 ${path}`}
      style={buttonStyle}
      onClick={(event) => {
        event.stopPropagation();
        const open = fileEditorRef?.current;
        if (open) open(path, line != null ? { line } : undefined);
      }}
    >
      {inner}
    </button>
  );
}

/**
 * Compact header badge that displays the shared directory once so the
 * row-level paths can drop it. Renders nothing when `prefix` is empty.
 */
export function PathPrefixBadge({ prefix }: { prefix: string }): ReactElement | null {
  if (!prefix) return null;
  return (
    <div className="styled-path-prefix" title={prefix}>
      <span className="styled-path-prefix-glyph" aria-hidden="true">
        📁
      </span>
      <span className="styled-path-prefix-text">{prefix}</span>
    </div>
  );
}
