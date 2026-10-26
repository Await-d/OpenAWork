import React, { type CSSProperties } from 'react';

import type { ReasoningEffort } from '../../conversation-runtime/messages/support.js';

/** 思考强度权重:滑块填充、辉光与卡片流光都按它从「淡」到「浓」分级呈现。 */
export const THINKING_INTENSITY: Record<ReasoningEffort, number> = {
  none: 0,
  minimal: 0.25,
  low: 0.45,
  medium: 0.65,
  high: 0.8,
  xhigh: 0.92,
  max: 1,
};

export function formatContextWindow(value: number | undefined): string | null {
  if (!value || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
  return String(value);
}

export const CONTEXT_WINDOW_PRESETS = [
  { value: undefined, label: '自动', detail: '使用模型预设' },
  { value: 272_000, label: '272K', detail: '适合常规长上下文' },
  { value: 400_000, label: '400K', detail: '适合中大型上下文' },
  { value: 1_000_000, label: '1M', detail: '适合超长上下文' },
] as const;

export function sameContextWindow(left: number | undefined, right: number | undefined): boolean {
  return left === right || (left === undefined && right === undefined);
}

export function CapabilityTag({
  label,
  tone = 'default',
}: {
  label: string;
  tone?: 'default' | 'accent' | 'emerald' | 'violet';
}) {
  const colorMap: Record<
    'default' | 'accent' | 'emerald' | 'violet',
    { bg: string; color: string }
  > = {
    default: { bg: 'var(--bg-overlay)', color: 'var(--fg-muted)' },
    accent: { bg: 'var(--accent-muted)', color: 'var(--accent)' },
    emerald: {
      bg: 'color-mix(in oklch, var(--success) 14%, transparent)',
      color: 'color-mix(in oklch, var(--success) 82%, var(--fg-on-accent) 18%)',
    },
    violet: {
      bg: 'color-mix(in oklch, var(--accent) 14%, transparent)',
      color: 'color-mix(in oklch, var(--accent) 78%, white 22%)',
    },
  };
  const style = colorMap[tone];

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        height: 18,
        padding: '0 7px',
        borderRadius: 999,
        background: style.bg,
        color: style.color,
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
      }}
    >
      {label}
    </span>
  );
}

export function resolveFloatingPanelPosition(
  anchorRect: { left: number; right: number; top: number; bottom: number },
  width: number,
  maxDesiredHeight: number,
  align: 'start' | 'end' | 'center',
  preferAbove = false,
) {
  const margin = 12;
  const gap = 6;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  // Horizontal: clamp panel within viewport
  const leftCandidate =
    align === 'start'
      ? anchorRect.left
      : align === 'center'
        ? (anchorRect.left + anchorRect.right) / 2 - width / 2
        : Math.max(margin, anchorRect.right - width);
  const left = Math.min(
    Math.max(margin, leftCandidate),
    Math.max(margin, viewportWidth - width - margin),
  );

  const spaceBelow = viewportHeight - anchorRect.bottom - margin;
  const spaceAbove = anchorRect.top - margin;

  // Decide direction: prefer above when requested (composer is at bottom),
  // otherwise follow original space-based heuristic.
  const openAbove = preferAbove
    ? spaceAbove >= 160 || spaceAbove >= spaceBelow
    : spaceBelow >= Math.min(180, maxDesiredHeight) || spaceBelow >= spaceAbove;

  if (!openAbove) {
    // Open below
    const effectiveHeight = Math.max(160, Math.min(maxDesiredHeight, spaceBelow));
    return {
      left,
      top: Math.min(anchorRect.bottom + gap, viewportHeight - margin - effectiveHeight),
      maxHeight: effectiveHeight,
      transformOrigin:
        align === 'start'
          ? ('top left' as const)
          : align === 'center'
            ? ('top center' as const)
            : ('top right' as const),
    };
  }

  // Open above
  const effectiveHeight = Math.max(160, Math.min(maxDesiredHeight, spaceAbove));
  return {
    left,
    top: Math.max(margin, anchorRect.top - effectiveHeight - gap),
    maxHeight: effectiveHeight,
    transformOrigin:
      align === 'start'
        ? ('bottom left' as const)
        : align === 'center'
          ? ('bottom center' as const)
          : ('bottom right' as const),
  };
}

/** 刷新图标：`data-refreshing` 为真时由外层 CSS 驱动旋转。 */
export function RefreshIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <polyline points="21 3 21 9 15 9" />
    </svg>
  );
}
