import { describe, expect, it } from 'vitest';
import { HttpError } from '@openAwork/web-client';
import {
  describeFileReadError,
  FILE_PREVIEW_BUSY_MESSAGE,
  FILE_PREVIEW_MAX_BYTES,
  FILE_TOO_LARGE_MESSAGE,
  isFileTooLargeError,
  isPreviewBusyError,
} from './file-too-large.js';

describe('预览体积上限', () => {
  it('上限为 10MB', () => {
    expect(FILE_PREVIEW_MAX_BYTES).toBe(10 * 1024 * 1024);
  });
});

describe('isFileTooLargeError', () => {
  it('识别 413', () => {
    expect(isFileTooLargeError(new HttpError('too large', 413))).toBe(true);
  });

  it('不误判其它状态码与普通错误', () => {
    expect(isFileTooLargeError(new HttpError('not found', 404))).toBe(false);
    expect(isFileTooLargeError(new Error('boom'))).toBe(false);
    expect(isFileTooLargeError('413')).toBe(false);
    expect(isFileTooLargeError(undefined)).toBe(false);
  });
});

describe('isPreviewBusyError', () => {
  it('识别 429（并发门控饱和）', () => {
    expect(isPreviewBusyError(new HttpError('busy', 429))).toBe(true);
  });

  it('不把 413 误判为繁忙', () => {
    expect(isPreviewBusyError(new HttpError('too large', 413))).toBe(false);
  });
});

describe('describeFileReadError', () => {
  it('超限时给出统一中文提示', () => {
    expect(describeFileReadError(new HttpError('too large', 413), '打开文件失败')).toBe(
      FILE_TOO_LARGE_MESSAGE,
    );
  });

  it('并发饱和时提示「稍后重试」而非「不支持」', () => {
    const message = describeFileReadError(new HttpError('busy', 429), '打开文件失败');
    expect(message).toBe(FILE_PREVIEW_BUSY_MESSAGE);
    // 429 是临时状态，文案不能写成永久不支持，否则用户会以为文件本身有问题。
    expect(message).not.toContain('不支持预览');
    expect(message).toContain('重试');
  });

  it('413 与 429 走不同文案', () => {
    expect(FILE_TOO_LARGE_MESSAGE).not.toBe(FILE_PREVIEW_BUSY_MESSAGE);
  });

  it('超限提示包含 10MB 与下载指引', () => {
    expect(FILE_TOO_LARGE_MESSAGE).toContain('10MB');
    expect(FILE_TOO_LARGE_MESSAGE).toContain('下载');
  });

  it('其它错误保留原始信息', () => {
    expect(describeFileReadError(new Error('磁盘读取失败'), '打开文件失败')).toBe('磁盘读取失败');
  });

  it('无信息时回退到调用方文案', () => {
    expect(describeFileReadError(new Error(''), '打开文件失败')).toBe('打开文件失败');
  });
});
