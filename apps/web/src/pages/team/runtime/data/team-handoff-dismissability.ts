/**
 * 失败 handoff「关闭」入口的单一判定规则（错误诊断简报与 classic 内联卡共用）。
 *
 * 服务端快照下发的 `dismissableFailure` 是权威来源：它已计入「不可恢复」与
 * orphaned executor / reviewer 失败（这两类后端的 dismiss 路由不接受）。
 * 事件总线不携带该标记，因此仅经 WS 事件到达、尚未水合快照时回落到本地
 * 近似规则：executor / reviewer 层服务端不接受关闭，仍有自动恢复路径
 * （recoverableFailure === true）也不展示，避免给出必然 409 的按钮。
 */

import type { HandoffEntry } from '../../../../stores/team/team-events.js';

export type HandoffDismissabilityInput = Pick<
  HandoffEntry,
  'dismissableFailure' | 'recoverableFailure' | 'toRoleLayer'
>;

export function isHandoffDismissable(handoff: HandoffDismissabilityInput): boolean {
  return (
    handoff.dismissableFailure ??
    (handoff.toRoleLayer !== 'executor' &&
      handoff.toRoleLayer !== 'reviewer' &&
      handoff.recoverableFailure !== true)
  );
}
