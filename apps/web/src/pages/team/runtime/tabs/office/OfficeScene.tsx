import { useState, useRef, useEffect } from 'react';
import { useTeamRuntimeReferenceViewData } from '../../data/team-runtime-reference-data.js';
import { PANEL_STYLE } from '../../shared/team-runtime-shared.js';
import { XIcon } from '../../shared/TeamIcons.js';

/* ── Old 2D canvas components removed ── */

export interface OfficeSceneState {
  zoom: number;
  setZoom: React.Dispatch<React.SetStateAction<number>>;
  pan: { x: number; y: number };
  setPan: React.Dispatch<React.SetStateAction<{ x: number; y: number }>>;
  stageFrame: { left: number; top: number; width: number; height: number };
  dragRef: React.MutableRefObject<{
    startX: number;
    startY: number;
    panStartX: number;
    panStartY: number;
  } | null>;
  canvasRef: React.RefObject<HTMLDivElement | null>;
}

export function useOfficeSceneState(): OfficeSceneState {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [stageFrame, setStageFrame] = useState({ left: 0, top: 0, width: 0, height: 0 });
  const dragRef = useRef<{
    startX: number;
    startY: number;
    panStartX: number;
    panStartY: number;
  } | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = canvasRef.current;
    if (!node) return;

    const updateStageFrame = () => {
      const width = node.clientWidth;
      const height = node.clientHeight;
      const ratio = 16 / 9;

      let nextWidth = width;
      let nextHeight = width / ratio;

      if (nextHeight > height) {
        nextHeight = height;
        nextWidth = height * ratio;
      }

      setStageFrame({
        width: nextWidth,
        height: nextHeight,
        left: (width - nextWidth) / 2,
        top: (height - nextHeight) / 2,
      });
    };

    updateStageFrame();

    if (typeof ResizeObserver === 'undefined') {
      return undefined;
    }

    const observer = new ResizeObserver(updateStageFrame);
    observer.observe(node);

    return () => observer.disconnect();
  }, []);

  return {
    zoom,
    setZoom,
    pan,
    setPan,
    stageFrame,
    dragRef,
    canvasRef,
  };
}

export function OfficeSidebar({
  selectedAgentId,
  onSelectAgent,
  state,
}: {
  selectedAgentId: string;
  onSelectAgent: (id: string) => void;
  state: OfficeSceneState;
}) {
  const { officeAgents, topSummary } = useTeamRuntimeReferenceViewData();

  const selectedAgent = officeAgents.find((a) => a.id === selectedAgentId);
  const restingCount = officeAgents.filter((agent) => agent.status === 'resting').length;
  const onlineCount = Math.max(0, officeAgents.length - restingCount);
  const isSessionPaused = topSummary.status === '已暂停';
  const selectedAgentIsResting = selectedAgent?.status === 'resting';
  const selectedAgentStatusLabel = isSessionPaused
    ? '团队已暂停'
    : selectedAgentIsResting
      ? '休息中'
      : selectedAgent?.status === 'discussing'
        ? '讨论中'
        : '运行中';
  const selectedAgentDotColor =
    isSessionPaused || selectedAgentIsResting
      ? 'var(--warning)'
      : selectedAgent?.status === 'discussing'
        ? 'var(--accent)'
        : 'var(--success)';

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div
        style={{
          ...PANEL_STYLE,
          padding: '10px 12px',
          borderRadius: 10,
          display: 'grid',
          gap: 10,
          alignContent: 'start',
        }}
      >
        <div style={{ display: 'grid', gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--fg-strong)' }}>场景信息</span>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: 'var(--fg-default)' }}>在线角色</span>
            <span
              style={{
                fontSize: 11,
                color: 'var(--fg-strong)',
                fontWeight: 700,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {onlineCount}/{officeAgents.length}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: 'var(--fg-default)' }}>休息中</span>
            <span
              style={{
                fontSize: 11,
                color: 'var(--fg-strong)',
                fontWeight: 700,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {restingCount}
            </span>
          </div>
        </div>

        {selectedAgent ? (
          <div
            style={{
              padding: '10px 12px',
              borderRadius: 10,
              background: 'color-mix(in oklch, var(--bg-overlay) 94%, var(--bg-base))',
              border: '1px solid var(--border-default)',
              boxShadow: 'var(--shadow-sm)',
              display: 'grid',
              gap: 6,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--fg-strong)' }}>
                {selectedAgent.label}
              </span>
              <button
                type="button"
                onClick={() => onSelectAgent(selectedAgent.id)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 0,
                  display: 'inline-flex',
                  alignItems: 'center',
                }}
              >
                <XIcon size={11} color="var(--fg-muted)" />
              </button>
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: selectedAgentDotColor,
                  boxShadow: selectedAgentIsResting ? 'none' : `0 0 4px ${selectedAgentDotColor}`,
                }}
              />
              <span style={{ fontSize: 11, color: 'var(--fg-default)', fontWeight: 600 }}>
                {selectedAgentStatusLabel}
              </span>
            </div>
            {selectedAgent.note && (
              <span style={{ fontSize: 10, color: 'var(--fg-muted)', lineHeight: 1.4 }}>
                {selectedAgent.note}
              </span>
            )}
            <span style={{ fontSize: 10, color: 'var(--fg-muted)' }}>
              运行状态由团队执行链路驱动，不支持在 3D 场景中本地暂停单个角色。
            </span>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginTop: 2,
              }}
            >
              <span
                style={{
                  fontSize: 9,
                  color: 'var(--fg-muted)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                位置: ({selectedAgent.x}%, {selectedAgent.y}%)
              </span>
              {selectedAgent.crown && (
                <span
                  style={{
                    fontSize: 9,
                    color: 'var(--warning)',
                    fontWeight: 700,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 2,
                  }}
                >
                  <span
                    style={{
                      width: 4,
                      height: 4,
                      borderRadius: '50%',
                      background: 'var(--warning)',
                    }}
                  />{' '}
                  Leader
                </span>
              )}
            </div>
          </div>
        ) : (
          <div
            style={{
              padding: '10px 12px',
              borderRadius: 10,
              border: '1px dashed var(--border-default)',
              color: 'var(--fg-muted)',
              fontSize: 11,
              lineHeight: 1.5,
            }}
          >
            点击场景中的角色查看详情。当前运行状态由团队执行链路驱动。
          </div>
        )}
      </div>
    </div>
  );
}
