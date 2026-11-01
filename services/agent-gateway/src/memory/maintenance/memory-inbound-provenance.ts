import type { MemorySourceProvenance } from '@openAwork/agent-core';
import { recordChannelMessageProvenance } from '../governance/memory-provenance-store.js';

/**
 * 入站渠道消息来源冻结（261101-记忆确认写入与周期整理）。
 *
 * 模块边界很窄：把「一条渠道消息是谁、在哪个群/私聊发的」冻结成一个不可变的
 * `MemorySourceProvenance`，并在**消息到达、会话 metadata 写入的同一时刻**落库。
 *
 * 为什么必须在这里冻结、而不是抽取时反推：渠道会话是**复用**的（
 * `upsertChannelSession` 优先挑既有会话），会话 metadata 里的 `channelActor`
 * 会被下一条消息覆盖。等到生成记忆提议时再去读会话最新 metadata，多人交错
 * 的场景下会把 A 的消息记成 B 的来源。冻结后来源与会话状态解耦。
 */

export interface FreezeChannelMessageProvenanceInput {
  /** 会话 id（`upsertChannelSession` 的返回值）。 */
  sessionId: string;
  /** 渠道实例：`id` 必填，`pluginId` 缺省时退回 `id` 作为平台标识。 */
  channel: { id: string; pluginId?: string | null };
  /** 平台内的会话/群标识。 */
  chatId: string;
  /** 显式 chat 类型；不传时按 `inferChatType` 从原始消息判定。 */
  chatType?: 'private' | 'group' | 'unknown';
  /** 平台消息 id；缺失时下游会用 sessionId + 时间戳兜底。 */
  messageId?: string | null;
  /** 发言人信息；缺失时来源里 sender 两列落 null。 */
  actor?: { platformUserId?: string | null; senderName?: string | null } | null;
  /** 原始消息对象，仅在 `chatType` 缺省时用于推断（可选）。 */
  raw?: Record<string, unknown> | null;
  now?: Date;
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/**
 * 推断 chat 类型。
 *
 * 判定不出来**一律返回 `'unknown'`**，而不是 `'private'`：下游（是否把待确认
 * 记忆通知发到渠道）按「只有明确私聊才发」处理，未知按群对待更保守，避免把
 * 私人记忆的存在感暴露到群聊里。
 *
 * 兼容常见平台字段（Telegram / 飞书 / Slack / Discord / 钉钉）的命名差异：
 *   - `chatType` / `chat_type` / `type`：字符串 `private` | `group`；
 *   - `chat.type` 嵌套对象；
 *   - `isGroup` / `is_group`：布尔；
 *   - `group` 对象存在即群；
 *   - `message.chat.type`（Telegram 风格）嵌套。
 */
export function inferChatType(
  raw?: Record<string, unknown> | null,
): 'private' | 'group' | 'unknown' {
  if (!raw || typeof raw !== 'object') {
    return 'unknown';
  }

  const direct = raw['chatType'] ?? raw['chat_type'];
  const normalizedDirect = readNonEmptyString(direct)?.toLowerCase();
  if (normalizedDirect) {
    return normalizeChatType(normalizedDirect);
  }

  const isGroup = raw['isGroup'] ?? raw['is_group'];
  if (typeof isGroup === 'boolean') {
    return isGroup ? 'group' : 'private';
  }

  const chat = raw['chat'];
  if (chat && typeof chat === 'object' && !Array.isArray(chat)) {
    const nested = chat as Record<string, unknown>;
    const nestedType = readNonEmptyString(nested['type'])?.toLowerCase();
    if (nestedType) {
      return normalizeChatType(nestedType);
    }
    if (nested['isGroup'] === true || nested['is_group'] === true) {
      return 'group';
    }
    if (nested['group'] !== undefined && nested['group'] !== null) {
      return 'group';
    }
    if (nested['username'] !== undefined && nested['type'] === undefined) {
      return 'unknown';
    }
  }

  if (raw['group'] !== undefined && raw['group'] !== null) {
    return 'group';
  }

  const messageChat = raw['message'];
  if (messageChat && typeof messageChat === 'object' && !Array.isArray(messageChat)) {
    const messageRecord = messageChat as Record<string, unknown>;
    const messageChatField = messageRecord['chat'];
    if (
      messageChatField &&
      typeof messageChatField === 'object' &&
      !Array.isArray(messageChatField)
    ) {
      const nestedType = readNonEmptyString(
        (messageChatField as Record<string, unknown>)['type'],
      )?.toLowerCase();
      if (nestedType) {
        return normalizeChatType(nestedType);
      }
    }
  }

  return 'unknown';
}

function normalizeChatType(value: string): 'private' | 'group' | 'unknown' {
  switch (value) {
    case 'private':
    case 'p2p':
    case 'single':
    case 'dm':
    case 'direct':
    case 'user':
      return 'private';
    case 'group':
    case 'supergroup':
    case 'channel':
    case 'guild':
    case 'chat':
    case 'room':
      return 'group';
    default:
      return 'unknown';
  }
}

/**
 * 冻结一条入站渠道消息的来源。
 *
 * 返回冻结后的 provenance（供调用方一并写入会话 metadata）；发生了无法继续的
 * 情况（缺 sessionId / chatId）时返回 `null`，调用方应原样跳过。
 *
 * 注意：**不做 try/catch**。来源冻结失败是否阻断渠道消息，由调用方决定——渠道
 * 路径必须 fail-open（不阻断用户消息），维护/抽取路径可以 fail-closed。
 */
export function freezeChannelMessageProvenance(
  input: FreezeChannelMessageProvenanceInput,
): MemorySourceProvenance | null {
  const sessionId = readNonEmptyString(input.sessionId);
  const channelId = readNonEmptyString(input.channel.id);
  const chatId = readNonEmptyString(input.chatId);
  if (!sessionId || !channelId || !chatId) {
    return null;
  }

  const platform = readNonEmptyString(input.channel.pluginId) ?? channelId;
  const chatType = input.chatType ?? inferChatType(input.raw ?? null);
  const provenance: MemorySourceProvenance = {
    platform,
    channelInstanceId: channelId,
    chatId,
    chatType,
    senderId: readNonEmptyString(input.actor?.platformUserId),
    senderName: readNonEmptyString(input.actor?.senderName),
    platformMessageId: readNonEmptyString(input.messageId),
  };

  recordChannelMessageProvenance({
    sessionId,
    provenance,
    now: input.now,
  });
  return provenance;
}
