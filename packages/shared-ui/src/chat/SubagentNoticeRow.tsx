import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import type { SubagentNotice, SubagentNoticeState } from '@openAwork/shared';
import { parseSubagentResultBlocks, summarizeSubagentResult } from '@openAwork/shared';
import { SubagentResultCard } from './SubagentResultCard.js';
import type { SubagentResultBodyRenderer } from './SubagentResultCard.js';
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
  /** 传入且通知带子会话 id 时，标题行可点击/可聚焦跳转。 */
  onOpenChild?: (childSessionId: string) => void;
  /** 结果卡片正文渲染器注入点（如 Markdown）；未注入时正文按纯文本渲染。 */
  renderBody?: SubagentResultBodyRenderer;
}

/**
 * 子代理完成通知的呈现：紧凑标题行 + 全展开的结构化结果卡片。
 *
 * 标题行对齐上游 notice 契约：13px 紧凑单行、按状态着色、`description` 追加在
 * ` · ` 之后、有子会话 id 时可点击跳转（原生 `button`，Enter / Space 激活、
 * `role`/`tabIndex` 与 focus 语义由浏览器保证）。
 *
 * 标题行下方通过 `SubagentResultCard` 全展开渲染 `notice.text` 中的
 * `<results>` 结构化块（files / findings / answer / next_steps / uncertainties）；
 * 无结构化块时退化为纯正文段。原始 XML 标签不再直接暴露给用户。
 * 传入 `renderBody` 时正文交由注入渲染器（如 web 端的 Markdown）输出。
 */
export function SubagentNoticeRow({
  notice,
  grouped = false,
  onOpenChild,
  renderBody,
}: SubagentNoticeRowProps) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);

  const presentation = STATE_PRESENTATION[notice.state];
  const childSessionId = notice.childSessionId;
  const interactive = Boolean(childSessionId && onOpenChild);
  // 可交互时 hover 提到常规文字色（对齐上游 hover → text.base）。
  const headingColor = interactive && hovered ? color.fgDefault : presentation.accent;
  const labelColor = interactive && hovered ? color.fgMuted : presentation.accent;

  const resultSections = useMemo(() => parseSubagentResultBlocks(notice.text), [notice.text]);
  // 正文非空才渲染结果区（`SubagentResultCard` 对无结构化块的情况自动退化为纯正文）。
  const hasResults = notice.text.trim().length > 0;
  const hoverSummary = useMemo(
    () => summarizeSubagentResult(resultSections) || notice.text,
    [resultSections, notice.text],
  );

  const headingStyle: CSSProperties = {
    appearance: 'none',
    display: 'block',
    width: '100%',
    maxWidth: '100%',
    margin: 0,
    // 上下留白必须对称：通知行落在两条消息之间，`12px 0 4px` 会让文字偏向下一条
    // 消息（实测上 28px / 下 21px）。两侧同取 `spacing[2]` 后视觉居中；
    // 结果卡片全展开时下方交给卡片自身留白，这里只保留上间距。
    padding: grouped
      ? `${spacing[1]}px 0 0`
      : hasResults
        ? `${spacing[2]}px 0 0`
        : `${spacing[2]}px 0`,
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

  const card = hasResults ? (
    <SubagentResultCard sections={resultSections} {...(renderBody ? { renderBody } : {})} />
  ) : null;

  if (!interactive) {
    return (
      <div data-component="subagent-notice" data-state={notice.state}>
        <div style={headingStyle}>{body}</div>
        {card}
      </div>
    );
  }

  return (
    <div data-component="subagent-notice" data-state={notice.state}>
      <button
        type="button"
        data-subagent-notice-heading="true"
        title={hoverSummary}
        onClick={() => {
          if (childSessionId) {
            onOpenChild?.(childSessionId);
          }
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={headingStyle}
      >
        {body}
      </button>
      {card}
    </div>
  );
}
