import { afterEach, describe, expect, it, vi } from 'vitest';
import { getFeishuGroupMessages, type FeishuAuthContext } from '../../channels/feishu-messaging.js';

const OriginalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = OriginalFetch;
  vi.restoreAllMocks();
});

const auth: FeishuAuthContext = {
  getToken: () => Promise.resolve('tenant-token'),
};

/** 让消息列表接口返回给定的一组 `body.content` 原始字符串。 */
function mockMessageList(contents: readonly string[]): void {
  const items = contents.map((content, index) => ({
    message_id: `om-${index + 1}`,
    sender: { id: 'ou_1', name: 'Alice' },
    body: { content },
    create_time: '1700000000000',
  }));
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(JSON.stringify({ data: { items } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )) as typeof fetch;
}

describe('getFeishuGroupMessages 文本解析', () => {
  it('文本消息的 JSON content 解析为纯文本', async () => {
    mockMessageList(['{"text":"hello"}']);

    const messages = await getFeishuGroupMessages(auth, 'chat-1');
    expect(messages).toHaveLength(1);
    expect(messages[0]?.content).toBe('hello');
  });

  it('非 JSON 字符串原样返回', async () => {
    mockMessageList(['plain text']);

    const messages = await getFeishuGroupMessages(auth, 'chat-1');
    expect(messages[0]?.content).toBe('plain text');
  });

  it('无 text 字段的 JSON content（如图片消息）原样返回', async () => {
    mockMessageList(['{"image_key":"x"}']);

    const messages = await getFeishuGroupMessages(auth, 'chat-1');
    expect(messages[0]?.content).toBe('{"image_key":"x"}');
  });

  it('post 富文本 content 原样返回而不丢信息', async () => {
    const postContent = '{"title":"t","content":[[{"tag":"text","text":"hi"}]]}';
    mockMessageList([postContent]);

    const messages = await getFeishuGroupMessages(auth, 'chat-1');
    expect(messages[0]?.content).toBe(postContent);
  });

  it('text 为空字符串时原样返回 JSON 字符串', async () => {
    mockMessageList(['{"text":""}']);

    const messages = await getFeishuGroupMessages(auth, 'chat-1');
    expect(messages[0]?.content).toBe('{"text":""}');
  });
});
