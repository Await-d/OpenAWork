import { describe, expect, it } from 'vitest';

import { parseAstGrepMatches } from './ast-grep-view.js';

describe('parseAstGrepMatches', () => {
  it('解析 header + 多条匹配（路径 / 行 / 列 / 片段）', () => {
    const output = [
      '找到 2 处匹配：',
      '',
      'src/a.ts:12:5',
      'const a = 1;',
      '',
      'src/b.ts:40:1',
      'const b = 2;',
    ].join('\n');

    const matches = parseAstGrepMatches(output);

    expect(matches).toHaveLength(2);
    expect(matches?.[0]).toMatchObject({
      filePath: 'src/a.ts',
      line: 12,
      column: 5,
      snippet: 'const a = 1;',
    });
    expect(matches?.[1]?.filePath).toBe('src/b.ts');
  });

  it('上下文多行片段保留原始缩进与换行', () => {
    const output = [
      '找到 1 处匹配（上下文=2）：',
      '',
      'src/a.ts:10:3',
      '  before();',
      '  target();',
      '  after();',
    ].join('\n');

    const matches = parseAstGrepMatches(output);

    expect(matches?.[0]?.snippet).toBe('  before();\n  target();\n  after();');
  });

  it('片段内部空行不会被当成新匹配（不按空行分段）', () => {
    const output = ['src/a.ts:1:1', 'line1', '', 'line3', 'src/b.ts:2:2', 'x'].join('\n');

    const matches = parseAstGrepMatches(output);

    expect(matches).toHaveLength(2);
    expect(matches?.[0]?.snippet).toContain('line3');
  });

  it('未找到 / 无可应用改动 返回空数组', () => {
    expect(parseAstGrepMatches('未找到匹配。')).toEqual([]);
    expect(parseAstGrepMatches('试运行：无可应用的改动。')).toEqual([]);
    expect(parseAstGrepMatches('无任何替换被应用。')).toEqual([]);
  });

  it('非位置文本返回 null（回退原文）', () => {
    expect(parseAstGrepMatches('已应用替换：3 files changed')).toBeNull();
    expect(parseAstGrepMatches('')).toBeNull();
    expect(parseAstGrepMatches({ matches: [] })).toBeNull();
  });
});
