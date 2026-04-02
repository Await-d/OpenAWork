// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import {
  appendAttachmentSummary,
  buildAttachmentSummary,
  encodeBytesToBase64,
  fileToBase64,
  uploadChatAttachments,
} from './attachment-upload.js';

describe('attachment upload helpers', () => {
  it('encodes file bytes to base64', async () => {
    const file = new File(['hello'], 'greeting.txt', { type: 'text/plain' });

    expect(encodeBytesToBase64(new Uint8Array([104, 101, 108, 108, 111]))).toBe('aGVsbG8=');
    await expect(fileToBase64(file)).resolves.toBe('aGVsbG8=');
  });

  it('appends attachment summaries after the message text', () => {
    const lines = ['- 截图.png (artifact:artifact-1)'];

    expect(buildAttachmentSummary(lines)).toBe('[附件]\n- 截图.png (artifact:artifact-1)');
    expect(appendAttachmentSummary('请帮我看下这个问题', lines)).toBe(
      '请帮我看下这个问题\n\n[附件]\n- 截图.png (artifact:artifact-1)',
    );
    expect(appendAttachmentSummary('', lines)).toBe('[附件]\n- 截图.png (artifact:artifact-1)');
  });

  it('uploads attachments and returns artifact summary lines', async () => {
    const fetchMock: typeof fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            artifact: {
              id: 'artifact-1',
              name: '截图.png',
            },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
    );

    const result = await uploadChatAttachments({
      files: [new File(['image-bytes'], '截图.png', { type: 'image/png' })],
      gatewayUrl: 'http://localhost:3000',
      sessionId: 'session-1',
      token: 'token-123',
      fetchImpl: fetchMock,
    });

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3000/sessions/session-1/artifacts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token-123',
      },
      body: expect.any(String),
    });
    expect(result).toEqual(['- 截图.png (artifact:artifact-1)']);
  });

  it('falls back to failure summaries when upload cannot proceed', async () => {
    const file = new File(['broken'], 'notes.txt', { type: 'text/plain' });

    await expect(
      uploadChatAttachments({
        files: [file],
        gatewayUrl: 'http://localhost:3000',
        sessionId: 'session-1',
        token: null,
      }),
    ).resolves.toEqual(['- notes.txt (文件，上传失败)']);
  });
});
