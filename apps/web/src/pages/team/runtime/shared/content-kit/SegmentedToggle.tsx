/**
 * 260531-team-page · content-kit · SegmentedToggle
 *
 * 视图内「模式切换」的统一 segmented 控件。tab 整理后多处出现"同一视图内
 * 在两三个子模式间切换"的需求（度量·用量/工具调用、层级对话·双栏/线程），
 * 此前各自手搓胶囊样式，视觉不一致。这里收敛成一个受控原子：
 *
 *   <SegmentedToggle
 *     value={mode}
 *     onChange={setMode}
 *     options={[{ value: 'usage', label: '用量 & 费用', icon: <UsageIcon /> }, …]}
 *   />
 *
 * 设计：外层一个轻量"轨道"容器（圆角 + 弱描边 + base 软底），内部选项为
 * 圆角胶囊；选中项填 accent 软底 + 强前景。与 TeamTabBar 的子 tab 同族。
 */

import {
  useRef,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';

export interface SegmentedToggleOption<V extends string> {
  value: V;
  label: ReactNode;
  /** 可选 emoji / 图标前缀。 */
  icon?: ReactNode;
  /** 可选标题（hover 提示）。 */
  title?: string;
}

export interface SegmentedToggleProps<V extends string> {
  value: V;
  onChange: (value: V) => void;
  options: ReadonlyArray<SegmentedToggleOption<V>>;
  /** 可访问性标签（role="tablist" 的 aria-label）。 */
  ariaLabel?: string;
  /** 尺寸：sm 用于密集头部，md 用于视图主切换。默认 md。 */
  size?: 'sm' | 'md';
  style?: CSSProperties;
}

const TRACK_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 2,
  padding: 2,
  borderRadius: 999,
  // 无描边：以淡底承载轨道（与页面整体去描边风格一致）。
  background: 'color-mix(in srgb, var(--bg-surface) 78%, transparent)',
  flexWrap: 'wrap',
  minWidth: 0,
  maxWidth: '100%',
};

export function SegmentedToggle<V extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  size = 'md',
  style,
}: SegmentedToggleProps<V>) {
  const trackRef = useRef<HTMLDivElement>(null);
  // 点击目标：md ≥28px 高、sm ≥26px 高，保证模式切换容易命中。
  const pad = size === 'sm' ? '5px 12px' : '6px 14px';
  const fontSize = size === 'sm' ? 11 : 12;

  /** 键盘方向键在选项间切换（← → 循环，Home / End 到首尾），焦点跟随。 */
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const values = options.map((opt) => opt.value);
    if (values.length === 0) return;
    const currentIndex = values.indexOf(value);
    let nextIndex = -1;
    if (event.key === 'ArrowRight') {
      nextIndex = (Math.max(currentIndex, -1) + 1) % values.length;
    } else if (event.key === 'ArrowLeft') {
      nextIndex = (Math.max(currentIndex, 0) - 1 + values.length) % values.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = values.length - 1;
    }
    if (nextIndex < 0) return;
    event.preventDefault();
    const nextValue = values[nextIndex];
    if (nextValue === undefined) return;
    if (nextValue !== value) {
      onChange(nextValue);
    }
    requestAnimationFrame(() => {
      trackRef.current
        ?.querySelector<HTMLButtonElement>(`[data-seg-value="${nextValue}"]`)
        ?.focus();
    });
  };

  return (
    <div
      ref={trackRef}
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={handleKeyDown}
      style={{ ...TRACK_STYLE, ...style }}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            title={opt.title}
            data-seg-value={opt.value}
            onClick={() => onChange(opt.value)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              padding: pad,
              borderRadius: 999,
              border: 'none',
              background: active
                ? 'color-mix(in srgb, var(--accent) 16%, transparent)'
                : 'transparent',
              color: active ? 'var(--accent)' : 'var(--fg-muted)',
              fontSize,
              fontWeight: active ? 700 : 600,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              transition: 'background 140ms ease, color 140ms ease',
            }}
          >
            {opt.icon ? <span aria-hidden>{opt.icon}</span> : null}
            <span>{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
