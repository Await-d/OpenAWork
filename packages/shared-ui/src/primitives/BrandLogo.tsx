import { useId } from 'react';

export interface BrandLogoProps {
  /** Logo 尺寸（正方形宽高） */
  size?: number;
  /**
   * - `'filled'`（默认）：带圆角矩形渐变背景 + 白色三瓣图案，适用于导航栏、侧边栏、关于页等。
   * - `'plain'`：无背景，三瓣图案使用 `currentColor`，适用于需要继承文字色的场景（如登录页）。
   */
  variant?: 'filled' | 'plain';
  /** 自定义 className */
  className?: string;
}

/**
 * OpenAWork 品牌统一 Logo 组件。
 *
 * 三瓣旋转花瓣 + 中心圆点，所有页面/组件应统一使用此组件，禁止内联重复 SVG。
 */
export function BrandLogo({ size = 22, variant = 'filled', className }: BrandLogoProps) {
  const uid = useId();
  const bgId = `brandLogoBg-${uid}`;
  const strokeId = `brandLogoStroke-${uid}`;

  if (variant === 'plain') {
    return (
      <svg
        aria-hidden="true"
        width={size}
        height={size}
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={className}
      >
        <path
          d="M 16,3 C 26,3 29,12 16,16"
          stroke="currentColor"
          strokeWidth="2.6"
          strokeLinecap="round"
          fill="none"
          opacity="0.92"
          transform="rotate(0, 16, 16)"
        />
        <path
          d="M 16,3 C 26,3 29,12 16,16"
          stroke="currentColor"
          strokeWidth="2.6"
          strokeLinecap="round"
          fill="none"
          opacity="0.92"
          transform="rotate(120, 16, 16)"
        />
        <path
          d="M 16,3 C 26,3 29,12 16,16"
          stroke="currentColor"
          strokeWidth="2.6"
          strokeLinecap="round"
          fill="none"
          opacity="0.92"
          transform="rotate(240, 16, 16)"
        />
        <circle cx="16" cy="16" r="2.8" fill="currentColor" />
      </svg>
    );
  }

  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <defs>
        <linearGradient id={bgId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop
            offset="0%"
            style={{
              stopColor: 'color-mix(in oklch, var(--accent) 100%, white 14%)',
            }}
          />
          <stop offset="100%" style={{ stopColor: 'var(--accent)' }} />
        </linearGradient>
        <linearGradient id={strokeId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style={{ stopColor: 'var(--fg-on-accent)' }} stopOpacity="1" />
          <stop offset="100%" style={{ stopColor: 'var(--fg-on-accent)' }} stopOpacity="0.85" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill={`url(#${bgId})`} />
      <path
        d="M 16,3 C 26,3 29,12 16,16"
        stroke={`url(#${strokeId})`}
        strokeWidth="2.6"
        strokeLinecap="round"
        fill="none"
        transform="rotate(0, 16, 16)"
      />
      <path
        d="M 16,3 C 26,3 29,12 16,16"
        stroke={`url(#${strokeId})`}
        strokeWidth="2.6"
        strokeLinecap="round"
        fill="none"
        transform="rotate(120, 16, 16)"
      />
      <path
        d="M 16,3 C 26,3 29,12 16,16"
        stroke={`url(#${strokeId})`}
        strokeWidth="2.6"
        strokeLinecap="round"
        fill="none"
        transform="rotate(240, 16, 16)"
      />
      <circle cx="16" cy="16" r="2.8" fill="var(--fg-on-accent)" />
    </svg>
  );
}
