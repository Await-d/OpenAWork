/**
 * 首 token 前「等待中」提示的时间锚点：阈值与中文格式化。
 *
 * 放在 utils 而不是消费方组件：`ChatPageSections` 已接近单文件 1500 行上限，且这里是
 * 纯计算——阈值常量与格式化同属一处，一起改才有意义。
 */

/**
 * 占位气泡出现多久之后补上「已等待 N 秒」锚点。
 *
 * 阈值取得比网关「取锁 → 落用户消息 → 调上游」的常规耗时略长，避免短请求闪一下
 * 数字又消失；超过它说明这轮确实在等（构建系统提示词与工具面、拉起 MCP、上游首
 * token），此时时间锚点能帮用户区分「慢」和「卡死」。
 */
export const PENDING_WAIT_HINT_THRESHOLD_MS = 3_000;

/** 把等待毫秒格式化为中文时长（不足 1 分钟只报秒，避免「0 分 07 秒」这种读数）。 */
export function formatPendingWaitLabel(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  if (totalSeconds < 60) {
    return `${totalSeconds} 秒`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds === 0 ? `${minutes} 分钟` : `${minutes} 分 ${seconds} 秒`;
}
