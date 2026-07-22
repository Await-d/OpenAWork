import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { webfetchTool } from '../../tools/web-tools.js';

const NO_SIGNAL = new AbortController().signal;

describe('webfetch image preview', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns a structured preview when the fetched URL is an existing web image', async () => {
    const imageUrl = 'https://cdn.example.com/cat.png';
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(new Uint8Array([137, 80, 78, 71]), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      }),
    );

    const result = await webfetchTool.execute(
      { url: imageUrl, format: 'image-preview', timeout: 20 },
      NO_SIGNAL,
    );

    expect(result).toEqual({
      url: imageUrl,
      format: 'image-preview',
      status: 200,
      contentType: 'image/png',
      mediaKind: 'image',
      imageUrl,
      content: `![Fetched image](${imageUrl})`,
    });
  });

  it('当 format=image-preview 但目标并非图片时返回明确错误', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response('<html>not an image</html>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }),
    );

    await expect(
      webfetchTool.execute(
        { url: 'https://example.com/article', format: 'image-preview', timeout: 20 },
        NO_SIGNAL,
      ),
    ).rejects.toThrow('webfetch image-preview requires an image response');
  });

  it('rejects non-http webfetch URLs at the schema boundary', () => {
    const unsupportedUrls = [
      'data:image/png;base64,iVBORw0KGgo=',
      'javascript:alert(1)',
      'file:///tmp/cat.png',
      'ftp://cdn.example.com/cat.png',
    ];

    for (const url of unsupportedUrls) {
      const parsed = webfetchTool.inputSchema.safeParse({
        url,
        format: 'markdown',
        timeout: 20,
      });

      expect(parsed.success).toBe(false);
    }
  });
});
