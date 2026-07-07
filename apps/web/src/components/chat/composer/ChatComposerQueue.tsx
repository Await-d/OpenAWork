import { ComposerHintChip } from './chat-composer-primitives.js';

export interface QueuedComposerMessage {
  readonly id: string;
  readonly label: string;
  readonly requiresAttachmentRebind?: boolean;
  readonly title?: string;
}

export interface ChatComposerQueueProps {
  readonly queuedMessages: readonly QueuedComposerMessage[];
  readonly onRemoveQueuedMessage: (id: string) => void;
  readonly onRestoreQueuedMessage?: (id: string) => void;
}

export function ChatComposerQueue({
  queuedMessages,
  onRemoveQueuedMessage,
  onRestoreQueuedMessage,
}: ChatComposerQueueProps) {
  if (queuedMessages.length === 0) return null;

  return (
    <div className="composer-queue">
      <span className="composer-queue-label">待发队列</span>
      <div className="composer-queue-items">
        {queuedMessages.slice(0, 3).map((item, index) => (
          <span
            key={item.id}
            className={`composer-queue-pill${item.requiresAttachmentRebind ? ' warning' : ''}${
              index === 0 ? ' next' : ''
            }`}
            title={item.title ?? item.label}
          >
            <span className="composer-queue-text">
              {index === 0 ? `下一条：${item.label}` : item.label}
            </span>
            {onRestoreQueuedMessage && (
              <button
                type="button"
                onClick={() => onRestoreQueuedMessage(item.id)}
                title={
                  item.requiresAttachmentRebind
                    ? '恢复到输入框，并重新选择附件后发送'
                    : '恢复到输入框继续编辑'
                }
                className="composer-queue-action"
              >
                恢复
              </button>
            )}
            <button
              type="button"
              onClick={() => onRemoveQueuedMessage(item.id)}
              title="移出队列"
              aria-label="移出队列"
              className="composer-queue-remove"
            >
              ×
            </button>
          </span>
        ))}
        {queuedMessages.length > 3 && (
          <ComposerHintChip label={`+${queuedMessages.length - 3} 条待发`} tone="accent" />
        )}
      </div>
    </div>
  );
}
