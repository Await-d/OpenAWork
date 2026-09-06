/**
 * 把 ChatRenderEntry[] 按相邻同 role 聚合成 ChatRenderGroup[]。
 *
 * 规则：
 * - 相邻两条消息 role 相同，且 `groupIdentityKey` 相同 → 合入同一 group
 * - role 切换 → 起一个新 group
 * - 每个 group 用首条 entry 的 message.id 作为 key
 *
 * 这是个纯函数协议工具，与产品（chat / team）无关，从
 * `pages/chat-page/conversation/render/chat-page-utils.ts` 下沉到此处，
 * 让 team / chat 都能直接 import，避免 team 跨引 chat 装配。
 *
 * 关联文档：
 * - `.agentdocs/workflow/260518-team-conversation-decouple-plan.md` 候选 #1
 */

import type {
  ChatRenderEntry,
  ChatRenderGroup,
} from '../../chat/message/chat-message-group-list.js';

export function groupChatRenderEntries(entries: ChatRenderEntry[]): ChatRenderGroup[] {
  const groups: ChatRenderGroup[] = [];
  const seenMessageIds = new Set<string>();
  const seenAssistantRequestIds = new Set<string>();
  for (const entry of entries) {
    const messageId = entry.message.id.trim();
    if (messageId.length > 0 && seenMessageIds.has(messageId)) {
      continue;
    }
    if (messageId.length > 0) {
      seenMessageIds.add(messageId);
    }
    const requestId = entry.message.clientRequestId?.trim();
    if (entry.message.role === 'assistant' && requestId && seenAssistantRequestIds.has(requestId)) {
      continue;
    }
    if (entry.message.role === 'assistant' && requestId) {
      seenAssistantRequestIds.add(requestId);
    }
    const lastGroup = groups[groups.length - 1];
    const lastEntry = lastGroup?.entries[lastGroup.entries.length - 1];
    const sameRole = lastEntry && lastEntry.message.role === entry.message.role;
    const sameIdentity = (lastEntry?.groupIdentityKey ?? null) === (entry.groupIdentityKey ?? null);
    if (sameRole && sameIdentity) {
      lastGroup.entries.push(entry);
      continue;
    }
    groups.push({ entries: [entry], key: entry.message.id, role: entry.message.role });
  }
  return groups;
}
