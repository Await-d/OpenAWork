/**
 * attach 重连风暴熔断判定（纯函数）。
 *
 * 背景：attach 成功、断线重连、权限回复续跑、`no_active_stream` 重试会叠加成一条
 * 「attach → 断开 → 重置 → 再 attach」的自激链路。每轮都关闭并重建传输、重放事件、
 * 甚至全量重载快照，几秒内占满主线程，页面卡死到无法操作（刷新只是重新开始循环）。
 *
 * 判定语义：**固定时间窗内的绝对次数上限**。
 * 刻意不用「两次间隔是否够长」来重置计数——重连退避是 400ms + 网络往返 + 快照加载，
 * 单轮很容易超过 2s，用间隔判定会让计数被反复清零、熔断永不触发（这正是上一版
 * 熔断失效的原因）。窗口过期才清零，保证最坏情况下循环也在有限次数内停住。
 */
export interface AttachStormGuardInput {
  /** 当前窗口的起始时间戳（0 表示尚未开始任何窗口）。 */
  windowStartedAt: number;
  /** 本次判定时刻。 */
  now: number;
  /** 当前窗口内已发生的 attach 次数。 */
  attemptsInWindow: number;
  /** 单窗口内允许的 attach 次数上限。 */
  maxAttempts: number;
  /** 窗口长度。 */
  windowMs: number;
}

export interface AttachStormGuardResult {
  allowed: boolean;
  attemptsInWindow: number;
  windowStartedAt: number;
}

export function evaluateAttachStormGuard(input: AttachStormGuardInput): AttachStormGuardResult {
  const windowExpired =
    input.windowStartedAt <= 0 || input.now - input.windowStartedAt > input.windowMs;
  const attemptsInWindow = windowExpired ? 1 : Math.max(1, input.attemptsInWindow + 1);

  return {
    allowed: attemptsInWindow <= input.maxAttempts,
    attemptsInWindow,
    windowStartedAt: windowExpired ? input.now : input.windowStartedAt,
  };
}
