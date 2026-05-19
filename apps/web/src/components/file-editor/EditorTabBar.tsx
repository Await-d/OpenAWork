import { type DragEvent, useCallback, useEffect, useRef, useState } from 'react';
import type { OpenFile } from '../../hooks/useFileEditor.js';
import { FileIcon } from './FileIcon.js';

export function EditorTabBar({
  files,
  activeFilePath,
  isDirty,
  isPreviewAvailable,
  onActivate,
  onClose,
  onPreview,
  onContextMenu,
  onReorder,
  previewFilePath,
}: {
  files: OpenFile[];
  activeFilePath: string | null;
  isDirty: (path: string) => boolean;
  isPreviewAvailable: (path: string) => boolean;
  onActivate: (path: string) => void;
  onClose: (path: string) => void;
  onPreview: (path: string) => void;
  onContextMenu?: (path: string, x: number, y: number) => void;
  onReorder?: (fromIndex: number, toIndex: number) => void;
  previewFilePath: string | null;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const dragSrcIndexRef = useRef<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [dropPosition, setDropPosition] = useState<'before' | 'after' | null>(null);
  const autoScrollRafRef = useRef<number | null>(null);
  const autoScrollDirRef = useRef<-1 | 0 | 1>(0);

  // ─────────── Wheel: vertical deltaY → horizontal scroll ───────────
  // Only intercept when the bar is actually overflowing horizontally,
  // and only translate vertical wheel events (mouse wheel) — touchpad
  // horizontal swipes already work natively via deltaX.
  //
  // Re-attach when `files.length` changes because the early `return null`
  // path unmounts the container; the ref needs to be re-bound after
  // remount. Also using `passive: false` so we can preventDefault.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handleWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth) return;
      // Mouse wheel: deltaY != 0, deltaX == 0. Translate to horizontal.
      // Touchpads with horizontal swipes set deltaX directly — let those
      // through unchanged.
      if (e.deltaY !== 0 && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault();
        el.scrollLeft += e.deltaY;
      }
    };
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [files.length]);

  // ─────────── Auto-scroll while dragging near edges ───────────
  const stopAutoScroll = useCallback(() => {
    if (autoScrollRafRef.current !== null) {
      cancelAnimationFrame(autoScrollRafRef.current);
      autoScrollRafRef.current = null;
    }
    autoScrollDirRef.current = 0;
  }, []);

  const ensureAutoScrollLoop = useCallback(() => {
    if (autoScrollRafRef.current !== null) return;
    const tick = () => {
      const el = scrollRef.current;
      const dir = autoScrollDirRef.current;
      if (!el || dir === 0) {
        autoScrollRafRef.current = null;
        return;
      }
      el.scrollLeft += dir * 14;
      autoScrollRafRef.current = requestAnimationFrame(tick);
    };
    autoScrollRafRef.current = requestAnimationFrame(tick);
  }, []);

  const updateAutoScrollFromClientX = useCallback(
    (clientX: number) => {
      const el = scrollRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const edge = 48;
      if (clientX < rect.left + edge && el.scrollLeft > 0) {
        autoScrollDirRef.current = -1;
        ensureAutoScrollLoop();
      } else if (
        clientX > rect.right - edge &&
        el.scrollLeft + el.clientWidth < el.scrollWidth
      ) {
        autoScrollDirRef.current = 1;
        ensureAutoScrollLoop();
      } else {
        autoScrollDirRef.current = 0;
      }
    },
    [ensureAutoScrollLoop],
  );

  useEffect(() => () => stopAutoScroll(), [stopAutoScroll]);

  // ─────────── Drag handlers ───────────
  const handleDragStart = useCallback(
    (index: number) => (e: DragEvent<HTMLDivElement>) => {
      if (!onReorder) return;
      dragSrcIndexRef.current = index;
      e.dataTransfer.effectAllowed = 'move';
      // Required by Firefox to actually start a drag.
      try {
        e.dataTransfer.setData('text/plain', String(index));
      } catch {
        // Some browsers throw in restricted contexts — safe to ignore.
      }
    },
    [onReorder],
  );

  const handleDragOver = useCallback(
    (index: number) => (e: DragEvent<HTMLDivElement>) => {
      if (!onReorder) return;
      if (dragSrcIndexRef.current === null) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      // Decide before/after based on cursor position within the tab.
      const rect = e.currentTarget.getBoundingClientRect();
      const isAfter = e.clientX > rect.left + rect.width / 2;
      setDragOverIndex(index);
      setDropPosition(isAfter ? 'after' : 'before');
      updateAutoScrollFromClientX(e.clientX);
    },
    [onReorder, updateAutoScrollFromClientX],
  );

  const handleDragLeave = useCallback(() => {
    // Only the leave at end-of-drag matters; intermediate leaves are
    // followed by another dragover. The dragend handler clears state.
  }, []);

  const handleDrop = useCallback(
    (index: number) => (e: DragEvent<HTMLDivElement>) => {
      if (!onReorder) return;
      e.preventDefault();
      const from = dragSrcIndexRef.current;
      dragSrcIndexRef.current = null;
      stopAutoScroll();
      const wasAfter = dropPosition === 'after';
      setDragOverIndex(null);
      setDropPosition(null);
      if (from === null || from === index) return;
      // Compute the target index accounting for "before/after" hover
      // and the fact that removing the source shifts later indices.
      let to = wasAfter ? index + 1 : index;
      if (from < to) to -= 1;
      if (to === from) return;
      onReorder(from, to);
    },
    [onReorder, dropPosition, stopAutoScroll],
  );

  const handleDragEnd = useCallback(() => {
    dragSrcIndexRef.current = null;
    setDragOverIndex(null);
    setDropPosition(null);
    stopAutoScroll();
  }, [stopAutoScroll]);

  if (files.length === 0) return null;

  return (
    <div
      ref={scrollRef}
      style={{
        display: 'flex',
        alignItems: 'stretch',
        overflowX: 'auto',
        overflowY: 'hidden',
        flexShrink: 0,
        borderBottom: '1px solid var(--border)',
        background: 'var(--surface)',
      }}
    >
      {files.map((file, index) => {
        const active = file.path === activeFilePath;
        const dirty = isDirty(file.path);
        const previewAvailable = isPreviewAvailable(file.path);
        const previewActive = previewFilePath === file.path;
        const showBefore = dragOverIndex === index && dropPosition === 'before';
        const showAfter = dragOverIndex === index && dropPosition === 'after';
        return (
          <div
            key={file.path}
            draggable={Boolean(onReorder)}
            onDragStart={handleDragStart(index)}
            onDragOver={handleDragOver(index)}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop(index)}
            onDragEnd={handleDragEnd}
            onContextMenu={(e) => {
              if (!onContextMenu) return;
              e.preventDefault();
              onContextMenu(file.path, e.clientX, e.clientY);
            }}
            style={{
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              height: 34,
              flexShrink: 0,
              borderRight: '1px solid var(--border-subtle)',
              borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
              background: active ? 'var(--bg)' : 'transparent',
              color: active ? 'var(--text)' : 'var(--text-3)',
            }}
          >
            {showBefore && <DropIndicator side="left" />}
            <button
              type="button"
              onClick={() => onActivate(file.path)}
              title={file.name}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                padding: '0 8px',
                height: '100%',
                minWidth: 0,
                cursor: 'pointer',
                background: 'transparent',
                color: 'inherit',
                fontSize: 12,
                border: 'none',
                flexShrink: 0,
                flexGrow: 1,
              }}
            >
              <FileIcon path={file.path} size={13} />
              <span
                style={{
                  maxWidth: 120,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {file.name}
              </span>
              {dirty && (
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    background: 'var(--accent)',
                    flexShrink: 0,
                  }}
                />
              )}
            </button>
            {previewAvailable && (
              <button
                type="button"
                onClick={() => onPreview(file.path)}
                title="跳转预览"
                aria-label={`预览 ${file.name}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 18,
                  height: 18,
                  marginRight: 6,
                  alignSelf: 'center',
                  borderRadius: 4,
                  border: 'none',
                  background: previewActive
                    ? 'color-mix(in oklch, var(--accent) 16%, transparent)'
                    : 'transparent',
                  color: previewActive ? 'var(--accent)' : 'var(--text-3)',
                  cursor: 'pointer',
                  flexShrink: 0,
                  padding: 0,
                }}
              >
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              </button>
            )}
            <button
              type="button"
              onClick={() => onClose(file.path)}
              title="关闭"
              aria-label={`关闭 ${file.name}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 16,
                height: 16,
                margin: '0 10px 0 0',
                alignSelf: 'center',
                borderRadius: 3,
                border: 'none',
                background: 'transparent',
                color: 'var(--text-3)',
                cursor: 'pointer',
                flexShrink: 0,
                padding: 0,
              }}
            >
              <svg
                width="9"
                height="9"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
            {showAfter && <DropIndicator side="right" />}
          </div>
        );
      })}
    </div>
  );
}

// Thin vertical bar drawn on the leading or trailing edge of a tab to
// preview where a dragged tab will land when dropped.
function DropIndicator({ side }: { side: 'left' | 'right' }) {
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        top: 4,
        bottom: 4,
        width: 2,
        borderRadius: 2,
        background: 'var(--accent)',
        boxShadow: '0 0 0 2px color-mix(in oklch, var(--accent) 30%, transparent)',
        pointerEvents: 'none',
        ...(side === 'left' ? { left: -1 } : { right: -1 }),
      }}
    />
  );
}
