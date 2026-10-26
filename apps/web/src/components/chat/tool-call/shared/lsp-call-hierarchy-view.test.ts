import { describe, expect, it } from 'vitest';

import { parseLspCallHierarchy } from './lsp-call-hierarchy-view.js';

const OUTPUT = [
  'Symbol: run (detail) - /repo/src/a.ts:12:4',
  '',
  'Incoming calls:',
  '  caller - /repo/src/b.ts:8:2',
  '  other (helper) - /repo/src/c.ts:30:0',
  '',
  'Outgoing calls:',
  '  callee - /repo/src/d.ts:1:0',
].join('\n');

describe('parseLspCallHierarchy', () => {
  it('解析符号与 incoming / outgoing 两组', () => {
    const view = parseLspCallHierarchy(OUTPUT);

    expect(view?.symbol).toMatchObject({
      name: 'run',
      detail: 'detail',
      filePath: '/repo/src/a.ts',
      line: 12,
      column: 4,
    });
    expect(view?.incoming).toHaveLength(2);
    expect(view?.incoming[1]).toMatchObject({ name: 'other', detail: 'helper', line: 30 });
    expect(view?.outgoing).toHaveLength(1);
    expect(view?.outgoing[0]?.filePath).toBe('/repo/src/d.ts');
  });

  it('空段提示不产生条目', () => {
    const view = parseLspCallHierarchy(
      [
        'Symbol: run - /repo/src/a.ts:1:0',
        'Incoming calls:',
        'No incoming calls found',
        'Outgoing calls:',
        'No outgoing calls found',
      ].join('\n'),
    );

    expect(view?.incoming).toEqual([]);
    expect(view?.outgoing).toEqual([]);
    expect(view?.symbol?.name).toBe('run');
  });

  it('没有层次信息时返回 null（回退文本）', () => {
    expect(parseLspCallHierarchy('No call hierarchy found')).toBeNull();
    expect(parseLspCallHierarchy('')).toBeNull();
    expect(parseLspCallHierarchy({ symbol: null })).toBeNull();
  });

  it('符号名带括号时只在最后一个括号组识别 detail', () => {
    const view = parseLspCallHierarchy('Symbol: fn(a, b) - /repo/a.ts:3:1');

    expect(view?.symbol?.name).toBe('fn(a, b)');
    expect(view?.symbol?.detail).toBeUndefined();
  });
});
