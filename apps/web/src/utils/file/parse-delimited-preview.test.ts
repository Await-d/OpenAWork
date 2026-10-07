import { describe, expect, it } from 'vitest';
import { parseDelimitedPreview } from './parse-delimited-preview.js';

describe('parseDelimitedPreview', () => {
  it('首行作为表头，其余作为数据行', () => {
    const result = parseDelimitedPreview('name,age\nAda,36\n', ',');
    expect(result.headers).toEqual(['name', 'age']);
    expect(result.rows).toEqual([['Ada', '36']]);
    expect(result.truncatedRows).toBe(0);
  });

  it('去空行并 trim 单元格', () => {
    const result = parseDelimitedPreview('a , b\n\n 1 , 2 \n\n', ',');
    expect(result.headers).toEqual(['a', 'b']);
    expect(result.rows).toEqual([['1', '2']]);
  });

  it('支持制表符分隔', () => {
    const result = parseDelimitedPreview('a\tb\n1\t2', '\t');
    expect(result.headers).toEqual(['a', 'b']);
    expect(result.rows).toEqual([['1', '2']]);
  });

  it('缺列的行补占位符由调用方处理', () => {
    const result = parseDelimitedPreview('a,b,c\n1,2', ',');
    expect(result.rows).toEqual([['1', '2']]);
  });

  it('空内容返回空表头', () => {
    const result = parseDelimitedPreview('   \n\n', ',');
    expect(result.headers).toEqual([]);
    expect(result.rows).toEqual([]);
  });

  it('超出上限时截断并记录被丢弃的行数', () => {
    const lines = ['h', ...Array.from({ length: 10 }, (_, i) => `v${i}`)].join('\n');
    const result = parseDelimitedPreview(lines, ',', 4);
    expect(result.parsedLines).toBe(4);
    expect(result.rows).toHaveLength(3);
    expect(result.truncatedRows).toBe(7);
  });
});
