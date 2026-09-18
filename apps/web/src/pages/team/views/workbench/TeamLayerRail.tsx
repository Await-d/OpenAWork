/**
 * TeamLayerRail · 层级导轨（胶囊 chips 行）
 *
 * 主次分层中的 L2 主筛选：每层一枚胶囊，层色通过 `--team-layer-color`
 * 变量交给 `team-workbench-controls.css` 的 `.team-wb-layer-chip` 计算
 * 选中态背景 / 描边；组件只负责结构与实时 / 状态点。
 *
 * 层色不再直接写成按钮的内联 background —— 内联背景会压掉 CSS 的
 * hover / active / focus-visible 态，按钮会退化成「点了没反馈」的静态色块。
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

type LayerChipStyle = CSSProperties & Record<'--team-layer-color', string>;

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
      <div className="team-wb-layer-rail-empty" aria-label="暂无层数据">
        暂无层数据
      </div>
    );
  }

  return (
    <nav aria-label="层列表" className="team-wb-chip-scroll">
      {layers.map((layer) => {
        const isActive = layer.id === activeLayerId;
        const chipStyle: LayerChipStyle = {
          '--team-layer-color': layer.color || 'var(--accent)',
        };

        return (
          <button
            key={layer.id}
            type="button"
            aria-pressed={isActive}
            className="team-wb-layer-chip"
            style={chipStyle}
            onClick={() => onSelect(layer.id)}
          >
            {/* live 点 */}
            {layer.live ? (
              <span
                className="team-wb-chip-dot"
                style={{ background: 'var(--success)' }}
                aria-label="实时连接"
              />
            ) : layer.state !== 'idle' ? (
              /* 状态点 */
              <span
                className="team-wb-chip-dot"
                style={{ background: stateColor(layer.state) }}
                aria-label={layer.stateLabel ?? layer.state}
              />
            ) : null}

            {layer.code ? <span className="team-wb-layer-chip-code">{layer.code}</span> : null}

            <span>{layer.name}</span>

            {layer.stateLabel && layer.state !== 'idle' && layer.state !== 'running' ? (
              <span className="team-wb-layer-chip-state">{layer.stateLabel}</span>
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}
