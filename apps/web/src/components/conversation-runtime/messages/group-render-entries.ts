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
 * 流式场景的增量重组见 `reconcileChatRenderGroups` /
 * `appendRenderEntryToMessageGroups`：流式 token 帧只有尾部 entry 变化，
 * 整表重分组会让 `ChatGroupBlock`（React.memo）的全部组对象引用失效，
 * 导致每帧重渲染整个消息列表。
 *
 * 关联文档：
 * - `.agentdocs/workflow/260518-team-conversation-decouple-plan.md` 候选 #1
 */

import type {
  ChatRenderEntry,
  ChatRenderGroup,
} from '../../chat/message/chat-message-group-list.js';

/** 相邻 entry 是否满足并入同一消息组的条件（role + 来源身份一致）。 */
function canJoinEntry(
  lastEntry: ChatRenderEntry | undefined,
  entry: ChatRenderEntry | undefined,
): boolean {
  return (
    lastEntry !== undefined &&
    entry !== undefined &&
    lastEntry.message.role === entry.message.role &&
    (lastEntry.groupIdentityKey ?? null) === (entry.groupIdentityKey ?? null)
  );
}

/** 取一组内最后一条 entry（非消息组返回 undefined）。 */
function readLastEntry(group: ChatRenderGroup | undefined): ChatRenderEntry | undefined {
  return group?.kind === 'messages' ? group.entries[group.entries.length - 1] : undefined;
}

/** 把 entry 并入 groups 尾部：满足相邻规则则追加到最后一组，否则新起一组。 */
function appendEntryToGroups(groups: ChatRenderGroup[], entry: ChatRenderEntry): void {
  const lastGroup = groups[groups.length - 1];
  if (lastGroup?.kind === 'messages' && canJoinEntry(readLastEntry(lastGroup), entry)) {
    lastGroup.entries.push(entry);
    return;
  }
  groups.push({
    kind: 'messages',
    entries: [entry],
    key: entry.message.id,
    role: entry.message.role,
  });
}

/**
 * 分组主体。`seenMessageIds` 可携带前缀已消费的消息 id，供增量重组复用全量
 * 分组的去重语义（重复 id 跳过，保留先出现者）。
 */
function groupChatRenderEntriesSeeded(
  entries: ChatRenderEntry[],
  seenMessageIds: Set<string>,
): ChatRenderGroup[] {
  const groups: ChatRenderGroup[] = [];
  for (const entry of entries) {
    const messageId = entry.message.id.trim();
    if (messageId.length > 0 && seenMessageIds.has(messageId)) {
      continue;
    }
    if (messageId.length > 0) {
      seenMessageIds.add(messageId);
    }
    appendEntryToGroups(groups, entry);
  }
  return groups;
}

export function groupChatRenderEntries(entries: ChatRenderEntry[]): ChatRenderGroup[] {
  return groupChatRenderEntriesSeeded(entries, new Set<string>());
}

/**
 * 把单个新 entry 追加到既有消息组序列尾部（流式占位消息的追加语义）。
 *
 * 只在需要时复制最后一组：未受影响的历史组保持**引用稳定**，这是
 * `ChatGroupBlock` 的 React.memo 能跳过重渲染的前提。
 */
export function appendRenderEntryToMessageGroups(
  groups: ChatRenderGroup[],
  entry: ChatRenderEntry,
): ChatRenderGroup[] {
  const lastGroup = groups[groups.length - 1];
  if (lastGroup?.kind === 'messages' && canJoinEntry(readLastEntry(lastGroup), entry)) {
    return [...groups.slice(0, -1), { ...lastGroup, entries: [...lastGroup.entries, entry] }];
  }
  return [
    ...groups,
    { kind: 'messages', entries: [entry], key: entry.message.id, role: entry.message.role },
  ];
}

