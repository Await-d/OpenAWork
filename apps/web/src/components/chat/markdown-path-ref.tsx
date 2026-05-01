import { useCallback, useEffect, useRef, useState } from 'react';
import { useFileEditorContext } from '../../App.js';
import { PathPreviewPopover } from './file-preview/path-preview-popover.js';

/**
 * Delays before opening / closing the hover popover. The open delay
 * filters out incidental cursor crossings; the close delay creates a
 * "bridge" so users can move from the trigger button into the
 * popover without it disappearing mid-traverse.
 */
const HOVER_OPEN_DELAY_MS = 250;
const HOVER_CLOSE_DELAY_MS = 120;

/**
 * Inline clickable element rendered in chat markdown text where a
 * path reference (`apps/web/src/foo.ts:30`) was detected. Clicking
 * dispatches through the existing `FileEditorContext`, which
 * `App.tsx` wires to `useFileEditor.openFile`. The optional `line`
 * is currently ignored by `openFile` but is included in the rendered
 * label so users keep the visual locator.
 *
 * On hover (after a short delay) a portal popover fetches the file
 * content via the gateway's `/workspace/file` endpoint and shows a
 * 5-line snippet centred on `line` (or the file head when `line` is
 * null). The hover-bridge timer keeps the popover open while the
 * cursor traverses the gap to the panel.
 */
export function MarkdownPathRef({
  path,
  line,
  raw,
}: {
  path: string;
  line: number | null;
  raw: string;
}) {
  const fileEditorRef = useFileEditorContext();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);

  const handleClick = useCallback(() => {
    const openFile = fileEditorRef.current;
    if (!openFile) return;
    openFile(path);
  }, [fileEditorRef, path]);

  const clearOpenTimer = useCallback(() => {
    if (openTimerRef.current) {
      clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
  }, []);
  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const handleMouseEnter = useCallback(() => {
    clearCloseTimer();
    if (open) return;
    clearOpenTimer();
    openTimerRef.current = setTimeout(() => {
      setOpen(true);
    }, HOVER_OPEN_DELAY_MS);
  }, [clearCloseTimer, clearOpenTimer, open]);

  const handleMouseLeave = useCallback(() => {
    clearOpenTimer();
    clearCloseTimer();
    closeTimerRef.current = setTimeout(() => {
      setOpen(false);
    }, HOVER_CLOSE_DELAY_MS);
  }, [clearCloseTimer, clearOpenTimer]);

  // Popover hover handlers — same bridge timer keeps it open while
  // the cursor is over the panel itself.
  const handlePopoverEnter = useCallback(() => {
    clearCloseTimer();
  }, [clearCloseTimer]);
  const handlePopoverLeave = useCallback(() => {
    clearCloseTimer();
    closeTimerRef.current = setTimeout(() => {
      setOpen(false);
    }, HOVER_CLOSE_DELAY_MS);
  }, [clearCloseTimer]);

  // Cleanup on unmount so detached components don't fire setState.
  useEffect(() => {
    return () => {
      clearOpenTimer();
      clearCloseTimer();
    };
  }, [clearOpenTimer, clearCloseTimer]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="chat-markdown-path-ref"
        data-has-line={line !== null ? 'true' : undefined}
        onClick={handleClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onFocus={handleMouseEnter}
        onBlur={handleMouseLeave}
        title={`点击打开 ${path}${line !== null ? `:${line}` : ''}`}
      >
        {raw}
      </button>
      {open && buttonRef.current && (
        <PathPreviewPopover
          anchorEl={buttonRef.current}
          path={path}
          line={line}
          onMouseEnter={handlePopoverEnter}
          onMouseLeave={handlePopoverLeave}
        />
      )}
    </>
  );
}
