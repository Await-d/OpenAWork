import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChannelMessage } from '../../channels/types.js';

// channelFetch 是 wecom-media 唯一的网络出口：mock 掉它即可在无网络条件下
// 覆盖下载成功 / 各类降级分支。
const channelFetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
vi.mock('../../channels/channel-http.js', () => ({
  channelFetch: (url: string, init?: RequestInit): Promise<Response> => channelFetchMock(url, init),
}));

const { attachWeComInboundImages, parseFetchableRemoteUrl, WECOM_INBOUND_IMAGE_MAX_BYTES } =
  await import('../../channels/wecom-media.js');

const PIC_URL = 'https://wework.qpic.cn/media/pic-1.jpg';

/** PNG 魔数（12 字节，满足 sniffImageMediaType 的最小长度要求）。 */
const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);

function imageMessage(picUrl: string): ChannelMessage {
  return {
    id: 'm-wecom-image',
    senderId: 'wecom-user',
    senderName: 'wecom-user',
    chatId: 'wecom-user',
    content: '[User sent an image]',
    timestamp: 0,
    images: [{ imageUrl: picUrl, mediaType: 'image/jpeg' }],
    raw: { MsgType: 'image', PicUrl: picUrl },
  };
}

function binaryResponse(bytes: Buffer, status = 200, headers: Record<string, string> = {}) {
  return new Response(new Uint8Array(bytes), { status, headers });
}

describe('attachWeComInboundImages', () => {
  beforeEach(() => {
    channelFetchMock.mockReset();
  });

  it('远程 PicUrl 下载成功 → 替换为 base64 附件（mime 以魔数为准）', async () => {
    channelFetchMock.mockResolvedValueOnce(binaryResponse(PNG_BYTES));

    const message = imageMessage(PIC_URL);
    const enriched = await attachWeComInboundImages(message);

    expect(enriched).not.toBe(message);
    expect(enriched).toEqual({
      ...message,
      images: [{ base64: PNG_BYTES.toString('base64'), mediaType: 'image/png' }],
    });
    expect(channelFetchMock).toHaveBeenCalledTimes(1);
    expect(channelFetchMock.mock.calls[0]?.[0]).toBe(PIC_URL);
  });

  it('已 enrich 过的消息再次 enrich 时原样返回，不重复下载', async () => {
    channelFetchMock.mockResolvedValueOnce(binaryResponse(PNG_BYTES));
    const enriched = await attachWeComInboundImages(imageMessage(PIC_URL));
    channelFetchMock.mockReset();

    const again = await attachWeComInboundImages(enriched);

    expect(again).toBe(enriched);
    expect(channelFetchMock).not.toHaveBeenCalled();
  });

  it('无远程图片的消息原样返回同一对象，零网络请求', async () => {
    const message: ChannelMessage = {
      id: 'm-wecom-text',
      senderId: 'wecom-user',
      senderName: 'wecom-user',
      chatId: 'wecom-user',
      content: '你好',
      timestamp: 0,
      raw: { MsgType: 'text', Content: '你好' },
    };

    const enriched = await attachWeComInboundImages(message);

    expect(enriched).toBe(message);
    expect(channelFetchMock).not.toHaveBeenCalled();
  });

  // 关键回归：下载失败时不能把远程地址留在 images 里，否则历史回放会再次把
  // 非 base64 值塞进上游 media part（2026-10-22 排障包）。
  it('下载失败时移除远程地址，保留占位符正文', async () => {
    channelFetchMock.mockResolvedValueOnce(binaryResponse(Buffer.from(''), 500));

    const message = imageMessage(PIC_URL);
    const enriched = await attachWeComInboundImages(message);

    expect(enriched).not.toHaveProperty('images');
    expect(enriched.content).toBe('[User sent an image]');
  });

  it('私网 / 回环地址零请求短路，同样移除远程地址', async () => {
    const message = imageMessage('http://127.0.0.1:8080/internal.png');
    const enriched = await attachWeComInboundImages(message);

    expect(channelFetchMock).not.toHaveBeenCalled();
    expect(enriched).not.toHaveProperty('images');
  });

  it('声明长度超过上限时零读取短路，并移除远程地址', async () => {
    channelFetchMock.mockResolvedValueOnce(
      binaryResponse(PNG_BYTES, 200, {
        'content-length': String(WECOM_INBOUND_IMAGE_MAX_BYTES + 1),
      }),
    );

    const message = imageMessage(PIC_URL);
    const enriched = await attachWeComInboundImages(message);

    expect(enriched).not.toHaveProperty('images');
  });
});

describe('parseFetchableRemoteUrl', () => {
  it('放行公网 https 地址', () => {
    expect(parseFetchableRemoteUrl(PIC_URL)).toBe(PIC_URL);
  });

  it('带签名参数的地址原样返回（不做 URL 规范化重编码）', () => {
    const signed = `${PIC_URL}?sign=abc%2Bdef%3D&t=1788000000`;
    expect(parseFetchableRemoteUrl(signed)).toBe(signed);
  });

  it('拒绝 localhost / 私网 / 非 http(s) scheme', () => {
    expect(parseFetchableRemoteUrl('http://localhost/a.png')).toBeUndefined();
    expect(parseFetchableRemoteUrl('http://127.0.0.1/a.png')).toBeUndefined();
    expect(parseFetchableRemoteUrl('http://10.1.2.3/a.png')).toBeUndefined();
    expect(parseFetchableRemoteUrl('http://192.168.1.5/a.png')).toBeUndefined();
    expect(parseFetchableRemoteUrl('http://172.20.0.2/a.png')).toBeUndefined();
    expect(parseFetchableRemoteUrl('http://169.254.169.254/latest/meta-data')).toBeUndefined();
    expect(parseFetchableRemoteUrl('file:///etc/passwd')).toBeUndefined();
    expect(parseFetchableRemoteUrl('data:image/png;base64,AAAA')).toBeUndefined();
  });

  it('拒绝 IPv6 回环 / 唯一本地 / 链路本地，放行公网 IPv6', () => {
    expect(parseFetchableRemoteUrl('http://[::1]/a.png')).toBeUndefined();
    expect(parseFetchableRemoteUrl('http://[fd00::1]/a.png')).toBeUndefined();
    expect(parseFetchableRemoteUrl('http://[fe80::1]/a.png')).toBeUndefined();
    expect(parseFetchableRemoteUrl('http://[2001:db8::1]/a.png')).toBe(
      'http://[2001:db8::1]/a.png',
    );
  });

  // 回归：IPv6 前缀判定曾直接匹配 hostname 字符串，`fc2.com` 这类正常域名
  // 会被当成 fc00::/7 而误杀。
  it('以 fc / fd / fe8 开头的普通域名不被误判', () => {
    expect(parseFetchableRemoteUrl('https://fc2.com/a.png')).toBe('https://fc2.com/a.png');
    expect(parseFetchableRemoteUrl('https://fd.example.com/a.png')).toBe(
      'https://fd.example.com/a.png',
    );
  });
});
