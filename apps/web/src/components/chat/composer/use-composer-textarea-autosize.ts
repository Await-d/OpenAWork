import { useCallback, useEffect } from 'react';
import type { RefObject } from 'react';

/** textarea 内容超过此高度后转为内部滚动，与 ChatComposer.css 的 max-height 一致。 */
export const TEXTAREA_MAX_HEIGHT_PX = 280;

/**
 * 把 textarea 高度重设为「贴合内容」。
 *
 * 必须留在模块级：`textareaRef` 是 hook 参数，在 hook 内直接写
 * `textarea.style.*` 会被 React Compiler 判为「修改 hook 参数」并放弃优化本 hook
 * （见 `utils/ref/ref-current.ts` 的说明）。行为逐字不变——同一个元素、同一时机。
 */
function applyTextareaAutosize(textarea: HTMLTextAreaElement): void {
  // 先归零再量取 scrollHeight，否则高度只增不减。
  textarea.style.height = 'auto';
  textarea.style.height = `${textarea.scrollHeight}px`;
  textarea.style.overflowY = textarea.scrollHeight > TEXTAREA_MAX_HEIGHT_PX ? 'auto' : 'hidden';
}

/**
 * 让 textarea 随内容高度自适应。
 *
 * 高度上下限刻意不在 JS 里 clamp：`min-height` / `max-height` 由 CSS 提供，窄屏
 * 断点会改写 `min-height`，若在 JS 里再写一份就必然与断点脱节。
 */
export function useComposerTextareaAutosize(
  textareaRef: RefObject<HTMLTextAreaElement | null>,
  value: string,
): void {
  const resize = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    applyTextareaAutosize(textarea);
  }, [textareaRef]);

  useEffect(() => {
    resize();
  }, [resize, value]);
}
