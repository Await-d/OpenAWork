import type { CSSProperties } from 'react';
import { useCallback, useState } from 'react';
import { PanelResizeHandle } from '../../../components/layout/shared/PanelResizeHandle.js';
import { useUIStateStore } from '../../../stores/ui/uiState.js';
import { ReviewPanelCollapsedRail } from './ReviewPanelCollapsedRail.js';
import { ReviewPanelContent } from './ReviewPanelContent.js';
import { ReviewPanelHeader } from './ReviewPanelHeader.js';
import {
  type ChangeScope,
  type DiffViewMode,
  formatReviewPanelStatus,
} from './review-panel-model.js';
import { useReviewPanelFileChanges } from './use-review-panel-file-changes.js';

export interface ReviewPanelProps {
  readonly gatewayUrl: string;
  readonly presentation?: 'standalone' | 'embedded';
  readonly sessionId: string | null;
  readonly token: string | null;
}

export function ReviewPanel({
  gatewayUrl,
  presentation = 'standalone',
  sessionId,
  token,
}: ReviewPanelProps) {
  const opened = useUIStateStore((s) => s.reviewPanelOpened);
  const width = useUIStateStore((s) => s.reviewPanelWidth);
  const setReviewPanelWidth = useUIStateStore((s) => s.setReviewPanelWidth);
  const toggleReviewPanelOpened = useUIStateStore((s) => s.toggleReviewPanelOpened);
  const [changeScope, setChangeScope] = useState<ChangeScope>('all');
  const [diffViewMode, setDiffViewMode] = useState<DiffViewMode>('unified');
  const contentState = useReviewPanelFileChanges({ gatewayUrl, opened, sessionId, token });
  const panelStatus = formatReviewPanelStatus(contentState, changeScope);

  const handleResize = useCallback(
    (delta: number) => {
      setReviewPanelWidth(width + delta);
    },
    [setReviewPanelWidth, width],
  );

  const embedded = presentation === 'embedded';

  if (!opened) {
    if (embedded) {
      return null;
    }

    return <ReviewPanelCollapsedRail onOpen={toggleReviewPanelOpened} />;
  }

  return (
    <div
      role="complementary"
      aria-label="代码审查面板"
      style={{
        display: 'flex',
        flexDirection: 'row',
        flexShrink: 0,
        height: '100%',
        overflow: embedded ? 'hidden' : 'visible',
        position: 'relative',
        width: embedded ? '100%' : width,
      }}
    >
      {!embedded ? (
        <PanelResizeHandle
          direction="horizontal"
          onResize={handleResize}
          ariaLabel="调整审查面板宽度"
          style={{ height: '100%', left: -2, position: 'absolute', top: 0 }}
        />
      ) : null}

      <div
        style={{
          background: embedded ? 'var(--bg-surface)' : 'var(--bg-base)',
          borderLeft: embedded ? 'none' : '1px solid var(--border-subtle)',
          display: 'flex',
          flex: 1,
          flexDirection: 'column',
          height: '100%',
          overflow: 'hidden',
        }}
      >
        <ReviewPanelHeader
          changeScope={changeScope}
          diffViewMode={diffViewMode}
          onChangeScope={setChangeScope}
          onChangeViewMode={setDiffViewMode}
          onClose={toggleReviewPanelOpened}
          status={panelStatus}
        />

        <div
          style={{
            display: 'flex',
            flex: 1,
            flexDirection: 'column',
            gap: 'var(--spacing-3)',
            minHeight: 0,
            overflowY: 'auto',
            padding: 'var(--spacing-3)',
          }}
        >
          <ReviewPanelContent
            changeScope={changeScope}
            diffViewMode={diffViewMode}
            state={contentState}
          />
        </div>
      </div>
    </div>
  );
}
