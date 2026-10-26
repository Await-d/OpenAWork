import { describe, expect, it } from 'vitest';

import { parseLspLocations } from './lsp-location-view.js';

describe('parseLspLocations', () => {
  it('逐行解析 path:line:char', () => {
    const entries = parseLspLocations(['/repo/src/a.ts:12:4', '/repo/src/b.ts:3:0'].join('\n'));

    expect(entries).toEqual([
      { filePath: '/repo/src/a.ts', line: 12, column: 4 },
      { filePath: '/repo/src/b.ts', line: 3, column: 0 },
    ]);
  });

  it('省略列号时只保留行号', () => {
    expect(parseLspLocations('src/a.ts:7')).toEqual([{ filePath: 'src/a.ts', line: 7 }]);
  });

  it('Windows 盘符路径不会被第一个冒号截断', () => {
    const entries = parseLspLocations('C:\\repo\\src\\a.ts:9:2');

    expect(entries?.[0]).toEqual({ filePath: 'C:\\repo\\src\\a.ts', line: 9, column: 2 });
  });

  it('空行与提示文本被忽略', () => {
    expect(parseLspLocations('\n  \nNo references found\n')).toBeNull();
  });

  it('混杂提示时只取可解析的位置', () => {
    const entries = parseLspLocations(['No definition found', '/r/a.ts:1:0'].join('\n'));

    expect(entries).toHaveLength(1);
    expect(entries?.[0]?.filePath).toBe('/r/a.ts');
  });

  it('非字符串输入返回 null', () => {
    expect(parseLspLocations({ locations: [] })).toBeNull();
    expect(parseLspLocations(null)).toBeNull();
  });
});
