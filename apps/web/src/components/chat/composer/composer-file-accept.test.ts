import { describe, expect, it } from 'vitest';
import { COMPOSER_FILE_ACCEPT } from './composer-file-accept.js';

const ACCEPT_ENTRIES = COMPOSER_FILE_ACCEPT.split(',');

describe('COMPOSER_FILE_ACCEPT', () => {
  it('声明了 AttachmentItem 支持的全部媒体类别', () => {
    // AttachmentItem['type'] 与 inferAttachmentType 都支持 image / audio / video，
    // 选择器必须同步放开，否则用户传不了自己明明被支持的文件。
    expect(ACCEPT_ENTRIES).toContain('image/*');
    expect(ACCEPT_ENTRIES).toContain('audio/*');
    expect(ACCEPT_ENTRIES).toContain('video/*');
  });

  it('包含常见文档类型', () => {
    for (const extension of ['.pdf', '.docx', '.xlsx', '.pptx']) {
      expect(ACCEPT_ENTRIES).toContain(extension);
    }
  });

  it('没有空项或重复项', () => {
    expect(ACCEPT_ENTRIES.every((entry) => entry.trim().length > 0)).toBe(true);
    expect(new Set(ACCEPT_ENTRIES).size).toBe(ACCEPT_ENTRIES.length);
  });

  it('扩展名条目统一以点号开头', () => {
    const extensionEntries = ACCEPT_ENTRIES.filter((entry) => !entry.includes('/'));
    expect(extensionEntries.every((entry) => entry.startsWith('.'))).toBe(true);
  });
});
