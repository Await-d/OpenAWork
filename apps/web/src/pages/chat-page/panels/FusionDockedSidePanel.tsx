import { useCallback, useRef } from 'react';
import { PanelResizeHandle } from '../../../components/layout/shared/PanelResizeHandle.js';
import { useUIStateStore } from '../../../stores/ui/uiState.js';
import {
  FusionSessionSidePanel,
  type FusionSessionSidePanelProps,
} from './FusionSessionSidePanel.js';

export type FusionDockedSidePanelProps = FusionSessionSidePanelProps;

/**
 * 拖拽手柄调整的是「对话列 / 侍审查面板」之间的分栏百分比(`fusionDockSplitPos`,
 * 停靠在工作台宽度上,默认 30%-40%),而不是审查面板自身的固定像素宽度——
 * 这样对话区宽度不会随视口变化而失控膨胀。
 */
export function FusionDockedSidePanel(props: FusionDockedSidePanelProps) {
  const dockSplitPos = useUIStateStore((s) => s.fusionDockSplitPos);
  const setDockSplitPos = useUIStateStore((s) => s.setFusionDockSplitPos);
  const containerWidthRef = useRef<number>(0);
  const startPosRef = useRef<number>(0);

  const handleResizeStart = useCallback(() => {
    const container = document.querySelector('[data-testid="fusion-chat-main-shell-split"]');
    containerWidthRef.current = container?.parentElement?.clientWidth ?? window.innerWidth;
    startPosRef.current = dockSplitPos;
  }, [dockSplitPos]);

  const handleResize = useCallback(
    (delta: number) => {
      const containerWidth = containerWidthRef.current || window.innerWidth;
      const deltaPercent = (delta / containerWidth) * 100;
      setDockSplitPos(startPosRef.current + deltaPercent);
      startPosRef.current += deltaPercent;
    },
    [setDockSplitPos],
  );

  return (
    <>
      <PanelResizeHandle
        direction="horizontal"
        onResize={handleResize}
        onResizeStart={handleResizeStart}
        ariaLabel="拖拽调整面板宽度"
        style={{ flexShrink: 0, width: 8 }}
      />
      <div
        className="fusion-docked-side-panel"
        data-testid="fusion-docked-side-panel"
        style={{
          flex: '1 1 auto',
          minWidth: 0,
        }}
      >
        <FusionSessionSidePanel {...props} />
      </div>
    </>
  );
}
