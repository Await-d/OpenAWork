import { type CSSProperties } from 'react';

export type ViewMode = 'single' | 'dual';
/**
 * 右侧面板的多层级展示模式。
 * - `cards`：角色窗口墙 —— 一个窗口 = 一个角色实例，按层级泳道排列（默认）
 * - `feed`：汇总流 —— 把各层级消息合并成一条时间线（兜底视图）
 *
 * 旧的 `tab` / `waterfall` / `timeline` 三视图已下线：它们都是「先拆散再打标」的
 * 合并式展示，与角色窗口墙的信息结构重复，且无人维护。
 */
export type MultiLayerViewMode = 'cards' | 'feed';

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
  color: 'var(--fg-subtle)',
  cursor: 'pointer',
  fontSize: 11,
  fontWeight: 700,
  lineHeight: 1,
  whiteSpace: 'nowrap',
};

const BTN_ACTIVE_STYLE: CSSProperties = {
  ...BTN_STYLE,
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
  { label: '卡片', mode: 'cards', title: '角色窗口墙：一个窗口一个角色，按层级泳道排列' },
  { label: '汇总流', mode: 'feed', title: '汇总流：全部层级消息合并为一条时间线' },
];

export function TeamViewModeToggle({
  viewMode,
  multiLayerMode = 'cards',
  dualDisabled = false,
  onViewModeChange,
  onMultiLayerModeChange,
}: TeamViewModeToggleProps) {
  return (
    <div style={CONTAINER_STYLE}>
      <button
        type="button"
        className={
          viewMode === 'single'
            ? 'team-v2-control team-v2-control--accent-soft'
            : 'team-v2-control team-v2-control--transparent'
        }
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
        className={
          viewMode === 'dual'
            ? 'team-v2-control team-v2-control--accent-soft'
            : 'team-v2-control team-v2-control--transparent'
        }
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
              className={
                multiLayerMode === option.mode
                  ? 'team-v2-control team-v2-control--accent-soft'
                  : 'team-v2-control team-v2-control--transparent'
              }
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
