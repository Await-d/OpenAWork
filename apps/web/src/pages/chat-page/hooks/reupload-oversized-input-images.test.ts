import type { InputImageContent } from '@openAwork/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_GATEWAY_IMAGE_URL_CHARS } from '../../../hooks/gateway/sanitize-input-image-parts.js';
import { reuploadOversizedInlineImages } from './reupload-oversized-input-images.js';

interface UploadChatAttachmentsMockOptions {
  files: File[];
  gatewayUrl: string;
  sessionId: string;
  token: string | null;
}

const uploadChatAttachments =
  vi.fn<(options: UploadChatAttachmentsMockOptions) => Promise<unknown[]>>();

vi.mock('../../../components/conversation-runtime/attachments/attachment-upload.js', () => ({
  uploadChatAttachments: (options: UploadChatAttachmentsMockOptions) =>
    uploadChatAttachments(options),
}));

function buildOversizedImageUrl(): string {
  return `data:image/png;base64,${'A'.repeat(MAX_GATEWAY_IMAGE_URL_CHARS)}`;
}

beforeEach(() => {
  uploadChatAttachments.mockReset();
});

describe('reuploadOversizedInlineImages', () => {
  it('超长 imageUrl 上传成功后替换为新的 artifactId，且不携带 imageUrl 并保留 detail', async () => {
    uploadChatAttachments.mockResolvedValue([
      {
        artifactId: 'new-art',
        dataUrl: 'data:image/png;base64,AAAA',
        fileName: 'a.png',
        mimeType: 'image/png',
        type: 'image',
      },
    ]);
    const part: InputImageContent = {
      type: 'input_image',
      artifactId: 'old-art',
      detail: 'high',
      fileName: 'a.png',
      imageUrl: buildOversizedImageUrl(),
      mimeType: 'image/png',
    };

    const result = await reuploadOversizedInlineImages({
      gatewayUrl: 'https://gw.test',
      inputParts: [part],
      sessionId: 'branch-1',
      token: 'tok',
    });

    expect(result).toEqual([
      {
        type: 'input_image',
        artifactId: 'new-art',
        detail: 'high',
        fileName: 'a.png',
        mimeType: 'image/png',
      },
    ]);
    expect(result[0]).not.toHaveProperty('imageUrl');
    expect(uploadChatAttachments).toHaveBeenCalledTimes(1);
    expect(uploadChatAttachments).toHaveBeenCalledWith(
      expect.objectContaining({
        gatewayUrl: 'https://gw.test',
        sessionId: 'branch-1',
        token: 'tok',
        files: [expect.any(File)],
      }),
    );
    const [call] = uploadChatAttachments.mock.calls;
    expect(call?.[0].files[0]?.name).toBe('a.png');
    expect(call?.[0].files[0]?.type).toBe('image/png');
  });

  it('未超长的 imageUrl 保持同一引用且不触发上传', async () => {
    const part: InputImageContent = {
      type: 'input_image',
      artifactId: 'a1',
      imageUrl: 'data:image/png;base64,AAAA',
    };

    const result = await reuploadOversizedInlineImages({
      gatewayUrl: 'https://gw.test',
      inputParts: [part],
      sessionId: 'branch-1',
      token: 'tok',
    });

    expect(result[0]).toBe(part);
    expect(uploadChatAttachments).not.toHaveBeenCalled();
  });

  it('没有 imageUrl 的 part 保持同一引用且不触发上传', async () => {
    const part: InputImageContent = { type: 'input_image', artifactId: 'a1' };

    const result = await reuploadOversizedInlineImages({
      gatewayUrl: 'https://gw.test',
      inputParts: [part],
      sessionId: 'branch-1',
      token: 'tok',
    });

    expect(result[0]).toBe(part);
    expect(uploadChatAttachments).not.toHaveBeenCalled();
  });

  it('上传失败时返回原始 part（含超长 imageUrl）', async () => {
    uploadChatAttachments.mockResolvedValue([]);
    const part: InputImageContent = {
      type: 'input_image',
      artifactId: 'old-art',
      imageUrl: buildOversizedImageUrl(),
    };

    const result = await reuploadOversizedInlineImages({
      gatewayUrl: 'https://gw.test',
      inputParts: [part],
      sessionId: 'branch-1',
      token: 'tok',
    });

    expect(result[0]).toBe(part);
    expect(result[0]?.imageUrl).toBe(part.imageUrl);
  });

  it('非 base64 的 Data URL 即使超长也原样返回且不触发上传', async () => {
    const part: InputImageContent = {
      type: 'input_image',
      artifactId: 'old-art',
      imageUrl: `data:image/svg+xml,${'a'.repeat(MAX_GATEWAY_IMAGE_URL_CHARS)}`,
    };

    const result = await reuploadOversizedInlineImages({
      gatewayUrl: 'https://gw.test',
      inputParts: [part],
      sessionId: 'branch-1',
      token: 'tok',
    });

    expect(result[0]).toBe(part);
    expect(uploadChatAttachments).not.toHaveBeenCalled();
  });
});
