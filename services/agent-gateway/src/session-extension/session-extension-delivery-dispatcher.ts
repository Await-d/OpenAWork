/**
 * 会话扩展回执的派发器（261101）。
 *
 * 只做一件事：把 `session_extension_deliveries` 里到期的记录送出去。所有状态
 * 迁移都在存储层（`session-extension-delivery-store`），这里负责**判定「送到没有」**
 * 与**决定重试还是终结**：
 *
 *   - 目标会话不是渠道会话（个人 Web 会话）⇒ `skipped` 终态。重试无穷次也不会
 *     变出一个渠道，必须直接终结；
 *   - 目标可达但发送失败（渠道停用、服务未运行、平台报错）⇒ 退避重试，超过上限
 *     置 `dead`。这些是**可能自愈**的，值得重试。
 *   - 发送成功 ⇒ `delivered`。
 *
 * 调用点：决策/取消后的即时尝试（`notifyChannelSessionExtensionOutcome`）与
 * `index.ts` 注册的后台定时器。
 */

import { randomUUID } from 'node:crypto';
import { logGatewayWarn } from '../infra/gateway-logger.js';
import {
  resolveChannelSessionNoticeTarget,
  sendChannelSessionNotice,
} from '../channels/channel-session-notice.js';
import {
  ackSessionExtensionDelivery,
  claimDueSessionExtensionDelivery,
  failSessionExtensionDelivery,
  reclaimExpiredSessionExtensionDeliveryLeases,
} from './session-extension-delivery-store.js';

export interface SessionExtensionDeliveryDispatchSummary {
  delivered: number;
  skipped: number;
  retried: number;
  dead: number;
}

/** 单轮最多派发多少条：渠道发送是网络 I/O，别让一轮把事件循环占满。 */
const MAX_DELIVERIES_PER_RUN = 10;

const DELIVERY_SOURCE = 'session.extension.decision';

/**
 * 派发一轮到期回执。
 *
 * 每轮先回收过期租约再领取——顺序不能反：先领取会把「上一轮卡住的 processing」
 * 一直漏在后面，而它其实早该被重试。
 */
export async function dispatchSessionExtensionDeliveries(
  params: { nowMs?: number; maxPerRun?: number } = {},
): Promise<SessionExtensionDeliveryDispatchSummary> {
  const now = params.nowMs ?? Date.now();
  const summary: SessionExtensionDeliveryDispatchSummary = {
    delivered: 0,
    skipped: 0,
    retried: 0,
    dead: 0,
  };

  reclaimExpiredSessionExtensionDeliveryLeases(now);

  const maxPerRun = params.maxPerRun ?? MAX_DELIVERIES_PER_RUN;
  for (let index = 0; index < maxPerRun; index += 1) {
    const leaseToken = randomUUID();
    // 用注入的 `now`：`reclaimExpiredSessionExtensionDeliveryLeases` 用的是它，领取
    // 也必须用同一个时钟，否则注入 `nowMs` 的调用方（测试、回放）拿到的领取口径与
    // 回收口径不一致。
    const claim = claimDueSessionExtensionDelivery({ leaseToken, now });
    if (!claim) break;

    const target = resolveChannelSessionNoticeTarget(claim.sessionId);
    if (!target) {
      // 非渠道会话：没有可送达的渠道，这是终态而非失败。
      ackSessionExtensionDelivery({
        operationId: claim.operationId,
        leaseToken,
        outcome: 'skipped',
      });
      summary.skipped += 1;
      continue;
    }

    const sent = await sendChannelSessionNotice({
      target,
      sessionId: claim.sessionId,
      source: DELIVERY_SOURCE,
      text: claim.text,
    });
    if (sent) {
      ackSessionExtensionDelivery({
        operationId: claim.operationId,
        leaseToken,
        outcome: 'delivered',
      });
      summary.delivered += 1;
      continue;
    }

    const state = failSessionExtensionDelivery({
      operationId: claim.operationId,
      leaseToken,
      error: '渠道回执发送失败（渠道停用、服务未运行或平台报错）。',
    });
    if (state === 'dead') {
      summary.dead += 1;
      logGatewayWarn(
        `会话扩展回执投递失败已放弃：operation=${claim.operationId} attempt=${claim.attemptCount}`,
      );
    } else if (state === 'pending') {
      summary.retried += 1;
    }
    // `null` = 租约已不归自己（被过期回收）：本轮不计，留给下一轮重领。
  }

  return summary;
}
