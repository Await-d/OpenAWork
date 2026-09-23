/**
 * 思考折叠窗口的共享参数。
 *
 * 两个渲染入口必须用同一组窗口参数，避免同一个产品里出现两套"思考折叠"：
 * - 主思考块：`assistant-reasoning-block.tsx`（Thinking: 块）
 * - 正文里的 ```thinking 围栏块：`markdown-message-content.tsx` 的 ThinkingCodeBlock
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
