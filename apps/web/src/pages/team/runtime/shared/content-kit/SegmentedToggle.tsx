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
 *     options={[{ value: 'usage', label: '用量 & 费用', icon: '🔋' }, …]}
 *   />
 *
 * 设计：外层一个轻量"轨道"容器（圆角 + 弱描边 + base 软底），内部选项为
 * 圆角胶囊；选中项填 accent 软底 + 强前景。与 TeamTabBar 的子 tab 同族。
 */

import type { CSSProperties, ReactNode } from 'react';
import { CK_BORDER_SUBTLE } from './content-kit-tokens.js';

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
  border: `1px solid ${CK_BORDER_SUBTLE}`,
  background: 'color-mix(in srgb, var(--bg-base) 60%, transparent)',
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
  const pad = size === 'sm' ? '3px 10px' : '5px 14px';
  const fontSize = size === 'sm' ? 11 : 12;
  return (
    <div role="tablist" aria-label={ariaLabel} style={{ ...TRACK_STYLE, ...style }}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            title={opt.title}
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
