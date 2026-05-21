import { useEffect, useRef } from 'react';

interface PinInputProps {
  value: string;
  onChange: (next: string) => void;
  /** 输够 length 位后触发；UnlockOverlay 用它做"输满即提交"，设置页可不传。 */
  onComplete?: (value: string) => void;
  /** 格子数量（同时也是 PIN 最大长度）。统一 6。 */
  length?: number;
  /** 自动聚焦——仅给表单中"第一个"PinInput 传 true，避免多个同时抢焦点。 */
  autoFocus?: boolean;
  disabled?: boolean;
  error?: boolean;
  /** 需为可访问性提供描述。 */
  ariaLabel: string;
}

/**
 * 统一的 PIN 输入控件：N 个等宽方块 + 隐藏 input 接收键盘，
 * 锁屏（UnlockOverlay）与设置页（DesktopTabContent）共用同一视觉语言。
 *
 * 仅接收 0-9，限制最大长度为 `length`，自动剔除非数字字符与多余位数。
 */
export function PinInput({
  value,
  onChange,
  onComplete,
  length = 6,
  autoFocus,
  disabled,
  error,
  ariaLabel,
}: PinInputProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (autoFocus) {
      inputRef.current?.focus();
    }
  }, [autoFocus]);

  const handleChange = (raw: string) => {
    const digits = raw.replace(/[^0-9]/g, '').slice(0, length);
    onChange(digits);
    if (digits.length >= length) {
      onComplete?.(digits);
    }
  };

  /** Enter 键：只要已输入 ≥ 1 位就允许提交——兼容短于 length 的旧 PIN。 */
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && value.length > 0) {
      e.preventDefault();
      onComplete?.(value);
    }
  };

  return (
    <div
      onClick={() => inputRef.current?.focus()}
      style={{
        display: 'inline-flex',
        gap: 8,
        position: 'relative',
        cursor: disabled ? 'not-allowed' : 'text',
      }}
    >
      {Array.from({ length }, (_, i) => {
        const filled = i < value.length;
        const active = i === value.length;
        return (
          <div
            key={i}
            aria-hidden
            style={{
              width: 44,
              height: 56,
              borderRadius: 12,
              border: `2px solid ${
                error
                  ? 'color-mix(in srgb, var(--danger) 60%, transparent)'
                  : active
                    ? 'var(--accent)'
                    : filled
                      ? 'var(--accent)'
                      : 'var(--border-default)'
              }`,
              background: filled
                ? 'color-mix(in srgb, var(--accent) 12%, var(--bg-overlay)'
                : 'var(--bg-overlay)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 22,
              fontWeight: 700,
              color: 'var(--fg-strong)',
              fontVariantNumeric: 'tabular-nums',
              transition: 'all 120ms ease',
              opacity: disabled ? 0.5 : 1,
            }}
          >
            {filled ? '●' : ''}
          </div>
        );
      })}
      <input
        ref={inputRef}
        type="password"
        inputMode="numeric"
        autoComplete="one-time-code"
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        maxLength={length}
        // 视觉上隐藏，但保留可聚焦/可粘贴；不能用 display:none，否则浏览器拒绝键盘事件。
        style={{
          position: 'absolute',
          opacity: 0,
          pointerEvents: 'none',
          width: 1,
          height: 1,
          left: 0,
          top: 0,
        }}
      />
    </div>
  );
}
