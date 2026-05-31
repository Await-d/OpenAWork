/**
 * 260531-team-page · RunningHandoffCancelList
 *
 * 运行中 / 待领取 / 已认领 的 handoff 取消列表。原先内嵌在 MiddleTabRouter 的
 * 「任务流」tab 里（HandoffCancelInline）；tab 整理后「任务流」并入「任务与产物」
 * （TeamArtifactSection），此列表抽成独立组件供其复用。
 */

import { useMemo } from 'react';
import type { HandoffEntry } from '../../../../../stores/team/team-events.js';

export interface RunningHandoffCancelListProps {
  focusHandoffId?: string | null;
  handoffs: Map<string, HandoffEntry>;
  onCancel: (handoffId: string) => void;
  onClearFocus?: () => void;
}

export function RunningHandoffCancelList({
  focusHandoffId,
  handoffs,
  onCancel,
  onClearFocus,
}: RunningHandoffCancelListProps) {
  const cancellable = useMemo(() => {
    const result: HandoffEntry[] = [];
    for (const entry of handoffs.values()) {
      if (entry.state === 'running' || entry.state === 'pending' || entry.state === 'claimed') {
        result.push(entry);
      }
    }
    result.sort((left, right) => {
      if (left.id === focusHandoffId) return -1;
      if (right.id === focusHandoffId) return 1;
      return right.updatedAt - left.updatedAt;
    });
    return result;
  }, [focusHandoffId, handoffs]);

  if (cancellable.length === 0) return null;

  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <span
        style={{
          fontSize: 12,
          fontWeight: 700,
          color: 'var(--fg-strong)',
        }}
      >
        运行中任务
      </span>
      {focusHandoffId ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            padding: '6px 10px',
            borderRadius: 8,
            border: '1px dashed color-mix(in srgb, var(--accent) 40%, transparent)',
            background: 'color-mix(in srgb, var(--accent) 5%, var(--bg-overlay))',
            fontSize: 11,
            color: 'var(--fg-muted)',
          }}
        >
          <span>当前聚焦 Handoff #{focusHandoffId.slice(0, 8)}</span>
          {onClearFocus ? (
            <button
              type="button"
              onClick={onClearFocus}
              style={{
                padding: '2px 8px',
                borderRadius: 6,
                border: '1px solid color-mix(in srgb, var(--border-default) 50%, transparent)',
                background: 'transparent',
                color: 'var(--fg-default)',
                fontSize: 10,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              清除定位
            </button>
          ) : null}
        </div>
      ) : null}
      {cancellable.map((entry) => (
        <div
          key={entry.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 10px',
            borderRadius: 8,
            border:
              entry.id === focusHandoffId
                ? '1px solid color-mix(in srgb, var(--accent) 55%, transparent)'
                : '1px solid color-mix(in srgb, var(--border-default) 50%, transparent)',
            background:
              entry.id === focusHandoffId
                ? 'color-mix(in srgb, var(--accent) 8%, var(--bg-overlay))'
                : 'color-mix(in srgb, var(--bg-overlay) 80%, var(--bg-base))',
            fontSize: 12,
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: 999,
              background: entry.state === 'running' ? 'var(--success)' : 'var(--warning)',
              flexShrink: 0,
            }}
          />
          {entry.id === focusHandoffId ? (
            <span
              style={{
                padding: '1px 8px',
                borderRadius: 999,
                background: 'color-mix(in srgb, var(--accent) 16%, transparent)',
                color: 'var(--accent)',
                fontSize: 10,
                fontWeight: 800,
                flexShrink: 0,
              }}
            >
              当前定位
            </span>
          ) : null}
          <span
            style={{
              flex: 1,
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              color: 'var(--fg-default)',
            }}
          >
            {entry.fromRoleLayer} → {entry.toRoleLayer}
          </span>
          <button
            type="button"
            onClick={() => onCancel(entry.id)}
            style={{
              padding: '2px 8px',
              borderRadius: 6,
              border: '1px solid color-mix(in srgb, var(--danger) 40%, transparent)',
              background: 'color-mix(in srgb, var(--danger) 8%, transparent)',
              color: 'var(--danger)',
              fontSize: 10,
              fontWeight: 700,
              cursor: 'pointer',
              flexShrink: 0,
            }}
            aria-label={`取消任务 ${entry.id}`}
          >
            取消
          </button>
        </div>
      ))}
    </div>
  );
}
