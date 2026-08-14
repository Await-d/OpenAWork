import type { TeamMessage } from './team-message.js';

export type MessageHandler = (message: TeamMessage) => void | Promise<void>;

export interface MessageBus {
  /** 订阅消息（某个成员注册处理函数） */
  subscribe(subscriberId: string, handler: MessageHandler): void;

  /** 取消订阅 */
  unsubscribe(subscriberId: string): void;

  /** 发布消息（根据 to 字段路由） */
  publish(message: TeamMessage): void;

  /** 消息路由（返回应该接收此消息的成员 ID 列表） */
  route(message: TeamMessage): string[];

  /** 获取待处理消息数量（某个成员的队列长度） */
  getPendingCount(memberId: string): number;
}

export class MessageBusImpl implements MessageBus {
  private subscribers = new Map<string, MessageHandler>();
  private messageQueues = new Map<string, TeamMessage[]>();
  private readonly MAX_QUEUE_SIZE = 100;

  subscribe(subscriberId: string, handler: MessageHandler): void {
    this.subscribers.set(subscriberId, handler);
    if (!this.messageQueues.has(subscriberId)) {
      this.messageQueues.set(subscriberId, []);
    }
  }

  unsubscribe(subscriberId: string): void {
    this.subscribers.delete(subscriberId);
    this.messageQueues.delete(subscriberId);
  }

  publish(message: TeamMessage): void {
    const recipients = this.route(message);

    for (const recipientId of recipients) {
      const handler = this.subscribers.get(recipientId);
      const queue = this.messageQueues.get(recipientId);

      if (queue) {
        // 队列长度限制，防止内存泄漏
        if (queue.length >= this.MAX_QUEUE_SIZE) {
          queue.shift(); // 移除最旧的消息
        }
        queue.push(message);
      }

      if (handler) {
        // 异步调用处理函数，避免阻塞
        void Promise.resolve()
          .then(() => handler(message))
          .catch((error) => {
            // 处理函数执行失败不应影响其他接收者
            console.error(`Message handler error for ${recipientId}:`, error);
          });
      }
    }
  }

  route(message: TeamMessage): string[] {
    const recipients: string[] = [];

    // 规则 1: 广播消息 -> 所有订阅者
    if (message.type === 'broadcast') {
      return Array.from(this.subscribers.keys()).filter((id) => id !== message.from);
    }

    // 规则 2: 明确指定接收者 -> to 字段
    if (message.to) {
      if (Array.isArray(message.to)) {
        recipients.push(...message.to);
      } else {
        recipients.push(message.to);
      }
    }

    // 规则 3: 响应消息 -> 查找原始请求的发送者
    if (message.type === 'response' && message.replyTo) {
      const originalSender = this.findOriginalSender(message.replyTo);
      if (originalSender) {
        recipients.push(originalSender);
      }
    }

    // 规则 4: 升级消息 -> 特殊处理（发送给协调者或人工）
    if (message.type === 'escalation') {
      recipients.push('coordinator'); // 假设有协调者角色
    }

    // 去重并排除发送者本身
    return [...new Set(recipients)].filter((id) => id !== message.from);
  }

  getPendingCount(memberId: string): number {
    return this.messageQueues.get(memberId)?.length ?? 0;
  }

  private findOriginalSender(messageId: string): string | undefined {
    // 遍历所有消息队列，找到 messageId 对应的消息的 from 字段
    for (const queue of this.messageQueues.values()) {
      const msg = queue.find((m) => m.id === messageId);
      if (msg) return msg.from;
    }
    return undefined;
  }
}
