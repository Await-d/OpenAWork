import type { SubagentNotice } from '@openAwork/shared';
import type {
  ChatRenderGroup,
  ChatRenderNoticeGroup,
} from '../../chat/message/chat-message-group-list.js';

/**
 * 子代理通知 → 渲染群组。
 *
 * 通知**不进入 `ChatMessage[]`**：`ChatMessage.role` 只有 user/assistant 两值，
 * 且全仓有近百处 role 分支，把通知塞进消息层会触发静默错位。
 * 这里改为扩展**群组**协议（判别联合，`kind` 必填），把影响面收窄到渲染层消费者。
 */
export function buildSubagentNoticeGroups(notices: SubagentNotice[]): ChatRenderNoticeGroup[] {
  return notices.map((notice) => ({
    kind: 'subagent-notice',
    key: `subagent-notice:${notice.id}`,
    createdAt: notice.createdAt,
    notice,
  }));
}

function toTimestamp(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function readGroupTimestamp(group: ChatRenderGroup): number | null {
  if (group.kind === 'subagent-notice') {
    return group.createdAt;
  }
  return toTimestamp(group.entries[0]?.message.createdAt);
}

/**
 * 把通知群组按**时间位置**并入消息群组序列——对齐 opencode 把 notice
 * 作为时间线行渲染的语义（而不是集中堆在末尾）。
 *
 * 规则：稳定按 `createdAt` 升序；同一时间戳时**通知排在消息之后**
 * （通知是消息执行的结果）。时间戳不可知的消息组不阻塞插入。
 */
export function mergeNoticeGroupsIntoRenderGroups(input: {
  messageGroups: ChatRenderGroup[];
  noticeGroups: ChatRenderNoticeGroup[];
}): ChatRenderGroup[] {
  if (input.noticeGroups.length === 0) {
    return input.messageGroups;
  }

  const sortedNotices = [...input.noticeGroups].sort((left, right) => {
    if (left.createdAt !== right.createdAt) {
      return left.createdAt - right.createdAt;
    }
    return left.key.localeCompare(right.key);
  });

  const merged: ChatRenderGroup[] = [];
  let noticeIndex = 0;

  for (const group of input.messageGroups) {
    const groupTimestamp = readGroupTimestamp(group);
    if (groupTimestamp !== null) {
      while (noticeIndex < sortedNotices.length) {
        const notice = sortedNotices[noticeIndex];
        // 严格早于该消息组的通知排在它前面；**同时间戳**的通知留给本组之后
        // （通知是消息执行的结果，视觉上应跟随其后）。
        if (!notice || notice.createdAt >= groupTimestamp) {
          break;
        }
        merged.push(notice);
        noticeIndex += 1;
      }
    }
    merged.push(group);
  }

  for (; noticeIndex < sortedNotices.length; noticeIndex += 1) {
    const notice = sortedNotices[noticeIndex];
    if (notice) {
      merged.push(notice);
    }
  }

  return merged;
}
