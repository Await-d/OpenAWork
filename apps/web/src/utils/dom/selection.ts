/**
 * 读取页面当前选区的文本 / 包围盒，并要求选区确实落在给定容器内。
 *
 * 包含性检查是必要的：否则在某个内容面板里右键（或按菜单键）会捡起用户在页面
 * 别处高亮过的文本——聊天消息、文件树——并给出一个「引用」面板里根本没有的片段的
 * 菜单项。带容器判断的版本会直接返回空。
 *
 * 注意：沙箱 iframe（HTML / CSS / JS 预览）内部的选区活在**另一个 document** 里，
 * `window.getSelection()` 只能拿到外层文档的选区，因此这类预览一律报告「无选区」。
 */

export interface MeasuredRect {
  left: number;
  top: number;
  height: number;
}

/** 选区文本；无选区或选区不在 `container` 内时返回空串。 */
export function readSelectionTextWithin(container: HTMLElement): string {
  const range = readSelectionRangeWithin(container);
  return range ? range.toString().trim() : '';
}

/** 选区的视口包围盒；无选区或选区不在 `container` 内时返回 null。 */
export function readSelectionRectWithin(container: HTMLElement): MeasuredRect | null {
  const range = readSelectionRangeWithin(container);
  if (!range) {
    return null;
  }
  const rect = range.getBoundingClientRect();
  return { left: rect.left, top: rect.top, height: rect.height };
}

function readSelectionRangeWithin(container: HTMLElement): Range | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const selection = window.getSelection?.();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return null;
  }
  const anchor = selection.anchorNode;
  if (!anchor || !container.contains(anchor)) {
    return null;
  }
  return selection.getRangeAt(0);
}
