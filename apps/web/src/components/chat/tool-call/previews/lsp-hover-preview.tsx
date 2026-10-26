/* ── LSP hover（文档 Markdown） ── */

import { MarkdownTextPreview } from './markdown-text-preview.js';

/**
 * hover 返回的是符号文档（LSP `MarkupContent.value`），常见形态是 Markdown
 * 代码块 + 段落；与 `codesearch` 共用同一套 Markdown 渲染（空态文案不同）。
 */
export function LspHoverPreview({ text }: { text: string }) {
  return <MarkdownTextPreview text={text} emptyText="（没有 hover 内容）" />;
}
