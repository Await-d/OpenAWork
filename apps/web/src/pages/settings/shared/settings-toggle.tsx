import { useState } from 'react';
import type { CSSProperties } from 'react';

export interface SettingsToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  ariaLabel: string;
  disabled?: boolean;
}

const TRACK: CSSProperties = {
  position: 'relative',
  width: 42,
  height: 24,
  borderRadius: 999,
  border: 'none',
  padding: 0,
  flexShrink: 0,
  transition: 'background 180ms ease',
};

const KNOB: CSSProperties = {
  position: 'absolute',
  top: 2,
  width: 20,
  height: 20,
  borderRadius: '50%',
  background: 'var(--bg-overlay)',
  boxShadow: 'var(--shadow-sm)',
  transition: 'left 180ms ease',
};

/**
 * 设置页统一开关：42×24 轨道 + 20px 滑块，role="switch" + aria-checked。
 * 收敛原先散落在各 tab 的 Toggle / ToggleSwitch / ToggleRow 开关部分。
 */
export function SettingsToggle({
  checked,
  onChange,
  ariaLabel,
  disabled = false,
}: SettingsToggleProps) {
  const [focused, setFocused] = useState(false);

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={{
        ...TRACK,
        cursor: disabled ? 'not-allowed' : 'pointer',
        background: checked ? 'var(--accent)' : 'var(--switch-track-off)',
        opacity: disabled ? 0.5 : 1,
        outline: focused ? '2px solid var(--accent)' : 'none',
        outlineOffset: 2,
        boxShadow: focused ? '0 0 0 4px var(--accent-subtle)' : 'none',
      }}
    >
      <span style={{ ...KNOB, left: checked ? 20 : 2 }} />
    </button>
  );
}
