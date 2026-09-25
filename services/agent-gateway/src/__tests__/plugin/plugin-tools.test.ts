/**
 * Plugin-contributed tools (`ctx.tool.transform`).
 *
 * Pins down:
 *   1. Tools registered through `tool.transform` appear in the registry
 *      and disappear when the plugin is deactivated.
 *   2. Registration guards: built-in name collisions, invalid names and
 *      duplicate names are rejected.
 *   3. `buildGatewayToolDefinitions` appends plugin tools to the
 *      model-visible surface.
 *   4. `executePluginTool` runs the plugin executor and converts thrown
 *      errors into `isError` results.
 *   5. End-to-end: the sandbox whitelists and dispatches plugin tools
 *      (permission gating runs upstream; `yolo` here skips the ask).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  callMcpToolForSessionMock: vi.fn(),
  listMcpToolsForSessionMock: vi.fn(async () => []),
  getConfiguredMcpServerForSessionMock: vi.fn(),
  getMcpServerFingerprintMock: vi.fn(() => 'fp'),
  sqliteAllMock: vi.fn(() => []),
  sqliteGetMock: vi.fn(
    (query: string): { user_id: string } | { metadata_json: string } | undefined => {
      if (query.includes('SELECT user_id FROM sessions')) return { user_id: 'user-1' };
      if (query.includes('SELECT metadata_json')) return { metadata_json: '{"yoloMode":true}' };
      return undefined;
    },
  ),
  sqliteRunMock: vi.fn(),
}));

vi.mock('../../infra/db.js', () => ({
  WORKSPACE_ACCESS_RESTRICTED: false,
  WORKSPACE_ROOT: '/home/await/project/OpenAWork',
  WORKSPACE_ROOTS: ['/home/await/project/OpenAWork'],
  sqliteAll: mocks.sqliteAllMock,
  sqliteGet: mocks.sqliteGetMock,
  sqliteRun: mocks.sqliteRunMock,
  sqliteRunWithRowId: vi.fn(() => 1),
}));

vi.mock('../../mcp/mcp-runtime.js', () => ({
  callMcpToolForSession: mocks.callMcpToolForSessionMock,
  listMcpToolsForSession: mocks.listMcpToolsForSessionMock,
  getConfiguredMcpServerForSession: mocks.getConfiguredMcpServerForSessionMock,
  getMcpServerFingerprint: mocks.getMcpServerFingerprintMock,
}));

import type { PluginToolDefinition } from '@openAwork/plugin-sdk';
import { define as definePromise } from '@openAwork/plugin-sdk';
import { getPluginRegistry } from '../../plugin/registry.js';
import { executePluginTool, getPluginToolRegistry } from '../../plugin/tool-registry.js';
import { _resetPluginsForTest } from '../../runtime/plugin-host.js';
import { buildGatewayToolDefinitions } from '../../tools/tool-definitions.js';
import { createDefaultSandbox } from '../../tools/tool-sandbox.js';

const echoTool: PluginToolDefinition = {
  name: 'plugin_echo',
  description: 'Echo the provided text.',
  input: {
    type: 'object',
    properties: { text: { type: 'string' } },
    required: ['text'],
  },
  execute: (input) => ({ output: `echo: ${String((input as { text?: unknown }).text)}` }),
};

describe('plugin tool registration', () => {
  beforeEach(() => {
    _resetPluginsForTest();
  });

  afterEach(() => {
    _resetPluginsForTest();
  });

  it('registers tools through ctx.tool.transform and removes them on deactivate', async () => {
    const registry = getPluginRegistry();
    await registry.activate(
      definePromise({
        id: 'tool-plugin',
        setup(ctx) {
          ctx.tool.transform((editor) => {
            editor.add(echoTool);
          });
        },
      }),
      { source: 'test' },
    );

    expect(getPluginToolRegistry().has('plugin_echo')).toBe(true);
    expect(
      getPluginToolRegistry()
        .list()
        .map((tool) => tool.name),
    ).toContain('plugin_echo');

    await registry.deactivate('tool-plugin');
    expect(getPluginToolRegistry().has('plugin_echo')).toBe(false);
  });

  it('rejects built-in collisions, invalid names and duplicates', () => {
    const registry = getPluginToolRegistry();
    expect(() => registry.register('p', { ...echoTool, name: 'bash' })).toThrow(
      /collides with a built-in/,
    );
    expect(() => registry.register('p', { ...echoTool, name: '1bad' })).toThrow(
      /Invalid plugin tool name/,
    );

    registry.register('p', echoTool);
    expect(() => registry.register('q', echoTool)).toThrow(/already registered/);
  });

  it('appends plugin tools to the model-visible definitions', () => {
    getPluginToolRegistry().register('p', echoTool);
    const names = buildGatewayToolDefinitions().map((tool) => tool.function.name);
    expect(names).toContain('plugin_echo');
  });

  it('executes plugin tools and reports thrown errors as isError results', async () => {
    const registry = getPluginToolRegistry();
    registry.register('p', echoTool);
    const tool = registry.get('plugin_echo');
    if (!tool) throw new Error('expected plugin_echo to be registered');

    const result = await executePluginTool({
      tool,
      request: { toolCallId: 'c1', toolName: 'plugin_echo', rawInput: { text: 'hi' } },
      sessionId: 's1',
      signal: new AbortController().signal,
    });
    expect(result.output).toBe('echo: hi');
    expect(result.isError).toBe(false);

    registry.register('p2', {
      ...echoTool,
      name: 'plugin_boom',
      execute: () => {
        throw new Error('boom');
      },
    });
    const boom = registry.get('plugin_boom');
    if (!boom) throw new Error('expected plugin_boom to be registered');

    const failed = await executePluginTool({
      tool: boom,
      request: { toolCallId: 'c2', toolName: 'plugin_boom', rawInput: {} },
      sessionId: 's1',
      signal: new AbortController().signal,
    });
    expect(failed.isError).toBe(true);
    expect(String(failed.output)).toContain('boom');
  });
});

describe('plugin tool sandbox dispatch', () => {
  beforeEach(() => {
    _resetPluginsForTest();
  });

  afterEach(() => {
    _resetPluginsForTest();
  });

  it('runs a plugin tool end-to-end through the sandbox', async () => {
    getPluginToolRegistry().register('p', echoTool);
    const sandbox = createDefaultSandbox();
    const result = await sandbox.execute(
      { toolCallId: 'call-1', toolName: 'plugin_echo', rawInput: { text: 'hello' } },
      new AbortController().signal,
      'session-1',
      { clientRequestId: 'req-1', nextRound: 1, requestData: { clientRequestId: 'req-1' } },
    );

    expect(result.isError).toBe(false);
    expect(result.output).toBe('echo: hello');
  });
});
