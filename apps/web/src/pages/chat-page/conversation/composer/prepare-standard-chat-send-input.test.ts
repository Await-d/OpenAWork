import { describe, expect, it, vi } from 'vitest';
import { prepareStandardChatSendInput } from './prepare-standard-chat-send-input.js';

const uploadChatAttachments = vi.fn<(...args: unknown[]) => Promise<unknown[]>>();

vi.mock('../../../../components/conversation-runtime/attachments/attachment-upload.js', () => ({
  appendAttachmentSummary: vi.fn((text: string, lines: string[]) =>
    lines.length > 0 ? `${text}\n${lines.join('\n')}` : text,
  ),
  buildUploadedAttachmentSummaryLine: vi.fn(
    (attachment: { fileName?: string }) => `附件:${attachment.fileName ?? 'unknown'}`,
  ),
  uploadChatAttachments: (...args: unknown[]) => uploadChatAttachments(...args),
}));

describe('prepareStandardChatSendInput', () => {
  it('无文件时直接回退到 existingInputParts', async () => {
    const inputParts = [{ type: 'input_image', artifactId: 'a1' }] as const;
    const result = await prepareStandardChatSendInput({
      existingInputParts: [...inputParts],
      files: [],
      gatewayUrl: 'https://gw.test',
      sessionId: 's1',
      text: 'hello',
      token: 'tok',
    });

    expect(result).toEqual({
      requestInputParts: [...inputParts],
      localRequestInputParts: [...inputParts],
      text: 'hello',
    });
  });

  it('有文件时会拆出图片输入并把非图片附件摘要追加到文本', async () => {
    uploadChatAttachments.mockResolvedValue([
      {
        type: 'image',
        artifactId: 'img-1',
        dataUrl: 'data:image/png;base64,abc',
        fileName: 'a.png',
        mimeType: 'image/png',
      },
      {
        type: 'file',
        artifactId: 'file-1',
        fileName: 'doc.txt',
        mimeType: 'text/plain',
      },
    ]);

    const result = await prepareStandardChatSendInput({
      files: [{} as File],
      gatewayUrl: 'https://gw.test',
      sessionId: 's1',
      text: 'hello',
      token: 'tok',
    });

    expect(result).toEqual({
      requestInputParts: [
        {
          type: 'input_image',
          artifactId: 'img-1',
          fileName: 'a.png',
          mimeType: 'image/png',
        },
      ],
      localRequestInputParts: [
        {
          type: 'input_image',
          artifactId: 'img-1',
          imageUrl: 'data:image/png;base64,abc',
          fileName: 'a.png',
          mimeType: 'image/png',
        },
      ],
      text: 'hello\n附件:doc.txt',
    });
  });
});
