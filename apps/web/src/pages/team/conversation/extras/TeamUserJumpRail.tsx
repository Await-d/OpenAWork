/**
 * TeamUserJumpRail · 右侧「用户输入快捷跳转」悬浮控件
 *
 * team 对话流复用 chat 渲染，chat 只有键盘快捷键能在「上一条/下一条用户输入」之间
 * 跳转，没有可视入口。本控件把这个能力做成右侧一个紧凑的悬浮条：
 *   - ▲ 跳到上一条用户输入、▼ 跳到下一条用户输入
 *   - 中间显示「当前 / 总数」，让用户知道自己发过几条、现在大概在第几条附近
 *
 * 不自己实现滚动逻辑——直接调用上层传入的 onPrev/onNext（它们查询
 * scrollRegion 里的 [data-role="user"] 并 scrollIntoView，与键盘快捷键同一实现）。
 * userCount<=1 时不渲染（没有可跳转的多条输入）。
 */

import { useEffect, useState, type CSSProperties, type RefObject } from 'react';

export interface TeamUserJumpRailProps {
  /** 滚动区域 ref，用于统计用户消息数与当前可见位置。 */
  scrollRegionRef: RefObject<HTMLDivElement | null>;
  /** 用户消息总数（来自 messages.filter(role==='user')）。 */
  userCount: number;
  onPrev: () => void;
  onNext: () => void;
}

const RAIL_STYLE: CSSProperties = {
  position: 'absolute',
  right: 14,
  top: '50%',
  transform: 'translateY(-50%)',
  zIndex: 16,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 4,
  padding: 5,
  borderRadius: 999,
  border: '1px solid color-mix(in srgb, var(--border-default) 60%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 85%, var(--bg-base))',
  boxShadow: 'var(--shadow-md)',
  backdropFilter: 'blur(8px)',
};

const BTN_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 26,
  height: 26,
  borderRadius: '50%',
  border: 'none',
  background: 'transparent',
  color: 'var(--fg-default)',
  cursor: 'pointer',
  transition: 'background 120ms ease, color 120ms ease',
};

const COUNT_STYLE: CSSProperties = {
  fontSize: 9.5,
  fontWeight: 700,
  color: 'var(--fg-muted)',
  fontVariantNumeric: 'tabular-nums',
  lineHeight: 1.1,
  textAlign: 'center',
  userSelect: 'none',
};

export function TeamUserJumpRail({
  scrollRegionRef,
  userCount,
  onPrev,
  onNext,
}: TeamUserJumpRailProps) {
  // 当前大致定位：滚动区里第一个进入视口的用户消息序号（1-based），用于「N / 总数」。
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    const region = scrollRegionRef.current;
    if (!region) return undefined;
    const recompute = () => {
      const userEls = Array.from(region.querySelectorAll<HTMLElement>('[data-role="user"]'));
      if (userEls.length === 0) {
        setCurrentIndex(0);
        return;
      }
      const top = region.getBoundingClientRect().top;
      // 取最靠近视口顶部、但仍在其下方一点的那条作为「当前」。
      let idx = 0;
      for (let i = 0; i < userEls.length; i++) {
        const rect = userEls[i]!.getBoundingClientRect();
        if (rect.top <= top + 80) idx = i;
        else break;
      }
      setCurrentIndex(idx + 1);
    };
    recompute();
    region.addEventListener('scroll', recompute, { passive: true });
    return () => region.removeEventListener('scroll', recompute);
  }, [scrollRegionRef, userCount]);

  if (userCount <= 1) return null;

  return (
    <div style={RAIL_STYLE} role="group" aria-label="用户输入快捷跳转">
      <button
        type="button"
        className="team-icon-ghost"
        style={BTN_STYLE}
        onClick={onPrev}
        aria-label="跳到上一条我的输入"
        title="上一条我的输入"
      >
        <svg
          aria-hidden
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m18 15-6-6-6 6" />
        </svg>
      </button>
      <span style={COUNT_STYLE} aria-live="polite">
        {currentIndex > 0 ? currentIndex : '–'}
        <br />
        <span style={{ opacity: 0.55 }}>/{userCount}</span>
      </span>
      <button
        type="button"
        className="team-icon-ghost"
        style={BTN_STYLE}
        onClick={onNext}
        aria-label="跳到下一条我的输入"
        title="下一条我的输入"
      >
        <svg
          aria-hidden
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
    </div>
  );
}
