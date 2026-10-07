import { useCallback } from 'react';
import { useFileEditorContext } from '../../../App.js';
import { PathPreviewPopover } from '../file-preview/path-preview-popover.js';
import { usePathHoverPreview } from '../file-preview/use-path-hover-preview.js';

/**
 * Inline clickable element rendered in chat markdown text where a
 * path reference (`apps/web/src/foo.ts:30`) was detected. Clicking
 * dispatches through the existing `FileEditorContext`, which
 * `App.tsx` wires to `useFileEditor.openFile`. The optional `line`
 * is forwarded so the editor scrolls to and selects that line; when
 * absent the file opens at the top.
 *
 * On hover (after a short delay) a portal popover fetches the file
 * content via the gateway's `/workspace/file` endpoint and shows a
 * 5-line snippet centred on `line` (or the file head when `line` is
 * null). The hover-bridge timer keeps the popover open while the
 * cursor traverses the gap to the panel.
 *
 * The hover / bridge timing lives in `usePathHoverPreview` so every
 * other place that renders a clickable path (tool output previews,
 * the modified-files summary card) behaves identically.
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
  // 必须是 `!= null`：context 为 null（产物查看器等非聊天页）时必须降级为纯文本，
  // 否则会出现「有交互样式却点不动」的死按钮。
  const canOpen = fileEditorRef?.current != null;
  const hover = usePathHoverPreview({ enabled: canOpen });

  const handleClick = useCallback(() => {
    const openFile = fileEditorRef?.current;
    if (!openFile) return;
    // Forward the parsed line (e.g. `foo.ts:30`) so the editor lands on it
    // instead of always snapping to line 1.
    openFile(path, line != null ? { line } : undefined);
  }, [fileEditorRef, path, line]);

  return (
    <>
      <button
        ref={hover.anchorRef}
        type="button"
        className="chat-markdown-path-ref"
        data-has-line={line !== null ? 'true' : undefined}
        onClick={handleClick}
        onMouseEnter={hover.triggerHandlers.onMouseEnter}
        onMouseLeave={hover.triggerHandlers.onMouseLeave}
        onFocus={hover.triggerHandlers.onFocus}
        onBlur={hover.triggerHandlers.onBlur}
        title={`点击打开 ${path}${line !== null ? `:${line}` : ''}`}
      >
        {raw}
      </button>
      {hover.open && hover.anchorRef.current && (
        <PathPreviewPopover
          anchorEl={hover.anchorRef.current}
          path={path}
          line={line}
          onMouseEnter={hover.panelHandlers.onMouseEnter}
          onMouseLeave={hover.panelHandlers.onMouseLeave}
        />
      )}
    </>
  );
}
