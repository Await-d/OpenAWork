import { describe, expect, it } from 'vitest';
import {
  parseMcpCallRawInput,
  parseMcpListToolsRawInput,
} from '../mcp-tool-input.js';

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
      arguments: "'{\"q\":\"hello\"}'",
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
});
