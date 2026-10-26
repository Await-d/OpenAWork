import { describe, expect, it } from 'vitest';

import { parseLspPrepareRename } from './lsp-prepare-rename-view.js';

describe('parseLspPrepareRename', () => {
  it('可重命名并给出目标范围', () => {
    expect(parseLspPrepareRename('Rename available at 12:5-12:9')).toEqual({
      kind: 'available',
      range: '12:5-12:9',
    });
  });

  it('default behavior 也算可重命名（无范围）', () => {
    expect(parseLspPrepareRename('Rename supported (using default behavior)')).toEqual({
      kind: 'available',
    });
  });

  it('不可重命名', () => {
    expect(parseLspPrepareRename('Cannot rename at this position')).toEqual({
      kind: 'unavailable',
    });
  });

  it('其它文本返回 null（回退文本）', () => {
    expect(parseLspPrepareRename('No call hierarchy found')).toBeNull();
    expect(parseLspPrepareRename('')).toBeNull();
    expect(parseLspPrepareRename({ valid: true })).toBeNull();
  });
});
