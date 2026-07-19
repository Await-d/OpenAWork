import { useCallback } from 'react';
import { PanelResizeHandle } from '../../../components/layout/shared/PanelResizeHandle.js';
import { useUIStateStore } from '../../../stores/ui/uiState.js';
import {
  FusionSessionSidePanel,
  type FusionSessionSidePanelProps,
} from './FusionSessionSidePanel.js';

export type FusionDockedSidePanelProps = FusionSessionSidePanelProps;

export function FusionDockedSidePanel(props: FusionDockedSidePanelProps) {
  const width = useUIStateStore((s) => s.reviewPanelWidth);
  const setWidth = useUIStateStore((s) => s.setReviewPanelWidth);
  const handleResize = useCallback(
    (delta: number) => {
      setWidth(width - delta);
    },
    [setWidth, width],
  );

  return (
    <>
      <PanelResizeHandle
        direction="horizontal"
        onResize={handleResize}
        ariaLabel="拖拽调整面板宽度"
        style={{ flexShrink: 0, width: 8 }}
      />
      <div
        className="fusion-docked-side-panel"
        data-testid="fusion-docked-side-panel"
        style={{
          flex: `1 1 ${width}px`,
          maxWidth: width,
          width,
        }}
      >
        <FusionSessionSidePanel {...props} />
      </div>
    </>
  );
}
