import type { CSSProperties } from 'react';
import type { Message, MessageContent } from '@openAwork/shared';

function renderContent(content: MessageContent): string {
  if (content.type === 'text') return content.text;
  if (content.type === 'tool_call') return `[工具: ${content.toolName}]`;
  if (content.type === 'tool_result') return `[结果: ${content.isError ? '错误' : '正常'}]`;
  return '';
}

export interface ChatMessageProps {
  message: Message;
  style?: CSSProperties;
}

export function ChatMessage({ message, style }: ChatMessageProps) {
  const isUser = message.role === 'user';
  const text = message.content.map(renderContent).join('');

  return (
    <div
      style={{
        maxWidth: '75%',
        alignSelf: isUser ? 'flex-end' : 'flex-start',
        background: isUser ? 'var(--color-accent, #6366f1)' : 'var(--color-surface, #1e293b)',
        border: isUser ? 'none' : '1px solid var(--color-border, #334155)',
        borderRadius: 10,
        padding: '0.6rem 0.9rem',
        fontSize: 12,
        lineHeight: 1.6,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        ...style,
      }}
    >
      {text}
    </div>
  );
}
