import type { ReactNode } from 'react';

/**
 * 把 react-markdown 传给 `code` 组件的 children 还原成纯文本源码。
 *
 * `rehype-highlight` 会把代码块拆成大量 `<span>` token，children 因此既不是
 * 纯字符串也不可枚举。复制、图表渲染等需要「原始源码」的场景都走这里，
 * 避免每个消费方各写一份递归。
 */
export function getCodeFenceText(content: ReactNode): string {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content.map((item) => getCodeFenceText(item)).join('');
  }

  if (!content || typeof content === 'boolean' || typeof content === 'number') {
    return content == null ? '' : String(content);
  }

  if (typeof content === 'object' && 'props' in content) {
    const props = content.props as { children?: ReactNode };
    return getCodeFenceText(props.children);
  }

  return '';
}

/**
 * react-markdown 会在围栏内容末尾补一个换行，直接进 mermaid / 复制按钮
 * 会出现多余空行，这里统一去掉。
 */
export function getTrimmedCodeFenceText(content: ReactNode): string {
  return getCodeFenceText(content).replace(/\n$/, '');
}
