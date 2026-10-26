/* ── 自由文本工具输出的 Markdown 渲染（codesearch / LSP hover 共用） ── */

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * 约定：只接受**已经是 Markdown** 的文本（代码围栏 / 列表 / 段落）。
 * 纯日志、终端输出不应走这里 —— Markdown 会吞掉多余空白，逐行结构会丢。
 *
 * `react-markdown` 默认不渲染原始 HTML，LSP / 搜索返回的 `<script>` 之类只会
 * 变成普通文本，不需要额外 sanitize 层。
 */
export function MarkdownTextPreview({
  text,
  emptyText = '（没有内容）',
}: {
  text: string;
  emptyText?: string;
}) {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return <div className="tool-call-inline-empty">{emptyText}</div>;
  }

  return (
    <div className="chat-markdown" style={{ fontSize: 11.5, lineHeight: 1.6 }}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{trimmed}</ReactMarkdown>
    </div>
  );
}
