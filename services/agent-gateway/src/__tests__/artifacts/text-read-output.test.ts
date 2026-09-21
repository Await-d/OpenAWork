import { describe, expect, it } from 'vitest';
import { formatTextReadOutput, isBinaryContent } from '../../artifacts/text-read-output.js';

const format = (content: string, displayPath = 'notes.md') =>
  formatTextReadOutput({ buffer: Buffer.from(content, 'utf-8'), displayPath });

describe('formatTextReadOutput —— 基本输出', () => {
  it('按 opencode 格式输出：path/type/content 包裹 + 行号 + 结束标记', () => {
    const result = format('first\nsecond\nthird\n');

    expect(result).toBeDefined();
    expect(result?.text).toBe(
      [
        '<path>notes.md</path>',
        '<type>file</type>',
        '<content>',
        '1: first',
        '2: second',
        '3: third',
        '',
        '(End of file - total 3 lines)',
        '</content>',
      ].join('\n'),
    );
    expect(result?.totalLines).toBe(3);
    expect(result?.truncated).toBe(false);
  });

  it('CRLF 与末尾换行不产生多余空行', () => {
    const result = format('a\r\nb\r\n');

    expect(result?.totalLines).toBe(2);
    expect(result?.text).toContain('1: a\n2: b');
    expect(result?.text).toContain('(End of file - total 2 lines)');
  });

  it('offset 生效：从指定行开始并沿用真实行号', () => {
    const result = formatTextReadOutput({
      buffer: Buffer.from('a\nb\nc\n', 'utf-8'),
      displayPath: 'notes.md',
      offset: 2,
    });

    expect(result?.text).toContain('2: b\n3: c');
    expect(result?.text).not.toContain('1: a');
  });
});

describe('formatTextReadOutput —— 上限', () => {
  it('超过 2000 行时截断并给出续读提示', () => {
    const content = Array.from({ length: 2001 }, (_, index) => `line-${index + 1}`).join('\n');
    const result = format(content);

    expect(result?.truncated).toBe(true);
    expect(result?.totalLines).toBe(2001);
    expect(result?.text).toContain('(Showing lines 1-2000 of 2001. Use offset=2001 to continue.)');
    expect(result?.text).not.toContain('line-2001');
  });

  it('单行超过 2000 字符时截断该行并加后缀', () => {
    const result = format('x'.repeat(2001));

    expect(result?.text).toContain('... (line truncated to 2000 chars)');
    expect(result?.text).not.toContain('x'.repeat(2001));
  });

  it('累计字节超过 50KB 时按字节上限截断', () => {
    const content = Array.from({ length: 2000 }, () => 'y'.repeat(40)).join('\n');
    const result = format(content);

    expect(result?.truncated).toBe(true);
    expect(result?.text).toContain('Output capped at 50 KB.');
    expect(result?.text).toContain('Use offset=');
  });
});

describe('formatTextReadOutput —— 二进制与空内容返回 undefined', () => {
  it('含 NUL 字节视为二进制', () => {
    expect(format('abc\0def')).toBeUndefined();
  });

  it('二进制扩展名（.docx）直接判定为二进制', () => {
    expect(format('看起来像文本', 'report.docx')).toBeUndefined();
  });

  it('控制字符占比超过 30% 视为二进制', () => {
    expect(format('\u0001\u0002\u0003\u0004abcd')).toBeUndefined();
  });

  it('空内容与纯空白返回 undefined', () => {
    expect(format('')).toBeUndefined();
    expect(format('   \n\n  ')).toBeUndefined();
  });

  it('正常文本不被判定为二进制', () => {
    expect(isBinaryContent('notes.md', Buffer.from('hello\nworld\n', 'utf-8'))).toBe(false);
  });
});
