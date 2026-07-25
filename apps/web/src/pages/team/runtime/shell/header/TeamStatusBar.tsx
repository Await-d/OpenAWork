/**
 * TeamStatusBar：最顶部运行状态 + 操作按钮（demo 式紧凑条）
 *
 * 只展示：
 *   - 状态 chip（运行中 / 已暂停 / 待命）
 *   - 失败 chip
 *   - 操作按钮（暂停/恢复、重试、定位、专注）
 */

import { useMemo, type CSSProperties } from 'react';
import { useHandoffStore, useLayerStore } from '../../../../../stores/team/team-events.js';
import {
  computeTeamStatusBarStats,
  filterHandoffsForStatusBar,
} from './team-status-bar-helpers.js';

const BAR_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  minHeight: 26,
  padding: 0,
  fontSize: 11,
  fontWeight: 650,
  flexWrap: 'nowrap',
  minWidth: 0,
  overflow: 'hidden',
  maxWidth: '100%',
};

const CHIP_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  minHeight: 22,
  padding: '0 7px',
  borderRadius: 0,
  border: '1px solid var(--border-default)',
  color: 'var(--fg-faint)',
  fontSize: 10,
  fontWeight: 650,
  whiteSpace: 'nowrap',
  flexShrink: 0,
  background: 'transparent',
};

const BTN_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  minHeight: 22,
  padding: '0 8px',
  borderRadius: 0,
  fontSize: 10.5,
  fontWeight: 650,
  flexShrink: 0,
  whiteSpace: 'nowrap',
  border: '1px solid var(--border-default)',
  borderRightWidth: 0,
  background: 'var(--bg-base)',
  color: 'var(--fg-muted)',
  cursor: 'pointer',
};

const BTN_LAST_STYLE: CSSProperties = {
  ...BTN_STYLE,
  borderRightWidth: 1,
};

const ACTIONS_WRAP: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 0,
  marginLeft: 4,
  flexShrink: 0,
  minWidth: 0,
};

export interface TeamStatusBarProps {
  onPauseAll?: () => void;
  onResumeAll?: () => void;
  onRetryFailed?: () => void;
  onFocusFail?: () => void;
  onToggleFocus?: () => void;
  paused?: boolean;
  focusMode?: boolean;
  failCount?: number;
  busy?: boolean;
  selectedSessionId?: string | null;
}

function statusChip(paused?: boolean, running = 0): { label: string; style: CSSProperties } {
  if (paused) {
    return {
      label: '已暂停',
      style: {
        ...CHIP_STYLE,
        color: 'var(--warning)',
        borderColor: 'color-mix(in srgb, var(--warning) 30%, var(--border-default))',
      },
    };
  }
  if (running > 0) {
    return {
      label: `运行中 ${running}`,
      style: {
        ...CHIP_STYLE,
        color: 'var(--success)',
        borderColor: 'color-mix(in srgb, var(--success) 30%, var(--border-default))',
      },
    };
  }
  return {
    label: '待命',
    style: CHIP_STYLE,
  };
}

export function TeamStatusBar({
  onPauseAll,
  onResumeAll,
  onRetryFailed,
  onFocusFail,
  onToggleFocus,
  paused,
  focusMode,
  failCount,
  busy = false,
  selectedSessionId = null,
}: TeamStatusBarProps) {
  const handoffs = useHandoffStore((s) => s.handoffs);
  const nodes = useLayerStore((s) => s.nodes);
  const scopedHandoffs = useMemo(
    () => filterHandoffsForStatusBar(handoffs.values(), nodes.values(), selectedSessionId),
    [handoffs, nodes, selectedSessionId],
  );
  const stats = useMemo(() => computeTeamStatusBarStats(scopedHandoffs), [scopedHandoffs]);
  const failed = failCount ?? stats.failed;
  const chip = statusChip(paused, stats.running);

  const hasActions = Boolean(
    (onPauseAll && !paused) ||
    (onResumeAll && paused) ||
    onRetryFailed ||
    onFocusFail ||
    onToggleFocus,
  );

  if (scopedHandoffs.length === 0 && !paused && !hasActions) {
    return (
      <div style={BAR_STYLE} role="status" aria-label="团队运行状态（待命中）">
        <span style={CHIP_STYLE}>待命</span>
      </div>
    );
  }

  return (
    <div
      style={BAR_STYLE}
      role="status"
      aria-label={paused ? '团队运行状态（已暂停）' : '团队运行状态'}
    >
      <span style={chip.style}>{chip.label}</span>
      {failed > 0 ? (
        <span
          style={{
            ...CHIP_STYLE,
            color: 'var(--danger)',
            borderColor: 'color-mix(in srgb, var(--danger) 30%, var(--border-default))',
          }}
        >
          失败 <b style={{ color: 'inherit', fontWeight: 700 }}>{failed}</b>
        </span>
      ) : null}

      {hasActions ? (
        <div style={ACTIONS_WRAP} data-team-status-actions="true">
          {(() => {
            type ActionBtn = {
              key: string;
              label: string;
              onClick?: () => void;
              color?: string;
              active?: boolean;
            };
            const actions: ActionBtn[] = [];
            if (onPauseAll && !paused) {
              actions.push({
                key: 'pause',
                label: busy ? '暂停中…' : '暂停全部',
                onClick: onPauseAll,
                color: 'var(--accent)',
              });
            }
            if (onResumeAll && paused) {
              actions.push({
                key: 'resume',
                label: busy ? '恢复中…' : '恢复全部',
                onClick: onResumeAll,
                color: 'var(--success)',
              });
            }
            if (onRetryFailed) {
              actions.push({
                key: 'retry',
                label: '重试失败',
                onClick: onRetryFailed,
                color: 'var(--danger)',
              });
            }
            if (onFocusFail) {
              actions.push({ key: 'focus-fail', label: '定位失败', onClick: onFocusFail });
            }
            if (onToggleFocus) {
              actions.push({
                key: 'focus',
                label: focusMode ? '退出专注' : '专注对话',
                onClick: onToggleFocus,
                active: Boolean(focusMode),
              });
            }
            return actions.map((action, index) => {
              const isLast = index === actions.length - 1;
              return (
                <button
                  key={action.key}
                  type="button"
                  onClick={action.onClick}
                  disabled={busy}
                  style={{
                    ...(isLast ? BTN_LAST_STYLE : BTN_STYLE),
                    color: action.color ?? 'var(--fg-muted)',
                    cursor: busy ? 'not-allowed' : 'pointer',
                    opacity: busy ? 0.6 : 1,
                    ...(action.active
                      ? {
                          background: 'color-mix(in srgb, var(--accent) 10%, var(--bg-base))',
                          color: 'var(--fg-strong)',
                        }
                      : null),
                  }}
                >
                  {action.label}
                </button>
              );
            });
          })()}
        </div>
      ) : null}
    </div>
  );
}
