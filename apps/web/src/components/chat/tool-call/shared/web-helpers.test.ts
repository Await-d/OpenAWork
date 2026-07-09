import { describe, expect, it } from 'vitest';
import { extractWebSummary } from './web-helpers.js';

describe('extractWebSummary', () => {
  it('marks image webfetch output as previewable when imageUrl is present', () => {
    const summary = extractWebSummary({
      url: 'https://cdn.example.com/cat.png',
      status: 200,
      contentType: 'image/png',
      format: 'markdown',
      mediaKind: 'image',
      imageUrl: 'https://cdn.example.com/cat.png',
      content: '![Fetched image](https://cdn.example.com/cat.png)',
    });

    expect(summary).toMatchObject({
      url: 'https://cdn.example.com/cat.png',
      status: 200,
      contentType: 'image/png',
      format: 'markdown',
      mediaKind: 'image',
      imageUrl: 'https://cdn.example.com/cat.png',
    });
  });

  it('falls back to url for legacy image outputs that only set mediaKind', () => {
    const summary = extractWebSummary({
      url: 'https://cdn.example.com/legacy.webp',
      contentType: 'image/webp',
      mediaKind: 'image',
      content: '',
    });

    expect(summary.imageUrl).toBe('https://cdn.example.com/legacy.webp');
  });

  it('does not expose non-http image URLs as previewable images', () => {
    const unsupportedUrls = [
      'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"></svg>',
      'javascript:alert(1)',
      'file:///tmp/cat.png',
      'ftp://cdn.example.com/cat.png',
    ];

    for (const imageUrl of unsupportedUrls) {
      const summary = extractWebSummary({
        url: imageUrl,
        contentType: 'image/svg+xml',
        mediaKind: 'image',
        imageUrl,
        content: '',
      });

      expect(summary.imageUrl).toBeUndefined();
    }
  });
});
