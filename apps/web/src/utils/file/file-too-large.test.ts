import { describe, expect, it } from 'vitest';
import { HttpError } from '@openAwork/web-client';
import {
  describeFileReadError,
  FILE_PREVIEW_MAX_BYTES,
  FILE_TOO_LARGE_MESSAGE,
  isFileTooLargeError,
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

describe('describeFileReadError', () => {
  it('超限时给出统一中文提示', () => {
    expect(describeFileReadError(new HttpError('too large', 413), '打开文件失败')).toBe(
      FILE_TOO_LARGE_MESSAGE,
    );
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
