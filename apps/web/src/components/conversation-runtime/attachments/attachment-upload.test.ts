import { describe, expect, it, vi } from 'vitest';
import {
  ATTACHMENT_UPLOAD_TIMEOUT_MS,
  isImageFile,
  resolveFileMimeType,
  uploadChatAttachments,
} from './attachment-upload.js';

describe('attachment-upload MIME inference', () => {
  it('treats JPG files with an empty browser MIME as image/jpeg', () => {
    const file = new File(['jpeg-bytes'], 'reference.jpg', { type: '' });

    expect(resolveFileMimeType(file)).toBe('image/jpeg');
    expect(isImageFile(file)).toBe(true);
  });

  it('normalizes non-standard image/jpg browser MIME to image/jpeg', () => {
    const file = new File(['jpeg-bytes'], 'reference.jpg', { type: 'image/jpg' });

    expect(resolveFileMimeType(file)).toBe('image/jpeg');
    expect(isImageFile(file)).toBe(true);
  });
});

describe('uploadChatAttachments 墙钟超时', () => {
  it('默认超时与 web-client 产物传输预算对齐（120s）', () => {
    expect(ATTACHMENT_UPLOAD_TIMEOUT_MS).toBe(120_000);
  });

  it('上传永久 pending 时在 timeoutMs 后中止并返回空结果（不永久挂起）', async () => {
    const file = new File(['hello'], 'note.txt', { type: 'text/plain' });
    const fetchImpl = vi.fn((_input: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => {
            reject(new Error('aborted'));
          },
          { once: true },
        );
      });
    }) as unknown as typeof fetch;

    const startedAt = Date.now();
    const uploaded = await uploadChatAttachments({
      files: [file],
      gatewayUrl: 'http://localhost:3000',
      sessionId: 'session-upload-timeout',
      token: 'token',
      fetchImpl,
      timeoutMs: 20,
    });

    expect(uploaded).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(Date.now() - startedAt).toBeLessThan(5_000);
  });

  it('正常响应时返回上传后的附件', async () => {
    const file = new File(['hello'], 'note.txt', { type: 'text/plain' });
    const fetchImpl = vi.fn(async () => {
      return {
        ok: true,
        json: async () => ({
          artifact: {
            id: 'artifact-1',
            name: 'note.txt',
            metadata: { mimeType: 'text/plain' },
          },
        }),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const uploaded = await uploadChatAttachments({
      files: [file],
      gatewayUrl: 'http://localhost:3000',
      sessionId: 'session-upload-ok',
      token: 'token',
      fetchImpl,
      timeoutMs: 1_000,
    });

    expect(uploaded).toEqual([
      {
        artifactId: 'artifact-1',
        fileName: 'note.txt',
        mimeType: 'text/plain',
        type: 'file',
      },
    ]);
  });
});
