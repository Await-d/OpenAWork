import { type CSSProperties } from 'react';

export type ViewMode = 'single' | 'dual';
export type MultiLayerViewMode = 'tab' | 'waterfall' | 'timeline';

export interface TeamViewModeToggleProps {
  viewMode: ViewMode;
  /** @deprecated 已移除多层级视图切换，此 prop 保留仅用于接口兼容。 */
  multiLayerMode?: MultiLayerViewMode;
  dualDisabled?: boolean;
  onViewModeChange: (mode: ViewMode) => void;
  /** @deprecated 已移除多层级视图切换，此 prop 保留仅用于接口兼容。 */
  onMultiLayerModeChange?: (mode: MultiLayerViewMode) => void;
}

const CONTAINER_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 'var(--spacing-1, 4px)',
  padding: 'var(--spacing-1, 4px)',
  borderRadius: 'var(--radius-sm, 6px)',
  background: 'color-mix(in srgb, var(--bg-surface) 80%, transparent)',
  border: '1px solid color-mix(in srgb, var(--border-default) 40%, transparent)',
};

const BTN_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 'var(--spacing-1, 4px)',
  minHeight: 24,
  padding: '3px 8px',
  borderRadius: 'var(--radius-sm, 6px)',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'transparent',
  background: 'transparent',
  color: 'var(--fg-subtle)',
  cursor: 'pointer',
  transition: 'all 100ms ease',
  fontSize: 11,
  fontWeight: 700,
  lineHeight: 1,
  whiteSpace: 'nowrap',
};

const BTN_ACTIVE_STYLE: CSSProperties = {
  ...BTN_STYLE,
  borderColor: 'color-mix(in srgb, var(--accent) 36%, transparent)',
  background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
  color: 'var(--fg-strong)',
};

const BTN_ICON_STYLE: CSSProperties = {
  fontSize: 12,
  lineHeight: 1,
};

export function TeamViewModeToggle({
  viewMode,
  dualDisabled = false,
  onViewModeChange,
}: TeamViewModeToggleProps) {
  return (
    <div style={CONTAINER_STYLE}>
      <button
        type="button"
        className="team-v2-control"
        style={viewMode === 'single' ? BTN_ACTIVE_STYLE : BTN_STYLE}
        onClick={() => onViewModeChange('single')}
        aria-label="单栏视图"
        title="只看主对话"
      >
        <span style={BTN_ICON_STYLE} aria-hidden>
          ▣
        </span>
        <span>仅对话</span>
      </button>
      <button
        type="button"
        className="team-v2-control"
        disabled={dualDisabled}
        style={{
          ...(viewMode === 'dual' ? BTN_ACTIVE_STYLE : BTN_STYLE),
          cursor: dualDisabled ? 'not-allowed' : 'pointer',
          opacity: dualDisabled ? 0.45 : 1,
        }}
        onClick={() => onViewModeChange('dual')}
        aria-label="群聊汇总视图"
        title={dualDisabled ? '窄屏下使用单栏视图' : '左侧查看团队各层级消息汇总，右侧查看主对话'}
      >
        <span style={BTN_ICON_STYLE} aria-hidden>
          ⊞
        </span>
        <span>汇总+对话</span>
      </button>
    </div>
  );
}
