import { describe, expect, it } from 'vitest';
import {
  inferAttachmentType,
  inferMimeTypeFromFileName,
  resolveAttachmentMimeType,
} from './chat-attachments';

describe('inferMimeTypeFromFileName', () => {
  it('识别常见图片扩展名且不区分大小写', () => {
    expect(inferMimeTypeFromFileName('photo.JPG')).toBe('image/jpeg');
    expect(inferMimeTypeFromFileName('photo.jpeg')).toBe('image/jpeg');
    expect(inferMimeTypeFromFileName('photo.PNG')).toBe('image/png');
    expect(inferMimeTypeFromFileName('photo.webp')).toBe('image/webp');
    expect(inferMimeTypeFromFileName('photo.GIF')).toBe('image/gif');
  });

  it('非图片扩展名与无扩展名返回 undefined', () => {
    expect(inferMimeTypeFromFileName('notes.txt')).toBeUndefined();
    expect(inferMimeTypeFromFileName('README')).toBeUndefined();
  });
});

describe('resolveAttachmentMimeType', () => {
  it('显式 mimeType 优先，并把 image/jpg 归一为 image/jpeg', () => {
    expect(resolveAttachmentMimeType({ mimeType: 'image/JPG', name: 'blob.bin' })).toBe(
      'image/jpeg',
    );
    expect(resolveAttachmentMimeType({ mimeType: 'application/pdf', name: 'photo.png' })).toBe(
      'application/pdf',
    );
  });

  it('缺失或空 mimeType 时回退文件名推断', () => {
    expect(resolveAttachmentMimeType({ name: 'photo.png' })).toBe('image/png');
    expect(resolveAttachmentMimeType({ mimeType: '', name: 'clip.gif' })).toBe('image/gif');
  });

  it('既无 mimeType 也无法推断时返回 undefined', () => {
    expect(resolveAttachmentMimeType({ name: 'archive.zip' })).toBeUndefined();
    expect(resolveAttachmentMimeType({ mimeType: '', name: 'archive' })).toBeUndefined();
  });
});

describe('inferAttachmentType', () => {
  it('按 image/ 与 audio/ 前缀分类', () => {
    expect(inferAttachmentType({ mimeType: 'image/png', name: 'a' })).toBe('image');
    expect(inferAttachmentType({ mimeType: 'audio/m4a', name: 'a' })).toBe('audio');
  });

  it('无法归入 image/audio 时归类为 file', () => {
    expect(inferAttachmentType({ mimeType: 'application/pdf', name: 'a' })).toBe('file');
    expect(inferAttachmentType({ name: 'archive' })).toBe('file');
  });

  it('可从文件名回退推断图片类型', () => {
    expect(inferAttachmentType({ name: 'screenshot.webp' })).toBe('image');
    expect(inferAttachmentType({ mimeType: 'image/jpg', name: 'screenshot' })).toBe('image');
  });
});
