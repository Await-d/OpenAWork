import { describe, expect, it } from 'vitest';

import { parseLspSymbols } from './lsp-symbol-view.js';

describe('parseLspSymbols — document 模式', () => {
  it('解析层级缩进、kind 与行号', () => {
    const output = [
      'ChatPage (kind 12) - line 10',
      '  render (kind 6) - line 24',
      '    value (kind 13) - line 30',
    ].join('\n');

    const entries = parseLspSymbols(output);

    expect(entries).toHaveLength(3);
    expect(entries?.[0]).toMatchObject({ depth: 0, name: 'ChatPage', kindLabel: '函数', line: 10 });
    expect(entries?.[1]).toMatchObject({ depth: 1, name: 'render', kindLabel: '方法', line: 24 });
    expect(entries?.[2]).toMatchObject({ depth: 2, name: 'value', kindLabel: '变量', line: 30 });
  });

  it('未知 kind 保留编号文案', () => {
    expect(parseLspSymbols('X (kind 99) - line 1')?.[0]?.kindLabel).toBe('kind 99');
  });
});

describe('parseLspSymbols — workspace 模式', () => {
  it('解析容器名与路径 / 行列', () => {
    const entries = parseLspSymbols('useThing (kind 12) in Foo - /repo/src/a.ts:12:4');

    expect(entries?.[0]).toMatchObject({
      depth: 0,
      name: 'useThing',
      kindLabel: '函数',
      containerName: 'Foo',
      filePath: '/repo/src/a.ts',
      line: 12,
      column: 4,
    });
  });

  it('没有容器名时仍可解析', () => {
    expect(parseLspSymbols('run (kind 12) - /repo/a.ts:1:0')?.[0]).toMatchObject({
      name: 'run',
      filePath: '/repo/a.ts',
      line: 1,
    });
  });
});

describe('parseLspSymbols — 边界', () => {
  it('提示文本 / 空输出返回 null', () => {
    expect(parseLspSymbols('No symbols found')).toBeNull();
    expect(parseLspSymbols('')).toBeNull();
    expect(parseLspSymbols(null)).toBeNull();
  });

  it('混杂无关行时只取符号行', () => {
    const entries = parseLspSymbols(['intro text', 'A (kind 5) - line 2'].join('\n'));

    expect(entries).toHaveLength(1);
    expect(entries?.[0]?.name).toBe('A');
  });
});
