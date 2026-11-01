/**
 * 会话扩展审批结果 → 渠道回推（261101）。
 *
 * 提案在渠道里发起（模型把 `confirmationText` 转述给用户），确认却在 Web 的
 * 确认页完成。此前只有「发起」这一半有回执：确认、拒绝、取消、安装失败全都
 * 只在库里改状态，渠道里一声不响——用户无从判断那次确认到底生效没有。
 *
 * 现在改为**先落库再投递**（`session-extension-delivery-store`）：这里只负责
 * 入队并踢一次即时派发，真正发送与重试交给 `session-extension-delivery-dispatcher`。
 * 于是「安装已结算但回执没发出去」不再等于「永远没有回音」——后台定时器与启动
 * 补偿都会接着推。
 */

import { logGatewayWarn } from '../infra/gateway-logger.js';
import { enqueueSessionExtensionDelivery } from './session-extension-delivery-store.js';
import { dispatchSessionExtensionDeliveries } from './session-extension-delivery-dispatcher.js';

/**
 * 决策 / 取消落库后把结果排进渠道回推队列。
 *
 * 调用点在审批路由的返回路径上：这里同步抛错会变成 500，而审批其实已经落库生效，
 * 用户看到失败会重复提交（下一次只会撞上「已处理」）。整段兜住。
 *
 * 是否回推由**操作自身状态**决定（见 `buildSessionExtensionDeliveryText`）：
 * 无效 nonce / 越权 / 重复点击都不会产生终态，因此什么都不会入队。
 */
export function notifyChannelSessionExtensionOutcome(input: {
  readonly sessionId: string;
  readonly operationId: string;
}): void {
  try {
    const enqueued = enqueueSessionExtensionDelivery({
      operationId: input.operationId,
      sessionId: input.sessionId,
    });
    if (!enqueued) return;
    // 立刻试一次：绝大多数情况下一轮就送达。失败由后台派发器退避重试，
    // 因此这里**不 await**，也不把失败当错误。
    void dispatchSessionExtensionDeliveries({ maxPerRun: 1 });
  } catch (error) {
    logGatewayWarn(
      `[session-extension] 渠道回推入队失败（不影响审批结果）session=${input.sessionId} operation=${input.operationId}`,
      error,
    );
  }
}
