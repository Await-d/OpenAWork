import type { ChannelGroup, ChannelMessage } from './types.js';

const MAX_MESSAGES_PER_CHAT = 200;
const MAX_CHATS_PER_PLUGIN = 100;

type ChatHistory = {
  readonly chatId: string;
  chatName?: string;
  readonly messages: ChannelMessage[];
};

const histories = new Map<string, Map<string, ChatHistory>>();

export function recordChannelMessage(pluginId: string, message: ChannelMessage): void {
  let pluginHistories = histories.get(pluginId);
  if (!pluginHistories) {
    pluginHistories = new Map();
    histories.set(pluginId, pluginHistories);
  }

  let chatHistory = pluginHistories.get(message.chatId);
  if (!chatHistory) {
    chatHistory = { chatId: message.chatId, messages: [] };
    pluginHistories.set(message.chatId, chatHistory);
    trimOldestChat(pluginHistories);
  }

  if (message.chatName) {
    chatHistory.chatName = message.chatName;
  }
  chatHistory.messages.push(message);
  if (chatHistory.messages.length > MAX_MESSAGES_PER_CHAT) {
    chatHistory.messages.splice(0, chatHistory.messages.length - MAX_MESSAGES_PER_CHAT);
  }
}

export function listRecentChannelMessages(
  pluginId: string,
  chatId: string,
  count = 20,
): ChannelMessage[] {
  const messages = histories.get(pluginId)?.get(chatId)?.messages ?? [];
  return messages.slice(-count);
}

export function listRecentChannelGroups(pluginId: string): ChannelGroup[] {
  return [...(histories.get(pluginId)?.values() ?? [])].map((history) => ({
    id: history.chatId,
    name: history.chatName ?? history.chatId,
  }));
}

export function clearChannelMessageCache(pluginId?: string): void {
  if (pluginId) {
    histories.delete(pluginId);
    return;
  }
  histories.clear();
}

function trimOldestChat(pluginHistories: Map<string, ChatHistory>): void {
  if (pluginHistories.size <= MAX_CHATS_PER_PLUGIN) {
    return;
  }

  const oldest = pluginHistories.keys().next().value;
  if (oldest) {
    pluginHistories.delete(oldest);
  }
}
