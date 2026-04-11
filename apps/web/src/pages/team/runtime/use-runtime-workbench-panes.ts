import { useCallback, useMemo, useRef, useState } from 'react';

const ACTIVITY_RAIL_WIDTH = 56;
const SIDEBAR_DEFAULT_WIDTH = 280;
const SIDEBAR_MIN_WIDTH = 240;
const SIDEBAR_MAX_WIDTH = 340;
const DETAIL_DEFAULT_WIDTH = 340;
const DETAIL_MIN_WIDTH = 300;
const DETAIL_MAX_WIDTH = 380;

type PaneKey = 'detail' | 'sidebar';

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function useRuntimeWorkbenchPanes({
  isSingleColumn,
  isTwoColumn,
}: {
  isSingleColumn: boolean;
  isTwoColumn: boolean;
}) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [detailCollapsed, setDetailCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT_WIDTH);
  const [detailWidth, setDetailWidth] = useState(DETAIL_DEFAULT_WIDTH);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((current) => !current);
  }, []);

  const toggleDetail = useCallback(() => {
    setDetailCollapsed((current) => !current);
  }, []);

  const resetLayout = useCallback(() => {
    setSidebarCollapsed(false);
    setDetailCollapsed(false);
    setSidebarWidth(SIDEBAR_DEFAULT_WIDTH);
    setDetailWidth(DETAIL_DEFAULT_WIDTH);
  }, []);

  const startPaneResize = useCallback(
    (pane: PaneKey) => (event: React.PointerEvent<HTMLButtonElement>) => {
      if (isSingleColumn || !frameRef.current) {
        return;
      }

      event.preventDefault();
      const frameRect = frameRef.current.getBoundingClientRect();

      const handlePointerMove = (moveEvent: PointerEvent) => {
        if (pane === 'sidebar') {
          const nextWidth = clamp(
            moveEvent.clientX - frameRect.left - ACTIVITY_RAIL_WIDTH,
            SIDEBAR_MIN_WIDTH,
            isTwoColumn ? 300 : SIDEBAR_MAX_WIDTH,
          );
          setSidebarCollapsed(false);
          setSidebarWidth(nextWidth);
          return;
        }

        const nextWidth = clamp(
          frameRect.right - moveEvent.clientX,
          DETAIL_MIN_WIDTH,
          isTwoColumn ? 340 : DETAIL_MAX_WIDTH,
        );
        setDetailCollapsed(false);
        setDetailWidth(nextWidth);
      };

      const stopResize = () => {
        window.removeEventListener('pointermove', handlePointerMove);
      };

      window.addEventListener('pointermove', handlePointerMove);
      window.addEventListener('pointerup', stopResize, { once: true });
    },
    [isSingleColumn, isTwoColumn],
  );

  const gridTemplateColumns = useMemo(() => {
    if (isSingleColumn) {
      return 'minmax(0, 1fr)';
    }

    const sidebarColumn = sidebarCollapsed ? '0px' : `${sidebarWidth}px`;
    const detailColumn = detailCollapsed ? '0px' : `${detailWidth}px`;

    return `${ACTIVITY_RAIL_WIDTH}px ${sidebarColumn} minmax(0, 1fr) ${detailColumn}`;
  }, [detailCollapsed, detailWidth, isSingleColumn, sidebarCollapsed, sidebarWidth]);

  return {
    detailCollapsed,
    frameRef,
    gridTemplateColumns,
    resetLayout,
    sidebarCollapsed,
    startDetailResize: startPaneResize('detail'),
    startSidebarResize: startPaneResize('sidebar'),
    toggleDetail,
    toggleSidebar,
  };
}
