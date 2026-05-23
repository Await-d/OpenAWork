import { describe, expect, it, vi } from 'vitest';
import { prepareImageGenerationInput } from './prepare-image-generation-input.js';

const uploadChatAttachments = vi.fn<(...args: unknown[]) => Promise<unknown[]>>();

vi.mock('../../../../components/conversation-runtime/attachments/attachment-upload.js', () => ({
  uploadChatAttachments: (...args: unknown[]) => uploadChatAttachments(...args),
}));

describe('prepareImageGenerationInput', () => {
  it('无文件时返回会话参考图映射', async () => {
    const result = await prepareImageGenerationInput({
      files: [],
      gatewayUrl: 'https://gw.test',
      selectedImageEditReferenceArtifact: {
        artifactId: 'art-1',
        fileName: 'ref.png',
        imageUrl: 'https://example.com/ref.png',
        mimeType: 'image/png',
      },
      sessionId: 's1',
      token: 'tok',
    });

    expect(result).toEqual({
      imageEditArtifacts: [{ artifactId: 'art-1', fileName: 'ref.png', mimeType: 'image/png' }],
      localImageInputs: [
        {
          type: 'input_image',
          artifactId: 'art-1',
          imageUrl: 'https://example.com/ref.png',
          fileName: 'ref.png',
          mimeType: 'image/png',
        },
      ],
    });
  });

  it('有文件时返回上传后的图片输入映射', async () => {
    uploadChatAttachments.mockResolvedValue([
      {
        type: 'image',
        artifactId: 'img-1',
        dataUrl: 'data:image/png;base64,abc',
        fileName: 'a.png',
        mimeType: 'image/png',
      },
    ]);

    const result = await prepareImageGenerationInput({
      files: [{} as File],
      gatewayUrl: 'https://gw.test',
      selectedImageEditReferenceArtifact: null,
      sessionId: 's1',
      token: 'tok',
    });

    expect(result).toEqual({
      imageEditArtifacts: [{ artifactId: 'img-1', fileName: 'a.png', mimeType: 'image/png' }],
      localImageInputs: [
        {
          type: 'input_image',
          artifactId: 'img-1',
          imageUrl: 'data:image/png;base64,abc',
          fileName: 'a.png',
          mimeType: 'image/png',
        },
      ],
    });
  });
});
