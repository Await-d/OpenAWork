import { describe, expect, it } from 'vitest';
import {
  truncateToolOutput,
  truncateToolOutputUniversal,
} from '../../tools/tool-output-truncator.js';

const NOTICE_FRAGMENT = '[输出已截断';
const KIB = 1024;
const DEFAULT_CAP = 50 * KIB;

describe('truncateToolOutput（模型视图：2000 行 / 50 KiB 字节语义）', () => {
  it('passes through outputs below the universal cap', () => {
    const output = 'a'.repeat(1000);
    expect(truncateToolOutput('unknown_tool', output)).toBe(output);
  });

  it('caps mcp_call output at the default 50 KiB byte limit', () => {
    const output = 'a'.repeat(120_000);
    const truncated = truncateToolOutput('mcp_call', output);
    expect(truncated.length).toBeLessThan(output.length);
    expect(truncated.startsWith('a'.repeat(DEFAULT_CAP))).toBe(true);
    expect(truncated).toContain(NOTICE_FRAGMENT);
  });

  it('caps workspace_review_diff at the tool-specific 60k byte limit', () => {
    const output = 'd'.repeat(100_000);
    const truncated = truncateToolOutput('workspace_review_diff', output);
    expect(truncated.startsWith('d'.repeat(60_000))).toBe(true);
    expect(truncated).toContain(NOTICE_FRAGMENT);
  });

  it('caps webfetch at the tool-specific 40k byte limit', () => {
    const output = 'w'.repeat(60_000);
    const truncated = truncateToolOutput('webfetch', output);
    expect(truncated.startsWith('w'.repeat(40_000))).toBe(true);
    expect(truncated).toContain(NOTICE_FRAGMENT);
  });

  it('caps desktop_control output at the tool-specific 8k limit', () => {
    const output = 's'.repeat(20_000);
    const truncated = truncateToolOutput('desktop_control', output);
    expect(truncated.startsWith('s'.repeat(8_000))).toBe(true);
    expect(truncated).toContain(NOTICE_FRAGMENT);
  });

  it('uses the default 50 KiB cap for known truncatable tools without an override', () => {
    const output = 'g'.repeat(250_000);
    const truncated = truncateToolOutput('grep', output);
    expect(truncated.startsWith('g'.repeat(DEFAULT_CAP))).toBe(true);
    expect(truncated).toContain(NOTICE_FRAGMENT);
  });

  it('uses the universal 50 KiB cap for unrelated tools（含 read）', () => {
    const output = 'x'.repeat(250_000);
    const truncated = truncateToolOutput('list', output);
    expect(truncated.startsWith('x'.repeat(DEFAULT_CAP))).toBe(true);
    expect(truncated).toContain(NOTICE_FRAGMENT);
    const truncatedRead = truncateToolOutput('read', 'r'.repeat(120_000));
    expect(truncatedRead.startsWith('r'.repeat(DEFAULT_CAP))).toBe(true);
    expect(truncatedRead).toContain(NOTICE_FRAGMENT);
  });

  it('按字节记账：中文内容的可见上限与参考库一致（50 KiB 而非 5 万字符）', () => {
    const output = '正'.repeat(30_000); // 90,000 bytes
    const truncated = truncateToolOutput('read', output);
    // 50 KiB / 3 bytes = 17,066 个完整汉字。
    expect(truncated.startsWith('正'.repeat(17_066))).toBe(true);
    expect(truncated).not.toContain('正'.repeat(17_067));
    expect(Buffer.byteLength(truncated.split('\n')[0] ?? '', 'utf8')).toBeLessThanOrEqual(
      DEFAULT_CAP,
    );
    expect(truncated).toContain(NOTICE_FRAGMENT);
  });

  it('按行记账：超过 2000 行时只保留前 2000 行', () => {
    const lines = Array.from({ length: 3_000 }, (_value, index) => `line-${index + 1}`);
    const output = lines.join('\n');
    const truncated = truncateToolOutput('read', output);
    expect(truncated.startsWith(lines.slice(0, 2_000).join('\n'))).toBe(true);
    expect(truncated).not.toContain('line-2001');
    expect(truncated).toContain(NOTICE_FRAGMENT);
  });

  it('告知模型可用 read_tool_output 取回完整输出（模型视图提示）', () => {
    const truncated = truncateToolOutput('read', 'y'.repeat(60_000));
    expect(truncated).toContain('read_tool_output');
    expect(truncated).toContain('toolCallId');
  });

  it('is case-insensitive on tool names', () => {
    const output = 'm'.repeat(120_000);
    const truncated = truncateToolOutput('MCP_CALL', output);
    expect(truncated.length).toBeLessThan(output.length);
    expect(truncated).toContain(NOTICE_FRAGMENT);
  });
});

describe('truncateToolOutputUniversal（落盘视图：保持 200k 字符口径）', () => {
  it('返回字符串时走存储上限（read 的 120k 输出原样保留，供 read_tool_output 取回）', () => {
    const output = 'r'.repeat(120_000);
    expect(truncateToolOutputUniversal('read', output)).toBe(output);
  });

  it('存储上限仍截断超过 200k 的通用输出', () => {
    const output = 'x'.repeat(250_000);
    const result = truncateToolOutputUniversal('list', output) as string;
    expect(result.startsWith('x'.repeat(200_000))).toBe(true);
    expect(result).toContain(NOTICE_FRAGMENT);
  });

  it('按存储上限截断字符串输出（mcp_call 沿用 80k 落盘上限）', () => {
    const output = 'a'.repeat(120_000);
    const result = truncateToolOutputUniversal('mcp_call', output);
    expect(typeof result).toBe('string');
    expect((result as string).length).toBeLessThan(output.length);
  });

  it('passes through small object outputs unchanged', () => {
    const output = { ok: true, count: 3 };
    expect(truncateToolOutputUniversal('mcp_call', output)).toBe(output);
  });

  it('serializes and truncates oversized object outputs', () => {
    const output = { payload: 'a'.repeat(120_000) };
    const result = truncateToolOutputUniversal('mcp_call', output);
    expect(typeof result).toBe('string');
    expect(result as string).toContain(NOTICE_FRAGMENT);
  });

  it('preserves null and undefined outputs', () => {
    expect(truncateToolOutputUniversal('mcp_call', null)).toBeNull();
    expect(truncateToolOutputUniversal('mcp_call', undefined)).toBeUndefined();
  });

  it('handles circular object references when serializing', () => {
    type Node = { name: string; next?: Node };
    const node: Node = { name: 'a'.repeat(120_000) };
    node.next = node;
    const result = truncateToolOutputUniversal('mcp_call', node);
    expect(typeof result).toBe('string');
    expect(result as string).toContain(NOTICE_FRAGMENT);
  });
});
