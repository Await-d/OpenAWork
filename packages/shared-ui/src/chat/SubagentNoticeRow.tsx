import { useState } from 'react';
import type { CSSProperties } from 'react';
import type { SubagentNotice, SubagentNoticeState } from '@openAwork/shared';
import { color, font, motion, radius, spacing } from '../tokens.js';

interface StatePresentation {
  glyph: string;
  label: string;
  accent: string;
}

/**
 * 状态呈现。语义色映射与上游一致（`tui/src/routes/session/index.tsx`）：
 * 失败 → error/danger、取消 → warning、完成 → info。
 */
const STATE_PRESENTATION: Record<SubagentNoticeState, StatePresentation> = {
  done: { glyph: '↳', label: '已完成', accent: color.aux },
  failed: { glyph: '!', label: '已失败', accent: color.danger },
  cancelled: { glyph: '!', label: '已取消', accent: color.warning },
};

export interface SubagentNoticeRowProps {
  notice: SubagentNotice;
  /** 与相邻通知合组时收紧上间距。 */
  grouped?: boolean;
  /** 传入且通知带子会话 id 时，整行可点击/可聚焦跳转。 */
  onOpenChild?: (childSessionId: string) => void;
}

/**
 * 子代理完成通知的单行呈现。
 *
 * 对齐上游 notice 契约：13px 紧凑单行、按状态着色、`description` 追加在 ` · ` 之后、
 * 有子会话 id 时可点击跳转。整行可交互时使用原生 `button`，因此 Enter / Space
 * 激活、`role`/`tabIndex` 与 focus 语义都由浏览器保证。
 */
export function SubagentNoticeRow({
  notice,
  grouped = false,
  onOpenChild,
}: SubagentNoticeRowProps) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);

  const presentation = STATE_PRESENTATION[notice.state];
  const childSessionId = notice.childSessionId;
  const interactive = Boolean(childSessionId && onOpenChild);
  // 可交互时 hover 提到常规文字色（对齐上游 hover → text.base）。
  const headingColor = interactive && hovered ? color.fgDefault : presentation.accent;
  const labelColor = interactive && hovered ? color.fgMuted : presentation.accent;

  const style: CSSProperties = {
    appearance: 'none',
    display: 'block',
    width: '100%',
    maxWidth: '100%',
    margin: 0,
    // 上下留白必须对称：通知行落在两条消息之间，`12px 0 4px` 会让文字偏向下一条
    // 消息（实测上 28px / 下 21px）。两侧同取 `spacing[2]` 后视觉居中。
    padding: grouped ? `${spacing[1]}px 0` : `${spacing[2]}px 0`,
    background: 'transparent',
    border: 'none',
    textAlign: 'left',
    fontFamily: font.sans,
    fontSize: 13,
    lineHeight: '16px',
    color: color.fgMuted,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    transition: `color ${motion.micro.duration} ${motion.micro.easing}`,
    ...(interactive ? { cursor: 'pointer', borderRadius: radius.xs } : {}),
    ...(focused
      ? {
          outline: `2px solid ${color.accent}`,
          outlineOffset: 2,
          boxShadow: `0 0 0 4px ${color.accentSubtle}`,
        }
      : {}),
  };

  const body = (
    <>
      <span aria-hidden="true" style={{ color: headingColor, marginRight: spacing[2] }}>
        {presentation.glyph}
      </span>
      <span style={{ fontWeight: 530, color: headingColor }}>{notice.agent}</span>{' '}
      <span style={{ color: labelColor }}>{presentation.label}</span>
      {notice.description.length > 0 ? (
        <span style={{ color: color.fgSubtle }}> · {notice.description}</span>
      ) : null}
    </>
  );

  if (!interactive) {
    return (
      <div data-component="subagent-notice" data-state={notice.state} style={style}>
        {body}
      </div>
    );
  }

  return (
    <button
      type="button"
      data-component="subagent-notice"
      data-state={notice.state}
      title={notice.description.length > 0 ? notice.description : notice.text}
      onClick={() => {
        if (childSessionId) {
          onOpenChild?.(childSessionId);
        }
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={style}
    >
      {body}
    </button>
  );
}
