import { type CSSProperties } from 'react';

export type ViewMode = 'single' | 'dual';
export type MultiLayerViewMode = 'feed' | 'tab' | 'waterfall' | 'timeline';

export interface TeamViewModeToggleProps {
  viewMode: ViewMode;
  multiLayerMode?: MultiLayerViewMode;
  dualDisabled?: boolean;
  onViewModeChange: (mode: ViewMode) => void;
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

const MODE_DIVIDER_STYLE: CSSProperties = {
  width: 1,
  alignSelf: 'stretch',
  background: 'color-mix(in srgb, var(--border-default) 54%, transparent)',
};

const MODE_OPTIONS: Array<{ label: string; mode: MultiLayerViewMode; title: string }> = [
  { label: '新版', mode: 'feed', title: '新版群聊汇总流' },
  { label: '旧分层', mode: 'tab', title: '旧版分层标签视图' },
  { label: '瀑布', mode: 'waterfall', title: '旧版瀑布视图' },
  { label: '时间线', mode: 'timeline', title: '旧版时间线视图' },
];

export function TeamViewModeToggle({
  viewMode,
  multiLayerMode = 'feed',
  dualDisabled = false,
  onViewModeChange,
  onMultiLayerModeChange,
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
        <span>主对话</span>
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
        aria-label="分层并排视图"
        title={dualDisabled ? '窄屏下使用单栏视图' : '左侧查看团队各层级消息汇总，右侧查看主对话'}
      >
        <span style={BTN_ICON_STYLE} aria-hidden>
          ⊞
        </span>
        <span>分层并排</span>
      </button>
      {viewMode === 'dual' && onMultiLayerModeChange ? (
        <>
          <span style={MODE_DIVIDER_STYLE} aria-hidden />
          {MODE_OPTIONS.map((option) => (
            <button
              key={option.mode}
              type="button"
              className="team-v2-control"
              style={multiLayerMode === option.mode ? BTN_ACTIVE_STYLE : BTN_STYLE}
              onClick={() => onMultiLayerModeChange(option.mode)}
              aria-label={`切换到${option.title}`}
              title={option.title}
            >
              <span>{option.label}</span>
            </button>
          ))}
        </>
      ) : null}
    </div>
  );
}
