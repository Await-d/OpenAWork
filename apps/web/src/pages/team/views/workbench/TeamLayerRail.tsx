/**
 * TeamLayerRail · 横向可滚动「层」按钮轨
 *
 * 展示团队各 layer 的状态，active 高亮，live 小点，failed 用 warning/error 色。
 */

import type { CSSProperties } from 'react';

export interface TeamLayerRailLayer {
  readonly id: string;
  readonly code: string | null;
  readonly name: string;
  readonly color: string;
  readonly state: 'running' | 'paused' | 'failed' | 'idle' | string;
  readonly stateLabel?: string;
  readonly live?: boolean;
}

export interface TeamLayerRailProps {
  readonly layers: readonly TeamLayerRailLayer[];
  readonly activeLayerId: string | null;
  readonly onSelect: (layerId: string) => void;
}

const railStyle: CSSProperties = {
  display: 'flex',
  gap: 0,
  overflowX: 'auto',
  overflowY: 'hidden',
  padding: 0,
  scrollbarWidth: 'thin',
  scrollbarColor: 'var(--border-default) transparent',
};

function layerButtonStyle(isActive: boolean, layerColor: string): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    flexShrink: 0,
    minHeight: 28,
    padding: '0 10px',
    borderRadius: 0,
    borderTop: 'none',
    borderBottom: 'none',
    borderLeft: 'none',
    borderRight: '1px solid var(--border-default)',
    background: isActive
      ? `color-mix(in srgb, ${layerColor} 12%, var(--bg-base))`
      : 'var(--bg-base)',
    color: isActive ? layerColor : 'var(--fg-muted)',
    fontSize: 11,
    fontWeight: 650,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  };
}

const dotBase: CSSProperties = {
  width: 6,
  height: 6,
  borderRadius: '50%',
  flexShrink: 0,
};

function stateColor(state: string): string {
  switch (state) {
    case 'failed':
      return 'var(--warning)';
    case 'running':
      return 'var(--success)';
    case 'paused':
      return 'var(--fg-muted)';
    default:
      return 'var(--fg-subtle)';
  }
}

export function TeamLayerRail({ layers, activeLayerId, onSelect }: TeamLayerRailProps) {
  if (layers.length === 0) {
    return (
      <div
        style={{ fontSize: 12, color: 'var(--fg-subtle)', padding: '4px 0' }}
        aria-label="暂无层数据"
      >
        暂无层数据
      </div>
    );
  }

  return (
    <nav aria-label="层列表" style={railStyle}>
      {layers.map((layer) => {
        const isActive = layer.id === activeLayerId;
        const borderColor =
          layer.state === 'failed' ? 'var(--warning)' : layerColor(layer.color, isActive);

        return (
          <button
            key={layer.id}
            type="button"
            aria-pressed={isActive}
            style={{
              ...layerButtonStyle(isActive, borderColor),
              borderRightColor: borderColor,
              color: isActive ? borderColor : 'var(--fg-muted)',
            }}
            onClick={() => onSelect(layer.id)}
          >
            {/* live 点 */}
            {layer.live && (
              <span style={{ ...dotBase, background: 'var(--success)' }} aria-label="实时连接" />
            )}

            {/* 状态点 */}
            {!layer.live && layer.state !== 'idle' && (
              <span
                style={{ ...dotBase, background: stateColor(layer.state) }}
                aria-label={layer.stateLabel ?? layer.state}
              />
            )}

            {layer.code ? <span style={{ opacity: 0.65 }}>{layer.code}</span> : null}

            <span>{layer.name}</span>

            {layer.stateLabel && layer.state !== 'idle' && layer.state !== 'running' ? (
              <span style={{ fontSize: 10, opacity: 0.7 }}>{layer.stateLabel}</span>
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}

function layerColor(color: string, isActive: boolean): string {
  return color || (isActive ? 'var(--accent)' : 'var(--border-default)');
}
