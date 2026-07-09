import { channelFetch } from './channel-http.js';
import { FEISHU_API } from './feishu-api-types.js';
import type { FeishuAuthContext } from './feishu-messaging.js';
import { sendFeishuMessage } from './feishu-messaging.js';
import { feishuChatInfoSchema } from './feishu-response-schemas.js';

export async function sendFeishuMention(
  auth: FeishuAuthContext,
  chatId: string,
  input: {
    readonly userIds: readonly string[];
    readonly atAll?: boolean;
    readonly text: string;
    readonly signal?: AbortSignal;
  },
): Promise<{ messageId: string }> {
  await assertFeishuGroupChat(auth, chatId, input.signal);
  const elements = buildMentionElements(input);
  if (elements.length === 0) {
    throw new Error('Feishu mention content is empty.');
  }
  return sendFeishuMessage(auth, {
    receiveId: chatId,
    msgType: 'post',
    content: JSON.stringify({ zh_cn: { content: [elements] } }),
    signal: input.signal,
  });
}

async function assertFeishuGroupChat(
  auth: FeishuAuthContext,
  chatId: string,
  signal?: AbortSignal,
): Promise<void> {
  const token = await auth.getToken();
  const resp = await channelFetch(`${FEISHU_API}/im/v1/chats/${encodeURIComponent(chatId)}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal,
  });
  const data = feishuChatInfoSchema.parse(await resp.json());
  if (data.code !== 0) {
    throw new Error(`Feishu get chat info failed: ${data.msg ?? data.code}`);
  }
  if (data.data?.chat_type !== 'group') {
    throw new Error('FeishuAtMember is only available in group chats.');
  }
}

function buildMentionElements(input: {
  readonly userIds: readonly string[];
  readonly atAll?: boolean;
  readonly text: string;
}): Array<
  { readonly tag: 'at'; readonly user_id: string } | { readonly tag: 'text'; readonly text: string }
> {
  const elements: Array<
    | { readonly tag: 'at'; readonly user_id: string }
    | { readonly tag: 'text'; readonly text: string }
  > = [];
  if (input.atAll) {
    elements.push({ tag: 'at', user_id: 'all' });
  }
  for (const userId of input.userIds.filter((item) => item.trim().length > 0)) {
    elements.push({ tag: 'at', user_id: userId });
  }
  const text = input.text.trim();
  if (text) {
    elements.push({ tag: 'text', text: elements.length > 0 ? ` ${text}` : text });
  }
  return elements;
}
