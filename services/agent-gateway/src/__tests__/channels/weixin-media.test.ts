import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WeixinApi } from '../../channels/weixin-api.js';

describe('Weixin media API', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('通过 iLink getuploadurl 与 CDN 加密上传发送图片', async () => {
    const imageBuffer = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    ]);
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url.endsWith('/ilink/bot/getuploadurl')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              ret: 0,
              upload_param: 'upload-param-1',
            }),
          ),
        );
      }
      if (url.startsWith('https://novac2c.cdn.weixin.qq.com/c2c/upload')) {
        return Promise.resolve(
          new Response('', {
            status: 200,
            headers: { 'x-encrypted-param': 'download-param-1' },
          }),
        );
      }
      if (url.endsWith('/ilink/bot/sendmessage')) {
        return Promise.resolve(new Response(JSON.stringify({ ret: 0 })));
      }
      return Promise.reject(new Error(`Unexpected URL: ${url} ${String(init?.method ?? 'GET')}`));
    });
    vi.stubGlobal('fetch', fetchMock);
    const api = new WeixinApi({
      baseUrl: 'https://weixin.example',
      token: 'token-1',
    });

    const result = await api.sendImage({
      toUserId: 'weixin-user',
      contextToken: 'ctx-1',
      buffer: imageBuffer,
      text: '图片说明',
    });

    expect(result.messageId).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const uploadUrlBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(uploadUrlBody).toMatchObject({
      media_type: 1,
      to_user_id: 'weixin-user',
      rawsize: imageBuffer.length,
      rawfilemd5: createHash('md5').update(imageBuffer).digest('hex'),
      no_need_thumb: true,
    });
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('/upload?encrypted_query_param=');
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toMatchObject({
      'Content-Type': 'application/octet-stream',
    });
    const textBody = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body));
    expect(textBody).toMatchObject({
      msg: {
        to_user_id: 'weixin-user',
        context_token: 'ctx-1',
        item_list: [{ type: 1, text_item: { text: '图片说明' } }],
      },
    });
    const imageBody = JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body));
    expect(imageBody).toMatchObject({
      msg: {
        to_user_id: 'weixin-user',
        context_token: 'ctx-1',
        item_list: [
          {
            type: 2,
            image_item: {
              media: {
                encrypt_query_param: 'download-param-1',
                encrypt_type: 1,
              },
            },
          },
        ],
      },
    });
    expect(
      readNestedString(imageBody, ['msg', 'item_list', '0', 'image_item', 'media', 'aes_key']),
    ).toBeTruthy();
  });
});

function readNestedString(value: unknown, path: readonly string[]): string {
  let current = value;
  for (const key of path) {
    if (typeof current !== 'object' || current === null) {
      return '';
    }
    if (Array.isArray(current)) {
      const index = Number(key);
      current = Number.isInteger(index) ? current[index] : undefined;
      continue;
    }
    if (!isRecord(current)) {
      return '';
    }
    current = current[key];
  }
  return typeof current === 'string' ? current : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
