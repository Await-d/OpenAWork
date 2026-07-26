import { describe, expect, it } from 'vitest';
import {
  truncateToolOutput,
  truncateToolOutputUniversal,
} from '../../tools/tool-output-truncator.js';

const NOTICE_FRAGMENT = '[输出已截断';

describe('truncateToolOutput', () => {
  it('passes through outputs below the universal cap', () => {
    const output = 'a'.repeat(1000);
    expect(truncateToolOutput('unknown_tool', output)).toBe(output);
  });

  it('caps mcp_call output at the tool-specific 80k limit', () => {
    const output = 'a'.repeat(120_000);
    const truncated = truncateToolOutput('mcp_call', output);
    expect(truncated.length).toBeLessThan(output.length);
    expect(truncated.startsWith('a'.repeat(80_000))).toBe(true);
    expect(truncated).toContain(NOTICE_FRAGMENT);
  });

  it('caps workspace_review_diff at the tool-specific 60k limit', () => {
    const output = 'd'.repeat(100_000);
    const truncated = truncateToolOutput('workspace_review_diff', output);
    expect(truncated.startsWith('d'.repeat(60_000))).toBe(true);
    expect(truncated).toContain(NOTICE_FRAGMENT);
  });

  it('caps webfetch at the tool-specific 40k limit', () => {
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

  it('uses default 200k cap for known truncatable tools without specific override', () => {
    const output = 'g'.repeat(250_000);
    const truncated = truncateToolOutput('grep', output);
    expect(truncated.startsWith('g'.repeat(200_000))).toBe(true);
    expect(truncated).toContain(NOTICE_FRAGMENT);
  });

  it('uses universal 200k cap for unrelated tools', () => {
    const output = 'x'.repeat(250_000);
    const truncated = truncateToolOutput('list', output);
    expect(truncated.startsWith('x'.repeat(200_000))).toBe(true);
    expect(truncated).toContain(NOTICE_FRAGMENT);
  });

  it('is case-insensitive on tool names', () => {
    const output = 'm'.repeat(120_000);
    const truncated = truncateToolOutput('MCP_CALL', output);
    expect(truncated.length).toBeLessThan(output.length);
    expect(truncated).toContain(NOTICE_FRAGMENT);
  });
});

describe('truncateToolOutputUniversal', () => {
  it('returns string outputs through truncateToolOutput', () => {
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
