import { useState } from 'react';
import { CopyBtn } from '../shared/copy-btn.js';
import { MarkdownTextPreview } from './markdown-text-preview.js';

/* ── ChannelMessagePreview（渠道发送类工具的消息正文） ── */

/**
 * 正文超过这个字数就默认折叠。与 `read` 的 30 行预览同思路：卡片里不铺全文，
 * 但**一定给一行可读的 meta**（字数 / 行数）让人知道发出去了多少内容。
 */
const COLLAPSED_BODY_LIMIT = 400;

/**
 * 渠道发送类工具发出去的那条消息。
 *
 * 正文按 **markdown 渲染**而不是当参数值打印：它是给聊天软件看的富文本（标题 / 列表 /
 * 加粗），铺源码只会得到一堵 `**` 墙（这正是「参数」表渲染出来的样子）。
 * 折叠用 CSS 限高而不是截断字符串——截断会切坏 markdown 结构（半个代码围栏 / 半个链接）。
 */
export function ChannelMessagePreview({ body, hint }: { body: string; hint: string }) {
  const [expanded, setExpanded] = useState(false);
  const lineCount = body.split('\n').length;
  const collapsible = body.length > COLLAPSED_BODY_LIMIT;
  const collapsed = collapsible && !expanded;

  return (
    <div className="channel-message-preview">
      <div className="channel-message-meta">
        <span className="channel-message-hint">{hint}</span>
        <span className="channel-message-size">
          {body.length} 字{lineCount > 1 ? ` · ${lineCount} 行` : ''}
        </span>
        <CopyBtn text={body} title="复制正文" />
      </div>
      <div className="channel-message-body" data-collapsed={collapsed ? 'true' : 'false'}>
        <MarkdownTextPreview text={body} emptyText="（空消息）" />
      </div>
      {collapsible && (
        <button type="button" className="tool-output-toggle" onClick={() => setExpanded((v) => !v)}>
          {expanded ? '收起' : '显示全部'}
        </button>
      )}
    </div>
  );
}
