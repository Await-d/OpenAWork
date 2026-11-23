/**
 * 用户消息「超长正文默认折叠」验收 harness（真实 Chromium）。
 *
 * 覆盖 jsdom 覆盖不到的部分——用户消息是 `white-space: pre-wrap` 的纯文本，长度不受
 * 任何约束（粘贴整段日志 / 源码是常见操作），折叠是否真的把高度钳住、按钮在窄视口下
 * 是否会溢出，只有真实布局引擎能判定：
 *
 *   - 超过阈值时默认折叠：`.chat-markdown-fold-body` 计算高度 ≈ 60vh，内容确实被裁剪
 *   - 整条消息不把页面撑开：内容区总高度 ≈ 折叠体高度 + 按钮高度
 *   - 「展开全部 · N 字符」按钮水平居中且完整落在内容容器内（375px 也不溢出）
 *   - 点击展开后高度放开（内容完整可见），点击收起后回到 60vh
 *   - 短消息不产生任何折叠控件
 *
 * 渲染的是真实链路：`renderChatMessageContentWithOptions` → 真实折叠组件 + 真实 CSS。
 * 运行方式见同目录 `README.md`；断言由 `verify-user-message-fold.ts` 执行。
 */
import { createRoot } from 'react-dom/client';
import type { ChatMessage } from '../src/components/conversation-runtime/messages/support.js';
import { renderChatMessageContentWithOptions } from '../src/components/chat/session/ChatPageSections.js';
import '../src/components/chat/message/chat-message.css';

const VIEWPORTS = [375, 768, 1280];
/** 300 行 × ≈ 40 字符 ≈ 12000 字符，远高于 1500 字符阈值，也远高于 60vh 的可视行数。 */
const LONG_LINE_COUNT = 300;

function longLine(lineNumber: number): string {
  return `第 ${lineNumber} 行：用户粘进来的日志正文，用于验证超长消息默认折叠且不撑开页面。`;
}

function buildLongUserContent(): string {
  return Array.from({ length: LONG_LINE_COUNT }, (_, index) => longLine(index + 1)).join('\n');
}

/**
 * 复刻 `MessageRow` 的列结构（row → main → content-shell → content），
 * 折叠容器就挂在这一层 `.chat-message-content[data-role='user']` 内。
 */
function UserMessageCase({ id, content }: { id: string; content: string }) {
  const message: ChatMessage = { id, role: 'user', content };

  return (
    <div className="message-stack">
      <article className="chat-message-row" data-role="user">
        <div className="chat-message-main">
          <div className="chat-message-content-shell" data-role="user">
            <div className="chat-message-content" data-role="user">
              {renderChatMessageContentWithOptions(message, { presentationMode: 'chat' })}
            </div>
          </div>
        </div>
      </article>
    </div>
  );
}

function Viewport({ width }: { width: number }) {
  return (
    <div className="viewport" data-viewport={width} style={{ width }}>
      <div className="viewport-label">{width}px</div>
      <div className="case" data-case="user-long">
        <div className="case-label">用户超长消息（{LONG_LINE_COUNT} 行 · 默认折叠）</div>
        <UserMessageCase id={`harness-user-long-${width}`} content={buildLongUserContent()} />
      </div>
      <div className="case" data-case="user-short">
        <div className="case-label">用户短消息（不折叠）</div>
        <UserMessageCase
          id={`harness-user-short-${width}`}
          content="帮我看下这个报错是什么原因。"
        />
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <>
    {VIEWPORTS.map((width) => (
      <Viewport key={width} width={width} />
    ))}
  </>,
);
