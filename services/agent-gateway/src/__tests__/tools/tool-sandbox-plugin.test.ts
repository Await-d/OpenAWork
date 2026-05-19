/**
 * Coverage for plugin hook integration in `tool-sandbox.ts`
 * (PR-D-Plugin.3). Validates that:
 *
 *   1. `tool.execute.before` mutations to `args` actually reach the
 *      tool's underlying execute() — i.e. the wrapper isn't silently
 *      dropping the rewrite.
 *   2. `tool.execute.after` mutations to `output` / `metadata.isError`
 *      flow back into the `ToolCallResult` returned by the sandbox.
 *   3. A throwing plugin doesn't break the sandbox call.
 *
 * We use `mcp_call`'s flat-MCP routing path as the test vehicle
 * because it has the simplest mock surface (just `callMcpToolForSession`).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  callMcpToolForSessionMock: vi.fn(),
  listMcpToolsForSessionMock: vi.fn(async () => []),
  getConfiguredMcpServerForSessionMock: vi.fn(),
  getMcpServerFingerprintMock: vi.fn(() => 'fp'),
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

vi.mock('../../infra/db.js', () => ({
  WORKSPACE_ACCESS_RESTRICTED: false,
  WORKSPACE_ROOT: '/home/await/project/OpenAWork',
  WORKSPACE_ROOTS: ['/home/await/project/OpenAWork'],
  sqliteAll: mocks.sqliteAllMock,
  sqliteGet: mocks.sqliteGetMock,
  sqliteRun: mocks.sqliteRunMock,
}));

vi.mock('../../mcp/mcp-runtime.js', () => ({
  callMcpToolForSession: mocks.callMcpToolForSessionMock,
  listMcpToolsForSession: mocks.listMcpToolsForSessionMock,
  getConfiguredMcpServerForSession: mocks.getConfiguredMcpServerForSessionMock,
  getMcpServerFingerprint: mocks.getMcpServerFingerprintMock,
}));

import { createDefaultSandbox } from '../../tools/tool-sandbox.js';
import { _registerPluginForTest, _resetPluginsForTest } from '../../runtime/plugin-host.js';

describe('tool-sandbox plugin hook integration (PR-D-Plugin)', () => {
  beforeEach(() => {
    _resetPluginsForTest();
    mocks.callMcpToolForSessionMock.mockReset();
    mocks.getConfiguredMcpServerForSessionMock.mockReturnValue({
      id: 'github',
      name: 'GitHub',
      transport: 'sse',
      enabled: true,
    });
  });

  afterEach(() => {
    _resetPluginsForTest();
    vi.clearAllMocks();
  });

  it('tool.execute.before mutations to args reach the underlying tool', async () => {
    _registerPluginForTest('test', {
      'tool.execute.before': (_input, output) => {
        const args = output.args as Record<string, unknown>;
        // Plugin redacts a sensitive field before the tool sees it.
        output.args = { ...args, title: '[REDACTED]' };
      },
    });
    mocks.callMcpToolForSessionMock.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'ok' }],
      isError: false,
    });

    const sandbox = createDefaultSandbox();
    await sandbox.execute(
      {
        toolCallId: 'call-1',
        toolName: 'mcp__github__create_issue',
        rawInput: { title: 'real title', body: 'detail' },
      },
      new AbortController().signal,
      'session-1',
      {
        clientRequestId: 'req-1',
        nextRound: 1,
        requestData: { clientRequestId: 'req-1' },
      },
    );

    // The tool actually saw the mutated args, not the originals.
    expect(mocks.callMcpToolForSessionMock).toHaveBeenCalledWith('session-1', {
      serverId: 'github',
      toolName: 'create_issue',
      arguments: { title: '[REDACTED]', body: 'detail' },
    });
  });

  it('tool.execute.after mutations to output flow back to the caller', async () => {
    _registerPluginForTest('test', {
      'tool.execute.after': (_input, output) => {
        // Plugin appends a marker to whatever the tool returned.
        output.output = { wrapped: true, original: output.output };
      },
    });
    mocks.callMcpToolForSessionMock.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'tool-output' }],
      isError: false,
    });

    const sandbox = createDefaultSandbox();
    const result = await sandbox.execute(
      {
        toolCallId: 'call-2',
        toolName: 'mcp__github__create_issue',
        rawInput: { title: 'x' },
      },
      new AbortController().signal,
      'session-1',
      {
        clientRequestId: 'req-2',
        nextRound: 1,
        requestData: { clientRequestId: 'req-2' },
      },
    );

    expect(result.output).toMatchObject({
      wrapped: true,
      original: expect.objectContaining({
        content: [{ type: 'text', text: 'tool-output' }],
      }),
    });
  });

  it('tool.execute.after can flip isError to true via metadata', async () => {
    _registerPluginForTest('test', {
      'tool.execute.after': (_input, output) => {
        output.metadata['isError'] = true;
      },
    });
    mocks.callMcpToolForSessionMock.mockResolvedValueOnce({
      content: [],
      isError: false,
    });

    const sandbox = createDefaultSandbox();
    const result = await sandbox.execute(
      {
        toolCallId: 'call-3',
        toolName: 'mcp__github__create_issue',
        rawInput: {},
      },
      new AbortController().signal,
      'session-1',
      {
        clientRequestId: 'req-3',
        nextRound: 1,
        requestData: { clientRequestId: 'req-3' },
      },
    );

    expect(result.isError).toBe(true);
  });

  it('a throwing plugin does not break the tool call', async () => {
    _registerPluginForTest('crashy', {
      'tool.execute.before': () => {
        throw new Error('plugin crashed');
      },
    });
    mocks.callMcpToolForSessionMock.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'still works' }],
      isError: false,
    });

    const sandbox = createDefaultSandbox();
    const result = await sandbox.execute(
      {
        toolCallId: 'call-4',
        toolName: 'mcp__github__create_issue',
        rawInput: { x: 1 },
      },
      new AbortController().signal,
      'session-1',
      {
        clientRequestId: 'req-4',
        nextRound: 1,
        requestData: { clientRequestId: 'req-4' },
      },
    );

    // Tool still ran with the original (un-mutated) args.
    expect(mocks.callMcpToolForSessionMock).toHaveBeenCalled();
    expect(result.isError).toBe(false);
    expect(result.output).toMatchObject({
      content: [{ type: 'text', text: 'still works' }],
    });
  });
});
