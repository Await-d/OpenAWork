import type { MemoryProposal, MemoryScope } from '@openAwork/agent-core';
import { isProposalExpired, memoryScopeKey } from '@openAwork/agent-core';

/**
 * 记忆提议授权门（261101-记忆确认写入与周期整理）。
 *
 * 本模块只回答「这个 actor 此刻能不能处理这条提议」。它是**安全门**，不是便利层：
 *   - 后台维护任务（`maintenance`）**永远**不能确认提议，它只能产生提议；
 *   - 只有提议归属的用户本人才能确认；
 *   - 非 pending / 已过期的提议一律拒绝。
 *
 * 渠道内「群成员代批」本期不支持，故不在 `canManageMemoryScope` 里实现任何代批逻辑。
 */

export interface MemoryProposalActor {
  userId: string;
  kind: 'user' | 'maintenance';
}

/**
 * 是否允许该 actor 确认该提议。
 *
 * fail-closed：任何一项不满足即拒绝。过期判定用 `isProposalExpired`（解析不了时间按过期处理）。
 */
export function canConfirmMemoryProposal(
  actor: MemoryProposalActor,
  proposal: MemoryProposal,
  now: Date = new Date(),
): boolean {
  if (actor.kind !== 'user') {
    return false;
  }
  if (actor.userId !== proposal.userId) {
    return false;
  }
  if (proposal.status !== 'pending') {
    return false;
  }
  if (isProposalExpired(proposal.expiresAt, now)) {
    return false;
  }
  return true;
}

/**
 * 是否允许该用户管理某作用域。
 *
 * user / workspace / team / channel_chat 四种作用域都要求 `scope.id` 归属该用户：
 *   - user 作用域要求 `scope.id === userId`（id 就是归属用户）；
 *   - 其余作用域要求 id 非空——这些作用域的 id 由该用户自己的会话 / 工作区 / 渠道实例
 *     派生，能拿到该 scope 即意味着归属该用户（本期不支持跨用户委派）。
 *
 * 渠道作用域的 id 是 `memoryChannelScopeKey` 产物，本身不含 userId，故这里只做
 * 「非空 + 合法前缀」校验，不伪造归属判断。
 */
export function canManageMemoryScope(userId: string, scope: MemoryScope): boolean {
  const trimmedUserId = userId.trim();
  if (trimmedUserId.length === 0) {
    return false;
  }
  const scopeId = scope.id.trim();
  if (scopeId.length === 0) {
    return false;
  }
  switch (scope.type) {
    case 'user':
      return scopeId === trimmedUserId;
    case 'workspace':
    case 'team':
      return scopeId.length > 0;
    case 'channel_chat':
      // `channel:<platform>:<instance>:chat:<chatId>`；仅接受该规范前缀，
      // 避免把任意字符串当成渠道作用域。
      return scopeId.startsWith('channel:') && scopeId.includes(':chat:');
    default:
      return false;
  }
}

/** 便于调用方在错误信息里带上作用域键。 */
export function describeMemoryScope(scope: MemoryScope): string {
  return memoryScopeKey(scope);
}
