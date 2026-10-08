import { logGatewayError } from '../infra/gateway-logger.js';
/**
 * 通知事件总线（in-process）。
 *
 * 为什么需要它：`createNotification` / `markNotificationRead` / `archiveNotifications`
 * 这些函数过去只写 SQLite，不发任何事件，前端因此只能靠 15s 轮询 `GET /notifications`
 * 感知变化。`NotificationCenter` 与 `FloatingPermissionPrompt` 各挂一条定时器，等于
 * 每个客户端每分钟 4 次全量查询；而 `listNotifications` 顺手执行惰性过期的 `UPDATE`，
 * 于是这 4 次读请求顺带制造 4 次 SQLite 写事务去抢写锁。落库即发事件是这条轮询的替代品。
 *
 * 契约：
 *   - 纯发布订阅，**不持久化、不重放**。重放/对账由 WS 的 `sync` 快照与 HTTP 查询承担。
 *   - envelope 必带 `pendingActionableCount` 的权威值：红点是「未处理的 actionable 待办数」，
 *     让前端按本地列表数一遍必然在多标签页、惰性过期、并发收口下漂移。
 *   - 订阅者自行按 `userId` 过滤（与 `team-events-bus` 保持一致），用户之间互不可见。
 */

export type NotificationChangeReason =
  /** 审批被真正提交、或底层待办已作废。 */
  | 'acted'
  /** 用户主动忽略。 */
  | 'archived'
  /** 新通知落库（含 dedupe 命中同一 requestId 后的内容刷新）。 */
  | 'created'
  /** 超过 TTL 被惰性过期 / 会话级收口。 */
  | 'expired'
  /** 标记已读。 */
  | 'read'
  | 'updated';

export interface NotificationChangedEvent {
  /**
   * 未处理 actionable 待办数——服务端权威值。
   *
   * 推送路径刻意**不**跑惰性过期（那是一次写事务）：事件只是「这里脏了」的信号，
   * 客户端拿到后会用 HTTP 拉一次列表，由那条读路径顺手完成过期收口。
   */
  pendingActionableCount: number;
  reason: NotificationChangeReason;
  timestamp: number;
  type: 'notification.changed';
  userId: string;
}

export type NotificationEventsListener = (event: NotificationChangedEvent) => void;

export interface NotificationEventsBusStats {
  listenerCount: number;
  listenerErrorCount: number;
  publishedCount: number;
}

class NotificationEventsBus {
  private listenerErrorCount = 0;
  private listeners = new Set<NotificationEventsListener>();
  private publishedCount = 0;

  publish(event: NotificationChangedEvent): void {
    this.publishedCount += 1;
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        // 单个订阅者抛错不得让整条通知链断掉——在场的其他客户端仍需收到事件。
        this.listenerErrorCount += 1;
        logGatewayError('[notification-events] listener threw', {
          message: error instanceof Error ? error.message : String(error),
          reason: event.reason,
          userId: event.userId,
        });
      }
    }
  }

  subscribe(listener: NotificationEventsListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  stats(): NotificationEventsBusStats {
    return {
      listenerCount: this.listeners.size,
      listenerErrorCount: this.listenerErrorCount,
      publishedCount: this.publishedCount,
    };
  }

  /** 仅供测试 / 重启时清理用。运行时不要主动调用。 */
  __clearForTesting(): void {
    this.listeners.clear();
    this.listenerErrorCount = 0;
    this.publishedCount = 0;
  }
}

const bus = new NotificationEventsBus();

export function publishNotificationChangedEvent(event: NotificationChangedEvent): void {
  bus.publish(event);
}

export function subscribeToNotificationEvents(listener: NotificationEventsListener): () => void {
  return bus.subscribe(listener);
}

export function getNotificationEventsBusStats(): NotificationEventsBusStats {
  return bus.stats();
}

export function __clearNotificationEventsBusForTesting(): void {
  bus.__clearForTesting();
}
