import type { SubagentNotice } from '@openAwork/shared';
import type {
  ChatRenderEntry,
  ChatRenderGroup,
  ChatRenderMessageGroup,
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

function readEntryTimestamp(entry: ChatRenderEntry | undefined): number | null {
  return entry ? toTimestamp(entry.message.createdAt) : null;
}

function readGroupTimestamp(group: ChatRenderGroup): number | null {
  if (group.kind === 'subagent-notice') {
    return group.createdAt;
  }
  return readEntryTimestamp(group.entries[0]);
}

/**
 * 通知在本组条目中的插入下标。
 *
 * - `0`：早于首条目、或首条目时间戳不可知——**不在组内拆分**，交由调用方的
 *   群组级插入处理（未知时间戳不阻塞插入的既有语义不变）；
 * - `entries.length`：晚于全部条目——排在整组之后；
 * - 其余：落在组内，需要在条目边界处拆组。
 *
 * 同时间戳：通知排在消息之后（与群组级规则一致）。
 */
function resolveNoticeInsertionIndex(entries: ChatRenderEntry[], noticeCreatedAt: number): number {
  let index = 0;
  for (const entry of entries) {
    const entryTimestamp = readEntryTimestamp(entry);
    if (entryTimestamp === null) {
      continue;
    }
    if (noticeCreatedAt < entryTimestamp) {
      break;
    }
    index += 1;
  }
  return index;
}

/**
 * 取一段条目构造消息群组。首段沿用原群组的 key 与 actions（组级「复制完整回答」
 * 等动作仍挂在回答起始处、且闭包复制的仍是整个原群组的内容）；后续段的 key 取其
 * 首条目的消息 id——消息 id 唯一，因此拆分后的各段 key 天然唯一且稳定。
 */
function makeMessageGroupSegment(
  group: ChatRenderMessageGroup,
  entries: ChatRenderEntry[],
  isFirstSegment: boolean,
): ChatRenderMessageGroup {
  if (isFirstSegment) {
    return entries === group.entries ? group : { ...group, entries };
  }
  return {
    kind: 'messages',
    role: group.role,
    key: entries[0]?.message.id ?? group.key,
    entries,
  };
}

/**
 * 把落在本组条目跨度内的通知按条目边界插进去，必要时把组拆成多段。
 *
 * 背景：相邻同角色 assistant 消息（同一次请求的多轮输出、以及子代理唤醒续写的那条）
 * 会被 `groupChatRenderEntries` 合成**一个**视觉组。若只在群组级插入，通知的
 * 时间戳落在组内时会被整体推到组后——「scout 已完成」因此总是出现在已经用上其结果的
 * 回复之后，与 DB 顺序（A1 → notice → A2）和上游 notice 时间线语义相反。
 *
 * 返回下一个待处理通知的下标。
 */
function emitMessageGroupWithNotices(
  group: ChatRenderMessageGroup,
  notices: ChatRenderNoticeGroup[],
  startIndex: number,
  merged: ChatRenderGroup[],
): number {
  if (group.entries.length === 0) {
    merged.push(group);
    return startIndex;
  }

  let index = startIndex;
  let remainingEntries = group.entries;
  let emittedSegment = false;

  while (index < notices.length) {
    const notice = notices[index];
    if (!notice) {
      break;
    }

    const insertionIndex = resolveNoticeInsertionIndex(remainingEntries, notice.createdAt);
    if (insertionIndex <= 0) {
      // 首段之前无法判定插入点（首条目时间戳不可知）时保持整组不动，交给后续
      // 群组边界处理；已拆过组后则说明通知就落在剩余片段之前，直接插在它前面。
      if (!emittedSegment) {
        break;
      }
      merged.push(notice);
      index += 1;
      continue;
    }
    if (insertionIndex >= remainingEntries.length) {
      break;
    }

    merged.push(
      makeMessageGroupSegment(group, remainingEntries.slice(0, insertionIndex), !emittedSegment),
    );
    merged.push(notice);
    remainingEntries = remainingEntries.slice(insertionIndex);
    emittedSegment = true;
    index += 1;
  }

  merged.push(makeMessageGroupSegment(group, remainingEntries, !emittedSegment));
  return index;
}

/**
 * 把通知群组按**时间位置**并入消息群组序列——对齐 opencode 把 notice
 * 作为时间线行渲染的语义（而不是集中堆在末尾）。
 *
 * 规则：稳定按 `createdAt` 升序；同一时间戳时**通知排在消息之后**
 * （通知是消息执行的结果）。时间戳不可知的消息组不阻塞插入。
 * 通知落在某消息组的**条目跨度内**时，该组按条目边界拆开，通知插在中间
 * （见 `emitMessageGroupWithNotices`）。
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

    if (group.kind === 'subagent-notice') {
      merged.push(group);
      continue;
    }

    noticeIndex = emitMessageGroupWithNotices(group, sortedNotices, noticeIndex, merged);
  }

  for (; noticeIndex < sortedNotices.length; noticeIndex += 1) {
    const notice = sortedNotices[noticeIndex];
    if (notice) {
      merged.push(notice);
    }
  }

  return merged;
}
