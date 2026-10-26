import { describe, expect, it } from 'vitest';
import type { UnifiedMessage } from '../../message/message-to-model-messages.js';
import { unifiedConversationToNativeMessages } from '../../v2-runtime/upstream/native-message-bridge.js';

const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB';

function userWithImage(image: { imageUrl?: string; mimeType?: string }): UnifiedMessage[] {
  return [{ role: 'user', content: '看看这张图', images: [image] }];
}

describe('unifiedConversationToNativeMessages：图片媒体来源', () => {
  it('内联 data URL 原样保留为 media part', () => {
    const dataUrl = `data:image/png;base64,${PNG_BASE64}`;
    const native = unifiedConversationToNativeMessages(
      userWithImage({ imageUrl: dataUrl, mimeType: 'image/png' }),
    );

    expect(native[0]?.content).toEqual([
      { type: 'text', text: '看看这张图' },
      { type: 'media', mediaType: 'image/png', data: dataUrl },
    ]);
  });

  it('裸 base64 仍作为 media 下发', () => {
    const native = unifiedConversationToNativeMessages(
      userWithImage({ imageUrl: PNG_BASE64, mimeType: 'image/png' }),
    );

    expect(native[0]?.content).toEqual([
      { type: 'text', text: '看看这张图' },
      { type: 'media', mediaType: 'image/png', data: PNG_BASE64 },
    ]);
  });

  // 回归（2026-10-22 排障包）：渠道入站的远程图片地址曾被直接塞进 media.data，
  // 多模态协议层按 base64 校验后拒绝整个请求（OpenAI Chat media must contain
  // valid base64）。远程地址必须被跳过，退化为「本轮看不到这张图」。
  it('远程 https 图片地址被跳过，不伪造 media part', () => {
    const native = unifiedConversationToNativeMessages(
      userWithImage({
        imageUrl: 'https://qyapi.weixin.qq.com/cgi-bin/media/get?media_id=abc',
        mimeType: 'image/jpeg',
      }),
    );

    expect(native[0]?.content).toEqual([{ type: 'text', text: '看看这张图' }]);
  });

  it('blob 等非内联 scheme 同样被跳过', () => {
    const native = unifiedConversationToNativeMessages(
      userWithImage({ imageUrl: 'blob:https://example.com/123', mimeType: 'image/png' }),
    );

    expect(native[0]?.content).toEqual([{ type: 'text', text: '看看这张图' }]);
  });

  it('文本编码的 data URL（如 svg）被跳过', () => {
    const native = unifiedConversationToNativeMessages(
      userWithImage({
        imageUrl: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',
        mimeType: 'image/svg+xml',
      }),
    );

    expect(native[0]?.content).toEqual([{ type: 'text', text: '看看这张图' }]);
  });

  it('工具返回的绝对 / 相对路径不会被当成裸 base64', () => {
    for (const path of ['/abs/shot.png', './shot.png', 'images/shot.png']) {
      const native = unifiedConversationToNativeMessages(
        userWithImage({ imageUrl: path, mimeType: 'image/png' }),
      );
      expect(native[0]?.content).toEqual([{ type: 'text', text: '看看这张图' }]);
    }
  });

  it('只有被跳过的图片时不会产出空 content 数组', () => {
    const native = unifiedConversationToNativeMessages([
      { role: 'user', content: '', images: [{ imageUrl: 'https://example.com/a.png' }] },
    ]);

    expect(native[0]?.content).toEqual([{ type: 'text', text: '' }]);
  });
});
