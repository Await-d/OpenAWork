import type {
  ChannelGroup,
  ChannelMessage,
  ChannelStreamingHandle,
  FeishuChatMembersResult,
  FeishuMemberIdType,
  FeishuUrgentType,
} from './types.js';
import { channelFetch } from './channel-http.js';
import { buildTextCard, FEISHU_API, parseFeishuMessageId } from './feishu-api-types.js';
import {
  feishuCardUpdateResponseSchema,
  feishuCodeOnlySchema,
  feishuGroupListSchema,
  feishuMembersSchema,
  feishuMessageListSchema,
  feishuMessageResponseSchema,
} from './feishu-response-schemas.js';

export interface FeishuAuthContext {
  readonly getToken: () => Promise<string>;
}

export async function sendFeishuTextMessage(
  auth: FeishuAuthContext,
  chatId: string,
  content: string,
): Promise<{ messageId: string }> {
  return sendFeishuMessage(auth, {
    receiveId: chatId,
    msgType: 'text',
    content: JSON.stringify({ text: content }),
  });
}

export async function replyFeishuTextMessage(
  auth: FeishuAuthContext,
  messageId: string,
  content: string,
): Promise<{ messageId: string }> {
  const token = await auth.getToken();
  const resp = await channelFetch(`${FEISHU_API}/im/v1/messages/${messageId}/reply`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      msg_type: 'text',
      content: JSON.stringify({ text: content }),
    }),
  });
  const data = feishuMessageResponseSchema.parse(await resp.json());
  return { messageId: parseFeishuMessageId(resp, data) };
}

export async function sendFeishuMessage(
  auth: FeishuAuthContext,
  input: {
    readonly receiveId: string;
    readonly msgType: string;
    readonly content: string;
    readonly signal?: AbortSignal;
  },
): Promise<{ messageId: string }> {
  const token = await auth.getToken();
  const resp = await channelFetch(`${FEISHU_API}/im/v1/messages?receive_id_type=chat_id`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      receive_id: input.receiveId,
      msg_type: input.msgType,
      content: input.content,
    }),
    signal: input.signal,
  });
  const data = feishuMessageResponseSchema.parse(await resp.json());
  return { messageId: parseFeishuMessageId(resp, data) };
}

export async function sendFeishuStreamingMessage(
  auth: FeishuAuthContext,
  input: {
    readonly chatId: string;
    readonly initialContent: string;
    readonly replyToMessageId?: string;
  },
): Promise<ChannelStreamingHandle> {
  const token = await auth.getToken();
  const sendUrl = input.replyToMessageId
    ? `${FEISHU_API}/im/v1/messages/${encodeURIComponent(input.replyToMessageId)}/reply`
    : `${FEISHU_API}/im/v1/messages?receive_id_type=chat_id`;
  const body = input.replyToMessageId
    ? { msg_type: 'interactive', content: buildTextCard(input.initialContent) }
    : {
        receive_id: input.chatId,
        msg_type: 'interactive',
        content: buildTextCard(input.initialContent),
      };
  const resp = await channelFetch(sendUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = feishuMessageResponseSchema.parse(await resp.json());
  const messageId = parseFeishuMessageId(resp, data);

  const updateCard = async (content: string): Promise<void> => {
    const t = await auth.getToken();
    const r = await channelFetch(`${FEISHU_API}/im/v1/messages/${messageId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ msg_type: 'interactive', content: buildTextCard(content) }),
    });
    const result = feishuCardUpdateResponseSchema.parse(await r.json());
    if (result.code !== 0) {
      throw new Error(`Feishu card update failed: ${result.code}`);
    }
  };

  return { update: updateCard, finish: updateCard };
}

export async function getFeishuGroupMessages(
  auth: FeishuAuthContext,
  chatId: string,
  count = 20,
): Promise<ChannelMessage[]> {
  const token = await auth.getToken();
  const resp = await channelFetch(
    `${FEISHU_API}/im/v1/messages?container_id_type=chat&container_id=${chatId}&page_size=${count}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const data = feishuMessageListSchema.parse(await resp.json());
  return (data.data?.items ?? []).map((item) => ({
    id: item.message_id,
    senderId: item.sender?.id ?? 'unknown',
    senderName: item.sender?.name ?? item.sender?.id ?? 'unknown',
    chatId,
    content: item.body?.content ?? '',
    timestamp: Number(item.create_time) || Date.now(),
    raw: item,
  }));
}

export async function listFeishuGroups(auth: FeishuAuthContext): Promise<ChannelGroup[]> {
  const token = await auth.getToken();
  const resp = await channelFetch(`${FEISHU_API}/im/v1/chats`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = feishuGroupListSchema.parse(await resp.json());
  return (data.data?.items ?? []).map((group) => ({
    id: group.chat_id,
    name: group.name,
    memberCount: group.member_count,
  }));
}

export async function listFeishuChatMembers(
  auth: FeishuAuthContext,
  chatId: string,
  input: {
    readonly pageSize?: number;
    readonly pageToken?: string;
    readonly memberIdType?: FeishuMemberIdType;
    readonly signal?: AbortSignal;
  } = {},
): Promise<FeishuChatMembersResult> {
  const token = await auth.getToken();
  const pageSize = Math.min(Math.max(input.pageSize ?? 50, 1), 50);
  const memberIdType = input.memberIdType ?? 'open_id';
  const pageToken = input.pageToken ? `&page_token=${encodeURIComponent(input.pageToken)}` : '';
  const resp = await channelFetch(
    `${FEISHU_API}/im/v1/chats/${encodeURIComponent(
      chatId,
    )}/members?member_id_type=${memberIdType}&page_size=${pageSize}${pageToken}`,
    { headers: { Authorization: `Bearer ${token}` }, signal: input.signal },
  );
  const data = feishuMembersSchema.parse(await resp.json());
  if (data.code !== 0) {
    throw new Error(`Feishu listChatMembers failed: ${data.msg ?? data.code}`);
  }
  return {
    items: data.data?.items ?? [],
    pageToken: data.data?.page_token,
    hasMore: data.data?.has_more,
  };
}

export async function sendFeishuUrgent(
  auth: FeishuAuthContext,
  messageId: string,
  input: {
    readonly userIds: readonly string[];
    readonly urgentTypes: readonly FeishuUrgentType[];
    readonly userIdType?: FeishuMemberIdType;
    readonly signal?: AbortSignal;
  },
): Promise<{ ok: true }> {
  const token = await auth.getToken();
  const userIdType = input.userIdType ?? 'user_id';
  for (const urgentType of input.urgentTypes) {
    const resp = await channelFetch(
      `${FEISHU_API}/im/v1/messages/${encodeURIComponent(
        messageId,
      )}/urgent?user_id_type=${userIdType}`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id_list: input.userIds, urgent_type: urgentType }),
        signal: input.signal,
      },
    );
    const data = feishuCodeOnlySchema.parse(await resp.json());
    if (data.code !== 0) {
      throw new Error(`Feishu sendUrgent failed: ${data.msg ?? data.code}`);
    }
  }
  return { ok: true };
}
