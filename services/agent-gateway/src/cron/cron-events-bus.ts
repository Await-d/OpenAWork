/**
 * 定时任务变更事件总线（T-23 定时任务专用 SSE 的服务端来源）。
 *
 * 动机：任务页此前靠轮询 `GET /cron/jobs`（+ 逐任务 `/history`）感知「任务有变化」，
 * 既费请求又不实时；改为服务端推送后，任何**已落库**的任务定义 / 启停 / 执行
 * 生命周期变更都会在本模块发布，`GET /cron/events` 的订阅者把它转成 SSE 事件。
 *
 * 为什么单独一个模块、而不塞进调度器？
 * - 调度器（`scheduler.ts`）刻意保持「可单测、无 DB 依赖」；事件总线是应用层概念，
 *   与持久化解耦。
 * - 路由层与调度器都能发布，且互不 import，避免 `router ↔ scheduler` 环。
 *
 * 与 `mcp/mcp-tool-catalog.ts` 的 `publishChange` 同构：发布时对订阅者集合取
 * 快照再派发（订阅者自行退订不会打乱迭代），单个订阅者抛错被隔离、绝不影响其它
 * 订阅者，也绝不影响调用方（发布发生在 HTTP 写入路径 / 调度器热路径上）。
 */

import { logGatewayWarn } from '../infra/gateway-logger.js';

/**
 * 触发一次「任务有变化」推送的原因。
 *
 * **刻意精简**：只发「有变化」这件事（reason + jobId），不推任务全量 / 执行记录——
 * 客户端收到即静默重拉 REST（`GET /cron/jobs`）。这样契约稳定、载荷小，且不会
 * 出现「推送的旧快照覆盖客户端刚拉的新数据」的竞态。
 */
export type CronJobsChangedReason =
  | 'created'
  | 'updated'
  | 'deleted'
  | 'enabled'
  | 'disabled'
  | 'run_started'
  | 'run_finished'
  /** 到点但被跳过（任务在途 / 并发已满）；会落一条 `skipped` 执行记录，故需推送。 */
  | 'run_skipped'
  /** 建臂失败（表达式非法 / 无解 / 一次性任务缺时刻）；会落一条 `failed` 执行记录。 */
  | 'schedule_error';

export interface CronJobsChangedEvent {
  /** 变更所属用户；SSE 端点据此做用户级隔离。 */
  readonly userId: string;
  readonly reason: CronJobsChangedReason;
  /** 受影响的任务 id；不可得时为 `null`（客户端退化为整表重拉，仍是正确语义）。 */
  readonly jobId: string | null;
}

export type CronJobsChangedListener = (event: CronJobsChangedEvent) => void;

const listeners = new Set<CronJobsChangedListener>();

/** 订阅任务变更事件；返回退订 thunk。订阅时不重放历史（调用方自取当前状态）。 */
export function subscribeCronJobsChanged(listener: CronJobsChangedListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * 发布一次任务变更事件。
 *
 * **调用约束**：必须在对应的数据库写入**成功之后**调用（见各发布点注释）；
 * 本函数的合约是「广播一个已经发生的事实」，它不做任何持久化。
 */
export function publishCronJobsChanged(event: CronJobsChangedEvent): void {
  // 快照订阅者集合：某个订阅者在派发中途退订（SSE 断开）不会移动其余迭代器。
  const snapshot = Array.from(listeners);
  for (const listener of snapshot) {
    try {
      listener(event);
    } catch (err) {
      // 单个订阅者（如某条已半开的 SSE 连接）抛错不得影响其它订阅者，
      // 更不得把异常扩散回 HTTP 写入路径 / 调度器的 finally。
      logGatewayWarn('[cron] 任务变更事件订阅者抛错，已隔离', {
        error: err instanceof Error ? err.message : String(err),
        reason: event.reason,
      });
    }
  }
}

/** 当前订阅者数量（仅供测试断言拆除 / 无泄漏）。 */
export function getCronJobsChangedSubscriberCount(): number {
  return listeners.size;
}

/** 清空所有订阅者（仅供测试隔离，避免跨用例共享模块级状态）。 */
export function __resetCronJobsChangedSubscribersForTest(): void {
  listeners.clear();
}
