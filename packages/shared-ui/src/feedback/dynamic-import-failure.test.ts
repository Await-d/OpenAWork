import { describe, expect, it } from 'vitest';
import { isDynamicImportFailure } from './dynamic-import-failure.js';

describe('isDynamicImportFailure', () => {
  it('识别 Chrome / Edge 的动态导入失败', () => {
    expect(
      isDynamicImportFailure(
        new TypeError(
          'Failed to fetch dynamically imported module: http://localhost:5173/src/pages/chat-page/ChatPage.tsx',
        ),
      ),
    ).toBe(true);
  });

  it('识别 Firefox 与 WebKit 的文案差异', () => {
    expect(
      isDynamicImportFailure(
        new TypeError('error loading dynamically imported module: https://example.com/assets/a.js'),
      ),
    ).toBe(true);
    expect(isDynamicImportFailure(new Error('Importing a module script failed.'))).toBe(true);
  });

  it('识别 split chunk 的旧文案', () => {
    const chunkError = Object.assign(new Error('Loading chunk 12 failed.'), {
      name: 'ChunkLoadError',
    });
    expect(isDynamicImportFailure(chunkError)).toBe(true);
  });

  it('不把普通运行时错误误判为动态导入失败', () => {
    expect(
      isDynamicImportFailure(new TypeError("Cannot read properties of undefined (reading 'id')")),
    ).toBe(false);
    expect(isDynamicImportFailure(undefined)).toBe(false);
    expect(isDynamicImportFailure(null)).toBe(false);
  });
});
