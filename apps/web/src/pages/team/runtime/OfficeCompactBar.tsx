/**
 * 260516-team-page-v2 · T-09 / T-10（视觉优化版）
 *
 * 紧凑模式的"五层流转"可视化条。
 *
 * - 折叠态 0px：隐藏流程图，由父级展示展开按钮
 * - 展开态 180px：完整流程图（圆角矩形 + 中文标签 + 状态徽标 + 箭头）
 * - 状态联动（T-10）：
 *     active   → 高亮边框 + 脉冲
 *     failed   → 红色边框
 *     completed→ 灰色填充
 *     idle     → 弱化边框
 */

import { type CSSProperties } from 'react';
import { useHandoffStore, useLayerStore, type TeamRoleLayer } from '../../../stores/team-events.js';

const COMPACT_HEIGHT = 180;
const FOLDED_HEIGHT = 0;

type LayerVisualState = 'active' | 'failed' | 'completed' | 'idle';

const ROLE_LAYER_ORDER: TeamRoleLayer[] = ['reception', 'pm1', 'pm2', 'executor', 'reviewer'];

const LAYER_LABELS: Record<TeamRoleLayer, { name: string; sub: string }> = {
  user: { name: '用户', sub: 'USER' },
  reception: { name: '接待', sub: 'RECEPTION' },
  pm1: { name: '规划', sub: 'PM1' },
  pm2: { name: '管控', sub: 'PM2' },
  executor: { name: '执行', sub: 'EXECUTOR' },
  reviewer: { name: '评审', sub: 'REVIEWER' },
};

const STATE_TO_COLOR: Record<
  LayerVisualState,
  { ring: string; fill: string; text: string; tag: string }
> = {
  active: {
    ring: 'var(--success, #22c55e)',
    fill: 'color-mix(in srgb, var(--success, #22c55e) 16%, var(--surface))',
    text: 'var(--text)',
    tag: '运行中',
  },
  failed: {
    ring: 'var(--danger, #d4574e)',
    fill: 'color-mix(in srgb, var(--danger, #d4574e) 14%, var(--surface))',
    text: 'var(--danger, #d4574e)',
    tag: '异常',
  },
  completed: {
    ring: 'color-mix(in srgb, var(--text-3) 60%, transparent)',
    fill: 'color-mix(in srgb, var(--text-3) 8%, var(--surface))',
    text: 'var(--text-2)',
    tag: '已完成',
  },
  idle: {
    ring: 'color-mix(in srgb, var(--border) 70%, transparent)',
    fill: 'color-mix(in srgb, var(--surface) 80%, var(--bg))',
    text: 'var(--text-3)',
    tag: '待命',
  },
};

const BAR_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '0 14px',
  background:
    'linear-gradient(135deg, color-mix(in srgb, var(--accent) 4%, var(--surface)) 0%, color-mix(in srgb, var(--surface) 92%, var(--bg)) 100%)',
  borderBottom: '1px solid color-mix(in srgb, var(--border) 50%, transparent)',
  transition: 'height 200ms ease, opacity 200ms ease',
  overflow: 'hidden',
  flexShrink: 0,
};

const TOGGLE_BUTTON_STYLE: CSSProperties = {
  padding: '4px 10px',
  borderRadius: 6,
  border: '1px solid color-mix(in srgb, var(--border) 60%, transparent)',
  background: 'transparent',
  color: 'var(--text-2)',
  fontSize: 11,
  cursor: 'pointer',
  flexShrink: 0,
};

export interface OfficeCompactBarProps {
  collapsed: boolean;
  onToggle: () => void;
  onFullscreen?: () => void;
}

