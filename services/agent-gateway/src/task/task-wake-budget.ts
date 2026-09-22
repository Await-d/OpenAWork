/**
 * 自动唤醒预算。
 *
 * **为什么需要**：单通道交付的唤醒是**事件驱动**的——子代理结算 → 投递通知 → 唤醒父会话。
 * 若被唤醒的父会话又委派了新的后台子代理，其完成会再次唤醒它，形成**无界自激循环**
 * （旧机制正是为此设了 10 次上限；T-31 清理时该计数器随之删除，此处以新语义补回）。
 *
 * **语义**（与旧机制一致但更精确）：
 *   - 只统计**连续自动唤醒**；**用户真实发言即重置**（网关内部请求不重置）；
 *   - 超出预算时**仍然投递通知**，只是不再唤醒——通知已落库，用户下一次自然发言
 *     时模型依然能看到它，因此**不丢信息**，只避免自动循环。
 *
 * 进程内存储（与旧机制一致）：重启即清零，属可接受语义——重启后的首次唤醒总是允许的。
 */

/** 连续自动唤醒上限。与旧 `MAX_CONSECUTIVE_TASK_PARENT_AUTO_RESUMES` 数值一致。 */
export const MAX_CONSECUTIVE_AUTO_WAKES = 10;

const consecutiveWakeCounts = new Map<string, number>();

function sessionKey(input: { sessionId: string; userId: string }): string {
  return `${input.userId}:${input.sessionId}`;
}

/**
 * 尝试消耗一次唤醒预算。
 *
 * @returns `true` = 允许唤醒（已计数）；`false` = 预算耗尽（调用方应只投递不唤醒）。
 */
export function tryConsumeWakeBudget(input: { sessionId: string; userId: string }): boolean {
  const key = sessionKey(input);
  const current = consecutiveWakeCounts.get(key) ?? 0;
  if (current >= MAX_CONSECUTIVE_AUTO_WAKES) {
    return false;
  }
  consecutiveWakeCounts.set(key, current + 1);
  return true;
}

/**
 * 用户真实交互 → 重置连续唤醒计数。
 *
 * ⚠️ 只应由**非网关内部请求**调用（调用方用 `isGatewayInternalRequestKey` 判定）：
 * 唤醒自身也是请求，若它也重置计数，上限就永远触发不了。
 */
export function noteManualSessionInteraction(input: { sessionId: string; userId: string }): void {
  consecutiveWakeCounts.delete(sessionKey(input));
}

/** 读取当前连续唤醒次数（观测 / 测试用）。 */
export function readConsecutiveWakeCount(input: { sessionId: string; userId: string }): number {
  return consecutiveWakeCounts.get(sessionKey(input)) ?? 0;
}

/** 仅测试使用：清空全部计数。 */
export function resetWakeBudgetForTests(): void {
  consecutiveWakeCounts.clear();
}
