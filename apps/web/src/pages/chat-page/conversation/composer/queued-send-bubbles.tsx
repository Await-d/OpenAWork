import type { CSSProperties } from 'react';
import type { QueuedComposerPreview } from './queued-composer-state.js';

/**
 * 对话流末尾的「待发」气泡。
 *
 * 排队条目此前只在 composer 的追加按钮上可见（tooltip `· 已排队 N 条`），对话流里
 * 没有任何痕迹：用户按下 Enter 后输入框被立刻清空，自己的消息就此从屏幕上消失，
 * 无从判断「到底收下了没有、什么时候会发出去」。会话正在跑复杂任务时，这段等待可能
 * 很长，正是「看起来没反应」最容易发生的地方。
 *
 * 这里把待发条目按时间轴补回消息流末尾——它排在正在生成的那一轮之后，与该条目真正
 * 发出后转成的历史气泡位置一致，因此不会出现位次跳变。
 *
 * 挂载点是 `ChatMessageGroupList.trailingContent`：待发条目**不是** `ChatMessage`
 * （它尚未存在于会话历史，也不应被 `normalizeChatMessages` 一类路径当成已发送消息），
 * 所以不进 `ChatRenderGroup` 判别联合，只作为列表尾部的附加内容渲染。
 */
export function QueuedSendBubbles({ items }: { items: QueuedComposerPreview[] }) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div data-testid="chat-queued-send-bubbles" style={PANEL_STYLE}>
      <div style={HINT_STYLE}>
        {items.length === 1
          ? '已收到 1 条待发消息，将在当前回复结束后发送'
          : `已收到 ${items.length} 条待发消息，将在当前回复结束后依次发送`}
      </div>
      {items.map((item) => (
        <QueuedSendBubble key={item.id} item={item} />
      ))}
    </div>
  );
}

function QueuedSendBubble({ item }: { item: QueuedComposerPreview }) {
  const text = item.text.trim();

  return (
    <div style={BUBBLE_STYLE}>
      <div style={META_ROW_STYLE}>
        <span style={BADGE_STYLE}>待发</span>
        {item.attachmentCount > 0 ? (
          <span style={META_TEXT_STYLE}>{item.attachmentCount} 个附件</span>
        ) : null}
        {item.requiresAttachmentRebind ? <span style={WARN_TEXT_STYLE}>需重新选择附件</span> : null}
      </div>
      {text.length > 0 ? (
        <div style={TEXT_STYLE}>{text}</div>
      ) : (
        <div style={META_TEXT_STYLE}>（仅附件）</div>
      )}
    </div>
  );
}

const PANEL_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-end',
  gap: 8,
  paddingTop: 4,
};

const HINT_STYLE: CSSProperties = {
  fontSize: 11.5,
  color: 'var(--fg-muted)',
};

/**
 * 虚线边框是本组件唯一的「尚未发出」视觉标记：实线会与真正的用户气泡混淆，而用户
 * 这条消息此刻确实还没进入会话历史。
 */
const BUBBLE_STYLE: CSSProperties = {
  maxWidth: '72%',
  padding: '8px 12px',
  borderRadius: 14,
  border: '1px dashed color-mix(in srgb, var(--accent) 40%, transparent)',
  background: 'color-mix(in srgb, var(--accent) 8%, var(--bg-overlay))',
  color: 'var(--fg-default)',
  fontSize: 13,
  lineHeight: 1.6,
};

const META_ROW_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 6,
  marginBottom: 4,
};

const BADGE_STYLE: CSSProperties = {
  fontSize: 10.5,
  fontWeight: 600,
  letterSpacing: '0.04em',
  padding: '1px 6px',
  borderRadius: 999,
  color: 'var(--accent)',
  border: '1px solid color-mix(in srgb, var(--accent) 35%, transparent)',
};

const META_TEXT_STYLE: CSSProperties = {
  fontSize: 10.5,
  color: 'var(--fg-muted)',
};

const WARN_TEXT_STYLE: CSSProperties = {
  fontSize: 10.5,
  color: 'var(--warning)',
};

const TEXT_STYLE: CSSProperties = {
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
};
