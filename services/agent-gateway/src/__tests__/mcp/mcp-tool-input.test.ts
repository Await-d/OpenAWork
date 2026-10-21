import { describe, expect, it } from 'vitest';
import { parseMcpCallRawInput, parseMcpListToolsRawInput } from '../../mcp/mcp-tool-input.js';

describe('parseMcpListToolsRawInput', () => {
  it('returns trimmed serverId when provided', () => {
    expect(parseMcpListToolsRawInput({ serverId: '  memory ' })).toEqual({
      serverId: 'memory',
    });
  });

  it('returns empty result when serverId is missing', () => {
    expect(parseMcpListToolsRawInput({})).toEqual({});
  });

  it('returns empty result when serverId is blank or wrong type', () => {
    expect(parseMcpListToolsRawInput({ serverId: '   ' })).toEqual({});
    expect(parseMcpListToolsRawInput({ serverId: 42 })).toEqual({});
    expect(parseMcpListToolsRawInput({ serverId: null })).toEqual({});
  });
});

describe('parseMcpCallRawInput', () => {
  it('accepts an object arguments payload and trims identifiers', () => {
    const result = parseMcpCallRawInput({
      serverId: '  memory ',
      toolName: ' query ',
      arguments: { q: 'hello' },
    });
    expect(result).toEqual({
      ok: true,
      serverId: 'memory',
      toolName: 'query',
      arguments: { q: 'hello' },
    });
  });

  it('accepts a JSON-encoded string arguments payload', () => {
    const result = parseMcpCallRawInput({
      serverId: 'memory',
      toolName: 'query',
      arguments: '{"q":"hello"}',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.arguments).toEqual({ q: 'hello' });
    }
  });

  it('strips outer single quotes around stringified JSON arguments', () => {
    const result = parseMcpCallRawInput({
      serverId: 'memory',
      toolName: 'query',
      arguments: '\'{"q":"hello"}\'',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.arguments).toEqual({ q: 'hello' });
    }
  });

  it('rejects array arguments (must be a JSON object)', () => {
    const result = parseMcpCallRawInput({
      serverId: 'memory',
      toolName: 'query',
      arguments: [1, 2, 3],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('JSON object');
    }
  });

  it('rejects malformed JSON string arguments', () => {
    const result = parseMcpCallRawInput({
      serverId: 'memory',
      toolName: 'query',
      arguments: '{not json',
    });
    expect(result.ok).toBe(false);
  });

  it('rejects empty serverId or toolName', () => {
    const noServer = parseMcpCallRawInput({
      serverId: '   ',
      toolName: 'query',
      arguments: {},
    });
    expect(noServer.ok).toBe(false);
    if (!noServer.ok) {
      expect(noServer.reason).toContain('serverId');
    }

    const noTool = parseMcpCallRawInput({
      serverId: 'memory',
      toolName: '',
      arguments: {},
    });
    expect(noTool.ok).toBe(false);
    if (!noTool.ok) {
      expect(noTool.reason).toContain('toolName');
    }
  });

  it('rejects null or missing arguments', () => {
    const noArgs = parseMcpCallRawInput({
      serverId: 'memory',
      toolName: 'query',
    });
    expect(noArgs.ok).toBe(false);

    const nullArgs = parseMcpCallRawInput({
      serverId: 'memory',
      toolName: 'query',
      arguments: null,
    });
    expect(nullArgs.ok).toBe(false);
  });

  // 回归（2026-10-18 排障）：上游流式中断会把整个入参对象降级成 `{ raw: "<JSON>" }`，
  // 此前 mcp_call 不做还原，模型只收到「requires a non-empty serverId」。
  it('restores the streamed fallback shape { raw: "<json>" }', () => {
    const result = parseMcpCallRawInput({
      raw: '{"serverId":"open_websearch","toolName":"search","arguments":{"query":"x"}}',
    });
    expect(result).toEqual({
      ok: true,
      serverId: 'open_websearch',
      toolName: 'search',
      arguments: { query: 'x' },
    });
  });

  it('只对「仅含 raw 键 + raw 是对象型 JSON」的形态做还原，其余保持原判定', () => {
    // 半截 JSON：保持原样，仍报 serverId 缺失而非静默吞掉。
    const truncated = parseMcpCallRawInput({
      raw: '{"serverId":"open_websearch","toolName":',
    });
    expect(truncated.ok).toBe(false);
    if (!truncated.ok) {
      expect(truncated.reason).toContain('serverId');
    }

    // raw 是 JSON 数组（非 mcp_call 形）：不还原。
    expect(parseMcpCallRawInput({ raw: '["x"]' }).ok).toBe(false);

    // 存在其它键时 `raw` 视为真实入参，不做展开。
    expect(parseMcpCallRawInput({ raw: '{"serverId":"x"}', serverId: '' }).ok).toBe(false);
  });
});
