import { describe, expect, it } from 'vitest';
import {
  buildReadToolOutputResponse,
  readToolOutputInputSchema,
  readToolOutputOutputSchema,
} from '../../tools/tool-output-tools.js';

function read(output: unknown, request: Record<string, unknown> = {}) {
  return buildReadToolOutputResponse({
    output,
    request: readToolOutputInputSchema.parse({ toolCallId: 'call-1', ...request }),
    isError: false,
    sizeBytes: Buffer.byteLength(JSON.stringify(output)),
    toolCallId: 'call-1',
  });
}

describe('read_tool_output 字符预算分页', () => {
  it('巨型单行自动分页并可连续读取完整尾部', () => {
    const source = '网页正文'.repeat(10_000) + '尾部标记';
    let restored = '';
    let charStart = 0;
    do {
      const page = read(source, charStart ? { charStart } : {});
      expect(readToolOutputOutputSchema.safeParse(page).success).toBe(true);
      expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThan(12_000);
      expect(page.selection.mode).toBe('chars');
      expect(typeof page.output).toBe('string');
      restored += String(page.output);
      charStart = page.selection.nextCharStart ?? source.length;
    } while (charStart < source.length);
    expect(restored).toBe(source);
  });

  it('巨型数组项可按字符访问，不被按项数量限制绕过', () => {
    const output = [{ content: 'x'.repeat(40_000) }, { content: 'tail' }];
    const page = read(output);
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThan(12_000);
    expect(page.selection.mode).toBe('chars');
    const tail = read(output, { charStart: 40_000, charCount: 100 });
    expect(tail.output).toBe(JSON.stringify(output).slice(40_000, 40_100));
  });

  it('字符偏移相对于 jsonPath 和行选择，保留小结果语义', () => {
    expect(read('a\nb\nc', { lineStart: 2, lineCount: 1 }).output).toBe('b');
    expect(read({ data: [1, 2, 3] }, { jsonPath: 'data', itemStart: 1 }).output).toEqual([2, 3]);
    expect(
      read(
        { text: 'a\nbcdef\ng' },
        {
          jsonPath: 'text',
          lineStart: 2,
          lineCount: 1,
          charStart: 2,
          charCount: 2,
        },
      ).output,
    ).toBe('de');
  });

  it('越界行请求返回空页面和非负行数', () => {
    const page = read('a\nb', { lineStart: 99 });
    expect(page.output).toBe('');
    expect(readToolOutputOutputSchema.safeParse(page).success).toBe(true);
  });

  it('转义密集输出仍受序列化字节预算限制', () => {
    const page = read('\u0000'.repeat(40_000));
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThan(12_000);
    expect(page.selection.nextCharStart).toBeGreaterThan(0);
  });
  it('大对象默认返回键名，也支持显式字符读取原 JSON', () => {
    const source = { body: 'x'.repeat(40_000), tail: '结束' };
    expect(read(source).selection.mode).toBe('keys');
    expect(read(source, { charStart: 40_000, charCount: 100 }).output).toBe(
      JSON.stringify(source).slice(40_000, 40_100),
    );
  });

  it('空字段和越界字符请求仍产生有效响应', () => {
    expect(read({ body: 1 }, { jsonPath: 'missing', charStart: 0 }).output).toBe('undefined');
    const page = read('short', { charStart: 99 });
    expect(page.output).toBe('');
    expect(page.selection.nextCharStart).toBeUndefined();
    expect(readToolOutputOutputSchema.safeParse(page).success).toBe(true);
  });

  it('拒绝负偏移和无效长度', () => {
    expect(
      readToolOutputInputSchema.safeParse({ toolCallId: 'call-1', charStart: -1 }).success,
    ).toBe(false);
    for (const charCount of [0, -1, 1.5, Infinity, NaN, '8500']) {
      expect(readToolOutputInputSchema.safeParse({ toolCallId: 'call-1', charCount }).success).toBe(
        false,
      );
    }
  });

  it('超额字符请求自动限流且通过返回游标无损续读', () => {
    const source = 'x'.repeat(20000);
    expect(
      readToolOutputInputSchema.parse({ toolCallId: 'call-1', charCount: 8500 }).charCount,
    ).toBe(8000);
    let charStart = 5600;
    let restored = '';
    while (charStart < source.length) {
      const page = read(source, { charStart, charCount: 8500 });
      expect(page.selection.charCount).toBeLessThanOrEqual(8000);
      expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThan(12000);
      restored += String(page.output);
      const next = page.selection.nextCharStart ?? source.length;
      expect(next).toBeGreaterThan(charStart);
      charStart = next;
    }
    expect(restored).toBe(source.slice(5600));
  });

  it('字符分页不会在代理对中间切断 emoji', () => {
    const source = 'a😀结尾';
    const first = read(source, { charStart: 0, charCount: 2 });
    const nextStart = first.selection.nextCharStart;
    expect(nextStart).toBeDefined();
    expect(String(first.output)).not.toMatch(/[\uD800-\uDBFF]$/u);
    const second = read(source, { charStart: nextStart });
    expect(String(second.output)).not.toMatch(/^[\uDC00-\uDFFF]/u);
    expect(`${String(first.output)}${String(second.output)}`).toBe(source);
  });

  it('charCount 为一时仍完整返回 emoji 并推进游标', () => {
    const page = read('😀tail', { charStart: 0, charCount: 1 });
    expect(page.output).toBe('😀');
    expect(page.selection.nextCharStart).toBe(2);
  });
});
