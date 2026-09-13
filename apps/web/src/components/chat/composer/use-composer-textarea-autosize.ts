import { useCallback, useEffect } from 'react';
import type { RefObject } from 'react';

/** textarea 内容超过此高度后转为内部滚动，与 ChatComposer.css 的 max-height 一致。 */
export const TEXTAREA_MAX_HEIGHT_PX = 280;

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
    // 先归零再量取 scrollHeight，否则高度只增不减。
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > TEXTAREA_MAX_HEIGHT_PX ? 'auto' : 'hidden';
  }, [textareaRef]);

  useEffect(() => {
    resize();
  }, [resize, value]);
}
