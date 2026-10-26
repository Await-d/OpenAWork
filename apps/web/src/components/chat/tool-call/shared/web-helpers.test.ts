import { describe, expect, it } from 'vitest';
import { extractWebSummary, isWebToolName } from './web-helpers.js';

describe('isWebToolName', () => {
  it('覆盖抓取与三种搜索入口（含 agent-core 的 web_search）', () => {
    expect(isWebToolName('webfetch')).toBe(true);
    expect(isWebToolName('websearch')).toBe(true);
    expect(isWebToolName('google_search')).toBe(true);
    expect(isWebToolName('web_search')).toBe(true);
  });

  it('大小写 / 空白不敏感', () => {
    expect(isWebToolName('  WEB_SEARCH ')).toBe(true);
  });

  it('非 web 工具不命中', () => {
    expect(isWebToolName('codesearch')).toBe(false);
    expect(isWebToolName('bash')).toBe(false);
    expect(isWebToolName('fetch_web')).toBe(false);
  });
});

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

  it('解析 agent-core web_search 的纯文本结果（1. 标题 / 摘要 / URL）', () => {
    const output = [
      '1. TypeScript 5.7 发布',
      '   新增对 import attributes 的支持',
      '   https://example.com/ts',
      '2. Bun 1.2',
      '   更快的测试运行器',
      '   https://example.com/bun',
    ].join('\n');

    const summary = extractWebSummary(output);

    expect(summary.searchResults).toHaveLength(2);
    expect(summary.searchResults?.[0]?.title).toBe('TypeScript 5.7 发布');
    expect(summary.searchResults?.[0]?.url).toBe('https://example.com/ts');
    expect(summary.searchResults?.[1]?.snippet).toBe('更快的测试运行器');
  });
});
