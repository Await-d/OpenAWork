import { useState, useCallback, useRef, useEffect } from 'react';
import { useTeamRuntimeReferenceViewData } from './team-runtime-reference-data.js';
import { PANEL_STYLE } from './team-runtime-shared.js';
import { XIcon, PauseIcon, ResumeIcon } from './TeamIcons.js';

/* ── Old 2D canvas components removed ── */

export interface OfficeSceneState {
  zoom: number;
  setZoom: React.Dispatch<React.SetStateAction<number>>;
  pan: { x: number; y: number };
  setPan: React.Dispatch<React.SetStateAction<{ x: number; y: number }>>;
  agentPaused: Set<string>;
  toggleAgentPause: (id: string) => void;
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
  const [agentPaused, setAgentPaused] = useState<Set<string>>(new Set());
  const [stageFrame, setStageFrame] = useState({ left: 0, top: 0, width: 0, height: 0 });
  const dragRef = useRef<{
    startX: number;
    startY: number;
    panStartX: number;
    panStartY: number;
  } | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  const toggleAgentPause = useCallback((id: string) => {
    setAgentPaused((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

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
    agentPaused,
    toggleAgentPause,
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
  const { canManageRuntime, officeAgents } = useTeamRuntimeReferenceViewData();
  const { agentPaused, toggleAgentPause } = state;

  const selectedAgent = officeAgents.find((a) => a.id === selectedAgentId);

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
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>场景信息</span>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: 'var(--text-2)' }}>在线角色</span>
            <span
              style={{
                fontSize: 11,
                color: 'var(--text)',
                fontWeight: 700,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {officeAgents.length - agentPaused.size}/{officeAgents.length}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: 'var(--text-2)' }}>已暂停</span>
            <span
              style={{
                fontSize: 11,
                color: 'var(--text)',
                fontWeight: 700,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {agentPaused.size}
            </span>
          </div>
        </div>

        {selectedAgent ? (
          <div
            style={{
              padding: '10px 12px',
              borderRadius: 10,
              background: 'color-mix(in oklch, var(--surface) 94%, var(--bg))',
              border: '1px solid var(--border)',
              boxShadow: 'var(--shadow-sm)',
              display: 'grid',
              gap: 6,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)' }}>
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
                <XIcon size={11} color="var(--text-3)" />
              </button>
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: agentPaused.has(selectedAgent.id)
                    ? 'var(--warning)'
                    : 'var(--success)',
                  boxShadow: agentPaused.has(selectedAgent.id) ? 'none' : '0 0 4px var(--success)',
                }}
              />
              <span style={{ fontSize: 11, color: 'var(--text-2)', fontWeight: 600 }}>
                {agentPaused.has(selectedAgent.id) ? '已暂停' : '运行中'}
              </span>
            </div>
            {selectedAgent.note && (
              <span style={{ fontSize: 10, color: 'var(--text-3)', lineHeight: 1.4 }}>
                {selectedAgent.note}
              </span>
            )}
            {canManageRuntime ? (
              <div style={{ display: 'flex', gap: 6, padding: '2px 0' }}>
                <button
                  type="button"
                  onClick={() => toggleAgentPause(selectedAgent.id)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '3px 8px',
                    borderRadius: 6,
                    border: agentPaused.has(selectedAgent.id)
                      ? '1px solid color-mix(in oklch, var(--success) 40%, transparent)'
                      : '1px solid color-mix(in oklch, var(--warning) 40%, transparent)',
                    background: agentPaused.has(selectedAgent.id)
                      ? 'color-mix(in oklch, var(--success) 10%, var(--bg))'
                      : 'color-mix(in oklch, var(--warning) 10%, var(--bg))',
                    color: agentPaused.has(selectedAgent.id) ? 'var(--success)' : 'var(--warning)',
                    fontSize: 10,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {agentPaused.has(selectedAgent.id) ? (
                    <ResumeIcon size={9} color="var(--success)" />
                  ) : (
                    <PauseIcon size={9} color="var(--warning)" />
                  )}
                  {agentPaused.has(selectedAgent.id) ? '恢复' : '暂停'}
                </button>
              </div>
            ) : (
              <span style={{ fontSize: 10, color: 'var(--text-3)' }}>运行状态由共享会话驱动</span>
            )}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginTop: 2,
              }}
            >
              <span
                style={{ fontSize: 9, color: 'var(--text-3)', fontVariantNumeric: 'tabular-nums' }}
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
              border: '1px dashed var(--border)',
              color: 'var(--text-3)',
              fontSize: 11,
              lineHeight: 1.5,
            }}
          >
            点击左侧角色查看详情。当前运行状态由共享会话驱动。
          </div>
        )}
      </div>
    </div>
  );
}
