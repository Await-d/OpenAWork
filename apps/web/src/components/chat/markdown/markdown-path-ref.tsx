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
  const { openRef, isAvailable } = useFileEditorContext();
  // 可用性走响应式布尔，不在渲染期读 ref —— 渲染期读 `.current` 会让 React Compiler
  // 放弃优化本组件（"Cannot access refs during render"）。
  const canOpen = isAvailable;
  const hover = usePathHoverPreview({ enabled: canOpen });
  // 刻意先解构再用：把 `hover.setAnchorEl` 这种**成员访问**直接塞进 `ref=`
  // 会被 React Compiler 判成渲染期访问 ref（实测与命名无关——换成中性名字同样脱靶，
  // 解构成本地变量则正常编译）。它传的其实是个 state setter，不是 ref。
  const { setAnchorEl } = hover;

  const handleClick = useCallback(() => {
    const openFile = openRef.current;
    if (!openFile) return;
    // Forward the parsed line (e.g. `foo.ts:30`) so the editor lands on it
    // instead of always snapping to line 1.
    openFile(path, line != null ? { line } : undefined);
  }, [openRef, path, line]);

  return (
    <>
      <button
        ref={setAnchorEl}
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
      {hover.open && hover.anchorEl ? (
        <PathPreviewPopover
          anchorEl={hover.anchorEl}
          path={path}
          line={line}
          onMouseEnter={hover.panelHandlers.onMouseEnter}
          onMouseLeave={hover.panelHandlers.onMouseLeave}
        />
      ) : null}
    </>
  );
}
