/**
 * Coverage for the flat-MCP routing path inside `tool-sandbox.ts`
 * introduced in PR-C.3:
 *
 *   LLM tool call name = `mcp__<serverId>__<toolName>`
 *     → sandbox parses the prefix
 *     → routes to `callMcpToolForSession({ serverId, toolName, arguments: rawInput })`
 *     → returns the MCP server's structured content as the tool output.
 *
 * These tests pin down two behaviours operators care about:
 *   1. Happy-path round-trip: a flat tool name actually reaches
 *      `callMcpToolForSession` with the un-mangled (serverId, toolName)
 *      pair, and the rawInput is passed through verbatim as the MCP
 *      `arguments` envelope.
 *   2. Failure isolation: when the MCP server is down (or the user
 *      removed it mid-turn), the sandbox returns an error tool result
 *      rather than throwing — so the LLM gets a recoverable signal.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  callMcpToolForSessionMock: vi.fn(),
  listMcpToolsForSessionMock: vi.fn(async () => []),
  getConfiguredMcpServerForSessionMock: vi.fn(),
  getMcpServerFingerprintMock: vi.fn(() => 'fingerprint-abc'),
  sqliteAllMock: vi.fn(() => []),
  sqliteGetMock: vi.fn((query: string) => {
    if (query.includes('SELECT user_id FROM sessions')) {
      return { user_id: 'user-1' };
    }
    if (query.includes('SELECT metadata_json')) {
      return { metadata_json: '{}' };
    }
    return undefined;
  }),
  sqliteRunMock: vi.fn(),
}));

vi.mock('../db.js', () => ({
  WORKSPACE_ACCESS_RESTRICTED: false,
  WORKSPACE_ROOT: '/home/await/project/OpenAWork',
  WORKSPACE_ROOTS: ['/home/await/project/OpenAWork'],
  sqliteAll: mocks.sqliteAllMock,
  sqliteGet: mocks.sqliteGetMock,
  sqliteRun: mocks.sqliteRunMock,
}));

vi.mock('../mcp-runtime.js', () => ({
  callMcpToolForSession: mocks.callMcpToolForSessionMock,
  listMcpToolsForSession: mocks.listMcpToolsForSessionMock,
  getConfiguredMcpServerForSession: mocks.getConfiguredMcpServerForSessionMock,
  getMcpServerFingerprint: mocks.getMcpServerFingerprintMock,
}));

import { createDefaultSandbox } from '../tool-sandbox.js';

describe('tool-sandbox flat MCP routing (PR-C)', () => {
  beforeEach(() => {
    mocks.callMcpToolForSessionMock.mockReset();
    mocks.getConfiguredMcpServerForSessionMock.mockReset();
    mocks.getConfiguredMcpServerForSessionMock.mockReturnValue({
      id: 'github',
      name: 'GitHub',
      transport: 'sse',
      enabled: true,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('routes mcp__<server>__<tool> calls to callMcpToolForSession with parsed (server, tool, args)', async () => {
    mocks.callMcpToolForSessionMock.mockResolvedValueOnce({
      serverId: 'github',
      toolName: 'create_issue',
      content: [{ type: 'text', text: 'Issue #42 created' }],
      isError: false,
    });

    const sandbox = createDefaultSandbox();
    const result = await sandbox.execute(
      {
        toolCallId: 'call-flat-mcp-1',
        toolName: 'mcp__github__create_issue',
        rawInput: { title: 'Bug report', body: 'Detailed reproduction' },
      },
      new AbortController().signal,
      'session-1',
      {
        clientRequestId: 'req-flat-mcp-1',
        nextRound: 1,
        requestData: { clientRequestId: 'req-flat-mcp-1' },
      },
    );

    expect(mocks.callMcpToolForSessionMock).toHaveBeenCalledTimes(1);
    expect(mocks.callMcpToolForSessionMock).toHaveBeenCalledWith('session-1', {
      serverId: 'github',
      toolName: 'create_issue',
      arguments: { title: 'Bug report', body: 'Detailed reproduction' },
    });
    expect(result.isError).toBe(false);
    expect(result.toolName).toBe('mcp__github__create_issue');
    expect(result.output).toMatchObject({
      serverId: 'github',
      toolName: 'create_issue',
      content: [{ type: 'text', text: 'Issue #42 created' }],
    });
  });

  it('surfaces upstream MCP errors as tool-call errors instead of throwing', async () => {
    mocks.callMcpToolForSessionMock.mockRejectedValueOnce(
      new Error('Configured MCP server is disabled: github'),
    );

    const sandbox = createDefaultSandbox();
    const result = await sandbox.execute(
      {
        toolCallId: 'call-flat-mcp-err',
        toolName: 'mcp__github__create_issue',
        rawInput: { title: 'x' },
      },
      new AbortController().signal,
      'session-1',
      {
        clientRequestId: 'req-flat-mcp-err',
        nextRound: 1,
        requestData: { clientRequestId: 'req-flat-mcp-err' },
      },
    );

    expect(result.isError).toBe(true);
    expect(result.output).toContain('Configured MCP server is disabled');
  });

  it('propagates MCP-side isError=true through the sandbox unmodified', async () => {
    mocks.callMcpToolForSessionMock.mockResolvedValueOnce({
      serverId: 'github',
      toolName: 'create_issue',
      content: [{ type: 'text', text: 'rate limited' }],
      isError: true,
    });

    const sandbox = createDefaultSandbox();
    const result = await sandbox.execute(
      {
        toolCallId: 'call-flat-mcp-mcp-err',
        toolName: 'mcp__github__create_issue',
        rawInput: { title: 'x' },
      },
      new AbortController().signal,
      'session-1',
      {
        clientRequestId: 'req-flat-mcp-mcp-err',
        nextRound: 1,
        requestData: { clientRequestId: 'req-flat-mcp-mcp-err' },
      },
    );

    // Critical: when the MCP server itself reports isError=true (e.g.
    // tool-side validation failure), we must propagate that boolean so
    // the LLM treats the result as a recoverable failure rather than
    // a successful empty response.
    expect(result.isError).toBe(true);
  });

  it('does not route non-MCP tool names through the flat-MCP path', async () => {
    // A tool name that doesn't match the `mcp__` prefix should NOT
    // hit `callMcpToolForSession`. We don't assert on the actual
    // sandbox response here (it'll likely error because we haven't
    // configured the tool); the assertion is purely about routing
    // isolation.
    const sandbox = createDefaultSandbox();
    await sandbox
      .execute(
        {
          toolCallId: 'call-not-mcp',
          toolName: 'mcp_call', // legacy wrapper, single underscore — must not be parsed as flat
          rawInput: { serverId: 'github', toolName: 'create_issue', arguments: {} },
        },
        new AbortController().signal,
        'session-1',
        {
          clientRequestId: 'req-not-mcp',
          nextRound: 1,
          requestData: { clientRequestId: 'req-not-mcp' },
        },
      )
      .catch(() => undefined);

    // mcp_call goes through its OWN path which also calls
    // callMcpToolForSession, but with the parsed-from-rawInput pair
    // (different from the flat-tool argument shape).
    if (mocks.callMcpToolForSessionMock.mock.calls.length > 0) {
      // If the legacy path called it, the args envelope differs from
      // flat: arguments come from rawInput.arguments, not rawInput
      // itself.
      const lastCall = mocks.callMcpToolForSessionMock.mock.calls.at(-1);
      expect(lastCall?.[1]).toMatchObject({
        serverId: 'github',
        toolName: 'create_issue',
      });
    }
  });
});