export interface ReconcileChatRenderGroupsResult {
  /** 可原样复用的前缀组数量（即 `previousGroups` 的前 N 个引用）。 */
  reusedGroupCount: number;
  /** 重新分组得到的尾部组（引用全新，调用方需对其重新做装饰）。 */
  tailGroups: ChatRenderGroup[];
}

/**
 * 增量重组消息群组：流式期间只有尾部 entry 发生变化，本函数对未变化的前缀直接
 * 复用 `previousGroups` 的组对象引用，把重算范围收缩到首个差异 entry 所在的组。
 *
 * 输入约束：
 * - `previousGroups` 必须是由 `previousEntries` 经本模块分组产出的**消息组**
 *   序列，不得混入通知组；
 * - 调用方须保证 `previousEntries` 与 `previousGroups` 来自同一帧（缓存成对更新）。
 *
 * 去重语义与 `groupChatRenderEntries` 完全一致：前缀已消费的 message id 会作为
 * 种子传给尾部重组，因此返回结果与全量分组逐组等价。
 */
export function reconcileChatRenderGroups(input: {
  previousEntries: ChatRenderEntry[];
  previousGroups: ChatRenderGroup[];
  nextEntries: ChatRenderEntry[];
}): ReconcileChatRenderGroupsResult {
  const { previousEntries, previousGroups, nextEntries } = input;

  // 防御：遭遇非消息组（如通知组被误传）时退回全量分组。
  if (previousGroups.some((group) => group.kind !== 'messages')) {
    return { reusedGroupCount: 0, tailGroups: groupChatRenderEntries(nextEntries) };
  }

  const commonLength = Math.min(previousEntries.length, nextEntries.length);
  let firstDiff = 0;
  while (firstDiff < commonLength && previousEntries[firstDiff] === nextEntries[firstDiff]) {
    firstDiff += 1;
  }
  if (firstDiff === previousEntries.length && firstDiff === nextEntries.length) {
    return { reusedGroupCount: previousGroups.length, tailGroups: [] };
  }

  // 定位首个差异 entry 所在组的起点：该组及之后必须重算。纯追加
  // （firstDiff === previousEntries.length）时锚定最后一组，因为它可能吸收新 entry。
  let reusedGroupCount = 0;
  let reuseStart = 0;
  if (previousGroups.length > 0 && previousEntries.length > 0) {
    const anchor = Math.min(firstDiff, previousEntries.length - 1);
    let offset = 0;
    for (const group of previousGroups) {
      if (group.kind !== 'messages') {
        break;
      }
      if (anchor < offset + group.entries.length) {
        break;
      }
      offset += group.entries.length;
      reusedGroupCount += 1;
    }
    reuseStart = offset;
  }

  const seenMessageIds = new Set<string>();
  for (let index = 0; index < reuseStart; index += 1) {
    const messageId = nextEntries[index]?.message.id.trim() ?? '';
    if (messageId.length > 0) {
      seenMessageIds.add(messageId);
    }
  }
  let tailGroups = groupChatRenderEntriesSeeded(nextEntries.slice(reuseStart), seenMessageIds);

  // 差异可能让尾部新组与复用前缀的最后一组满足相邻合并条件（role / 身份在本帧
  // 发生变化）——补做一次边界合并，保证与全量分组逐组等价。合并组放进尾部，
  // 由调用方重新装饰（避免沿用旧闭包）。
  const reusableLast = previousGroups[reusedGroupCount - 1];
  const tailHead = tailGroups[0];
  if (
    reusableLast?.kind === 'messages' &&
    tailHead?.kind === 'messages' &&
    canJoinEntry(readLastEntry(reusableLast), tailHead.entries[0])
  ) {
    tailGroups = [
      { ...reusableLast, entries: [...reusableLast.entries, ...tailHead.entries] },
      ...tailGroups.slice(1),
    ];
    reusedGroupCount -= 1;
  }

  return { reusedGroupCount, tailGroups };
}
