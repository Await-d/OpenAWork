/**
 * 待发队列「发送被拒」的跨模块回流通道。
 *
 * 队列来源的消息被网关单飞锁拒成 `SESSION_ALREADY_RUNNING` 时,发送方
 * (`run-send-message.ts`)不能把它当普通流错误终态——网关在落库用户消息**之前**就
 * 拒绝了请求,会话历史里不会有这条消息,弹「当前会话已有请求正在运行。」只会让用户
 * 以为消息丢了。正确动作是回流:把条目放回队列,等会话空闲后重试。
 *
 * 采用 window CustomEvent 总线而非回调穿透(payload → ChatPage → deps),与
 * `session-list-events.ts` 同一范式:发送方与队列持方(编辑器 hook)互不依赖,
 * 监听方不在线时事件自然丢弃——服务端记录由发送方兜底重入队,不依赖本事件送达。
 */

import type { AttachmentItem } from '@openAwork/shared-ui';

const QUEUED_MESSAGE_SEND_REJECTED_EVENT = 'openAwork:queued-message-send-rejected';

export interface RejectedQueuedMessage {
  attachmentItems: AttachmentItem[];
  /** 与条目在客户端 IndexedDB 里的 Blob 同序,可直接回填队列条目。 */
  files: File[];
  itemId: string;
  sessionId: string;
  text: string;
}

export function notifyQueuedMessageSendRejected(payload: RejectedQueuedMessage): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.dispatchEvent(
    new CustomEvent<RejectedQueuedMessage>(QUEUED_MESSAGE_SEND_REJECTED_EVENT, { detail: payload }),
  );
}

export function onQueuedMessageSendRejected(
  listener: (payload: RejectedQueuedMessage) => void,
): () => void {
  if (typeof window === 'undefined') {
    return () => undefined;
  }

  const handler = (event: Event): void => {
    const detail = (event as CustomEvent<RejectedQueuedMessage | null>).detail;
    if (!detail || typeof detail.itemId !== 'string' || detail.itemId.length === 0) {
      return;
    }
    listener(detail);
  };

  window.addEventListener(QUEUED_MESSAGE_SEND_REJECTED_EVENT, handler);
  return () => {
    window.removeEventListener(QUEUED_MESSAGE_SEND_REJECTED_EVENT, handler);
  };
}
