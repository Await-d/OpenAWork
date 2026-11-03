import type { CSSProperties } from 'react';

/**
 * 思考折叠窗口的共享参数。
 *
 * 三个渲染入口必须用同一组窗口参数，避免同一个产品里出现三套"思考折叠"：
 * - 主思考块：`assistant-reasoning-block.tsx`（Thinking: 块）
 * - 正文里的 ```thinking 围栏块：`markdown-message-content.tsx` 的 ThinkingCodeBlock
 * - 关闭「显示推理过程」后的「思考过程」占位展开：`ChatPageSections.tsx` 的 HiddenReasoningNotice
 */

/** 折叠态窗口行数：流式与静态共用，保证 finalize 前后高度一致、不跳动。 */
export const REASONING_COLLAPSED_MAX_LINES = 5;

/**
 * 展开态窗口高度上限：到达后在思考块内部滚动，不再无限撑高消息区。
 * 60vh 沿用消息级折叠 / 长代码块的既有约定；480px 上限保证大屏上答案正文仍在屏内。
 */
export const REASONING_EXPANDED_MAX_HEIGHT = 'min(60vh, 480px)';

/**
 * 按行数换算思考正文限高。
 * 1.6 × 13px 对应 `.assistant-reasoning-body` 的行高 / 字号，末行再留 4px 余量。
 */
export function computeReasoningBodyMaxHeight(lines: number): string {
  return `${lines * 1.6 * 13 + 4}px`;
}

/**
 * 折叠态正文容器样式：`column-reverse` 的「贴底窗口」——内容钉在容器底部，超出部分从
 * **顶部**裁掉，可见区始终落在最新的若干行上（`overflow: clip`，不给滚动条）。
 */
export function createReasoningCollapsedBodyStyle(): CSSProperties {
  return {
    maxHeight: computeReasoningBodyMaxHeight(REASONING_COLLAPSED_MAX_LINES),
    overflow: 'clip',
    display: 'flex',
    flexDirection: 'column-reverse',
    position: 'relative',
  };
}

/**
 * 展开态正文容器样式：与折叠态同向的「贴底窗口」，只是把窗口放宽到
 * `REASONING_EXPANDED_MAX_HEIGHT` 并改为**块内滚动**（向上滚即可回看更早的思考）。
 *
 * 三处「展开思考」都必须走这一份样式：任何一处漏掉高度上限，都会让那一次展开
 * 变得"名不副实"（点开就把整条消息撑成好几屏，且没有块内滚动可回看）。
 */
export function createReasoningExpandedBodyStyle(): CSSProperties {
  return {
    maxHeight: REASONING_EXPANDED_MAX_HEIGHT,
    overflow: 'auto',
    display: 'flex',
    flexDirection: 'column-reverse',
    position: 'relative',
  };
}