export function OfficeCompactBar({ collapsed, onToggle, onFullscreen }: OfficeCompactBarProps) {
  const nodes = useLayerStore((s) => s.nodes);
  const handoffs = useHandoffStore((s) => s.handoffs);

  // T-10: 计算每个 role_layer 的状态
  const layerStates = new Map<TeamRoleLayer, LayerVisualState>();
  for (const node of nodes.values()) {
    const existing = layerStates.get(node.roleLayer);
    if (existing === 'failed') continue;
    if (node.state === 'failed') {
      layerStates.set(node.roleLayer, 'failed');
    } else if (node.state === 'running' || node.state === 'claimed' || node.state === 'pending') {
      layerStates.set(node.roleLayer, 'active');
    } else if (node.state === 'completed' && !existing) {
      layerStates.set(node.roleLayer, 'completed');
    }
  }
  for (const h of handoffs.values()) {
    if (h.state === 'failed') {
      layerStates.set(h.toRoleLayer, 'failed');
    } else if (h.state === 'running' || h.state === 'claimed') {
      const existing = layerStates.get(h.toRoleLayer);
      if (existing !== 'failed') layerStates.set(h.toRoleLayer, 'active');
    }
  }

  // 折叠态：仅显示标题 + 微小圆点
  if (collapsed) {
    return (
      <div
        style={{
          ...BAR_STYLE,
          height: FOLDED_HEIGHT,
          opacity: 0,
        }}
      >
        <button
          type="button"
          onClick={onToggle}
          style={TOGGLE_BUTTON_STYLE}
          aria-label="展开 3D 流程动画"
          title="展开 3D 流程动画"
        >
          ▼ 流程
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
          {ROLE_LAYER_ORDER.map((layer, i) => {
            const state = layerStates.get(layer) ?? 'idle';
            const colors = STATE_TO_COLOR[state];
            return (
              <span key={layer} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 999,
                    background: colors.ring,
                    boxShadow:
                      state === 'active'
                        ? `0 0 0 3px color-mix(in srgb, ${colors.ring} 30%, transparent)`
                        : undefined,
                  }}
                  title={`${LAYER_LABELS[layer].name}: ${colors.tag}`}
                />
                {i < ROLE_LAYER_ORDER.length - 1 ? (
                  <span style={{ color: 'var(--text-3)', fontSize: 9 }}>›</span>
                ) : null}
              </span>
            );
          })}
        </div>
      </div>
    );
  }

  // 展开态：完整流程图
  return (
    <div
      style={{
        ...BAR_STYLE,
        height: COMPACT_HEIGHT,
        opacity: 1,
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        style={TOGGLE_BUTTON_STYLE}
        aria-label="折叠流程动画"
        title="折叠流程动画"
      >
        ▲ 折叠
      </button>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 4,
          minWidth: 0,
        }}
      >
        {ROLE_LAYER_ORDER.map((layer, i) => {
          const state = layerStates.get(layer) ?? 'idle';
          const colors = STATE_TO_COLOR[state];
          const labels = LAYER_LABELS[layer];
          return (
            <div
              key={layer}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                flex: '0 1 auto',
                minWidth: 0,
              }}
            >
              <div
                className={state === 'active' ? 'team-v2-layer-card-active' : undefined}
                style={{
                  position: 'relative',
                  display: 'grid',
                  placeItems: 'center',
                  width: 'clamp(56px, 11vw, 80px)',
                  height: 76,
                  borderRadius: 14,
                  border: `2px solid ${colors.ring}`,
                  background: colors.fill,
                  color: colors.text,
                  textAlign: 'center',
                  fontWeight: 700,
                  transition: 'all 200ms ease',
                  boxShadow:
                    state === 'active'
                      ? `0 0 0 4px color-mix(in srgb, ${colors.ring} 18%, transparent)`
                      : 'none',
                  flexShrink: 0,
                }}
                title={`${labels.name} · ${colors.tag}`}
              >
                <span style={{ fontSize: 13 }}>{labels.name}</span>
                <span
                  style={{
                    fontSize: 9,
                    color: 'var(--text-3)',
                    fontWeight: 600,
                    letterSpacing: '0.05em',
                    marginTop: 2,
                  }}
                >
                  {labels.sub}
                </span>
                {state !== 'idle' ? (
                  <span
                    style={{
                      position: 'absolute',
                      top: -8,
                      right: -8,
                      padding: '1px 7px',
                      borderRadius: 999,
                      fontSize: 9,
                      fontWeight: 700,
                      background: colors.fill,
                      color: colors.ring,
                      border: `1px solid ${colors.ring}`,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {colors.tag}
                  </span>
                ) : null}
              </div>
              {i < ROLE_LAYER_ORDER.length - 1 ? (
                <ArrowSeparator
                  active={
                    layerStates.get(layer) === 'active' ||
                    layerStates.get(ROLE_LAYER_ORDER[i + 1]!) === 'active'
                  }
                />
              ) : null}
            </div>
          );
        })}
      </div>

      {onFullscreen ? (
        <button
          type="button"
          onClick={onFullscreen}
          style={TOGGLE_BUTTON_STYLE}
          aria-label="全屏 3D 流程动画"
          title="全屏 3D 流程动画"
        >
          ⛶
        </button>
      ) : null}
    </div>
  );
}

function ArrowSeparator({ active }: { active: boolean }) {
  const color = active
    ? 'var(--success, #22c55e)'
    : 'color-mix(in srgb, var(--border) 70%, transparent)';
  return (
    <svg width={28} height={20} viewBox="0 0 28 20" fill="none" aria-hidden>
      <path
        d="M2 10 H22 M16 4 L24 10 L16 16"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
