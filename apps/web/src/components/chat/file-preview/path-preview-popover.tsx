import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useFilePreview } from './use-file-preview.js';

/**
 * Visible popover anchored to a `MarkdownPathRef`. Renders into a
 * portal at `document.body` so it can escape the chat list's clipping
 * containers, then positions itself with `getBoundingClientRect`
 * relative to the anchor. Flips above when there isn't enough room
 * below; left-clamps so it never spills off the right edge.
 *
 * Accepts hover handlers from the parent so a single hover-bridge
 * timer can keep the popover open while the cursor traverses the
 * gap between trigger and panel.
 */
export function PathPreviewPopover({
  anchorEl,
  path,
  line,
  onMouseEnter,
  onMouseLeave,
}: {
  anchorEl: HTMLElement;
  path: string;
  line: number | null;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{
    top: number;
    left: number;
    placement: 'bottom' | 'top';
  } | null>(null);
  const state = useFilePreview(path, line);

  // Position after the popover has measured its own height. We use
  // useLayoutEffect so users never see a flash at (0, 0) before the
  // real placement lands. The dependency on `state.status` is
  // intentional: when the fetch transitions from loading → ready
  // the panel grows from a single status row to the full snippet,
  // so we need to recompute placement (the popover may now flip
  // above instead of below). Biome can't see this DOM-mediated
  // dependency lexically, so we suppress the false positive.
  // biome-ignore lint/correctness/useExhaustiveDependencies: state.status drives the DOM height we measure
  useLayoutEffect(() => {
    if (!popoverRef.current) return;
    const anchorRect = anchorEl.getBoundingClientRect();
    const popRect = popoverRef.current.getBoundingClientRect();
    const margin = 6;
    const viewportPadding = 8;

    const spaceBelow = window.innerHeight - anchorRect.bottom;
    const placement: 'bottom' | 'top' =
      spaceBelow >= popRect.height + margin + viewportPadding ? 'bottom' : 'top';

    const top =
      placement === 'bottom'
        ? anchorRect.bottom + margin
        : anchorRect.top - popRect.height - margin;

    let left = anchorRect.left;
    if (left + popRect.width > window.innerWidth - viewportPadding) {
      left = Math.max(viewportPadding, window.innerWidth - popRect.width - viewportPadding);
    }

    setPos({ top, left, placement });
  }, [anchorEl, state.status]);

  const filename = path.split('/').pop() ?? path;

  return createPortal(
    <div
      ref={popoverRef}
      className="chat-path-preview-popover"
      data-placement={pos?.placement ?? 'bottom'}
      style={{
        top: pos?.top ?? 0,
        left: pos?.left ?? 0,
        visibility: pos ? 'visible' : 'hidden',
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      role="tooltip"
    >
      <div className="chat-path-preview-header">
        <span className="chat-path-preview-name">{filename}</span>
        {line !== null && <span className="chat-path-preview-line">L{line}</span>}
        <span className="chat-path-preview-path" title={path}>
          {path}
        </span>
      </div>
      <div className="chat-path-preview-body">
        {state.status === 'loading' && <div className="chat-path-preview-status">加载中…</div>}
        {state.status === 'error' && (
          <>
            {state.staleSnippet && (
              <pre className="chat-path-preview-code chat-path-preview-stale">
                {state.staleSnippet.lines.map((ln, idx) => {
                  const lineNo = state.staleSnippet!.startLine + idx;
                  const isHighlight = lineNo === state.staleSnippet!.highlightLine;
                  return (
                    <div
                      key={lineNo}
                      className="chat-path-preview-row"
                      data-highlight={isHighlight ? 'true' : undefined}
                    >
                      <span className="chat-path-preview-lineno">{lineNo}</span>
                      <span className="chat-path-preview-text">{ln.length === 0 ? '\u00A0' : ln}</span>
                    </div>
                  );
                })}
              </pre>
            )}
            <div className="chat-path-preview-status chat-path-preview-error">{state.error}</div>
          </>
        )}
        {state.status === 'ready' && (
          <pre className="chat-path-preview-code">
            {state.snippet.lines.map((ln, idx) => {
              const lineNo = state.snippet.startLine + idx;
              const isHighlight = lineNo === state.snippet.highlightLine;
              return (
                <div
                  key={lineNo}
                  className="chat-path-preview-row"
                  data-highlight={isHighlight ? 'true' : undefined}
                >
                  <span className="chat-path-preview-lineno">{lineNo}</span>
                  <span className="chat-path-preview-text">{ln.length === 0 ? '\u00A0' : ln}</span>
                </div>
              );
            })}
          </pre>
        )}
        {state.status === 'ready' && state.snippet.totalLines > state.snippet.endLine && (
          <div className="chat-path-preview-footer">
            共 {state.snippet.totalLines} 行 · 点击打开查看完整内容
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
