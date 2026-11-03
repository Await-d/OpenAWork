import { describe, expect, it } from 'vitest';

import { resolveFileBadge } from './media-file-badge.js';

describe('resolveFileBadge', () => {
  it('常见类型映射到对应色调与短标签', () => {
    expect(resolveFileBadge('report.pdf')).toMatchObject({
      label: 'PDF',
      tone: 'pdf',
      description: 'PDF 文档',
    });
    expect(resolveFileBadge('metrics.xlsx')).toMatchObject({ label: 'XLSX', tone: 'sheet' });
    expect(resolveFileBadge('assets-bundle.zip')).toMatchObject({ label: 'ZIP', tone: 'archive' });
    expect(resolveFileBadge('media-renderer.ts')).toMatchObject({ label: 'TS', tone: 'code' });
    expect(resolveFileBadge('cover.png')).toMatchObject({ label: 'PNG', tone: 'image' });
    expect(resolveFileBadge('meeting.mp3')).toMatchObject({ label: 'MP3', tone: 'audio' });
    expect(resolveFileBadge('demo.mp4')).toMatchObject({ label: 'MP4', tone: 'video' });
    expect(resolveFileBadge('notes.md')).toMatchObject({ label: 'MD', tone: 'text' });
  });

  it('大小写不敏感', () => {
    expect(resolveFileBadge('REPORT.PDF').tone).toBe('pdf');
    expect(resolveFileBadge('  spaced.csv  ')).toMatchObject({ label: 'CSV', tone: 'sheet' });
  });

  it('未知扩展名回落到 other，但仍显示扩展名', () => {
    expect(resolveFileBadge('weird.xyz')).toMatchObject({
      label: 'XYZ',
      tone: 'other',
      description: '文件',
    });
  });

  it('无扩展名、隐藏文件与空串回落到 FILE', () => {
    expect(resolveFileBadge('LICENSE')).toMatchObject({ label: 'FILE', tone: 'other' });
    expect(resolveFileBadge('.gitignore')).toMatchObject({ label: 'FILE', tone: 'other' });
    expect(resolveFileBadge('')).toMatchObject({ label: 'FILE', tone: 'other' });
  });

  it('多段扩展名取最后一段', () => {
    expect(resolveFileBadge('archive.tar.gz')).toMatchObject({ label: 'GZ', tone: 'archive' });
  });

  it('标签长度上限 4 个字符', () => {
    expect(resolveFileBadge('x.markdown').label).toBe('MARK');
  });

  it('文件名以点结尾时按无扩展名处理', () => {
    expect(resolveFileBadge('odd.')).toMatchObject({ label: 'FILE', tone: 'other' });
  });
});
