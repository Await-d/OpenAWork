import { describe, expect, it } from 'vitest';
import { isImageFile, resolveFileMimeType } from './attachment-upload.js';

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
