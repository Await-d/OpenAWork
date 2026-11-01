import { AsyncLocalStorage } from 'node:async_hooks';
import type { ChannelPermissions } from './types.js';

/**
 * 本轮渠道对话的成员权限快照。
 *
 * 为什么需要它：群聊会话按 `chatId` 复用（`buildChannelSessionKey`），同一群的所有
 * 成员共用一条会话与一份 `sessions.metadata_json`。成员 ACL 的结果
 * （`toolAllowlist` / `permissions`）此前只写在这份**共享** metadata 上，而：
 *   - 工具面在**本轮开始时**按 metadata 快照构建（`routes/stream.ts`）；
 *   - 权限判定在**每次工具执行时**重新 `SELECT metadata_json`
 *     （`tools/sandbox/permission-ladder.ts` → `getSessionMetadata`）。
 *
 * 于是同群成员交替发言时，后发言者的 ACL 会覆盖前者**正在进行**的那一轮：轻则
 * 权限抖动，重则实时判定不过而落入 pending，把会话钉在 paused 上。
 *
 * 本模块把「这一轮是谁、他有什么权限」变成随 run 传递的轮次级上下文：run 开始时
 * 由渠道入口建立，工具面与权限判定都优先读它，两边因此同源。会话 metadata 上的
 * 同名键仍会照常写入 —— 它留给**无本作用域**的路径（例如 Web 端审批后的续跑）做
 * 回退，也保留最后发言者的排障痕迹。
 */
export interface ChannelActorPolicy {
  /** 该成员与渠道权限取交集后的有效权限（只能收窄）。 */
  readonly permissions: ChannelPermissions;
  /** 该成员的工具白名单；`null` 表示不额外限缩，`[]` 表示禁用全部工具。 */
  readonly toolAllowlist: readonly string[] | null;
}

const actorPolicyScope = new AsyncLocalStorage<ChannelActorPolicy>();

/** 在本轮 run 的 async 链内固定成员权限；作用域外的读取一律回退会话 metadata。 */
export function runWithChannelActorPolicy<T>(
  policy: ChannelActorPolicy,
  run: () => Promise<T>,
): Promise<T> {
  return actorPolicyScope.run(policy, run);
}

export function getChannelActorPolicy(): ChannelActorPolicy | undefined {
  return actorPolicyScope.getStore();
}
