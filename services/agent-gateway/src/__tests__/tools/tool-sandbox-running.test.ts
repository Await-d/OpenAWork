import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type * as MessageStoreV2 from '../../message/message-store-v2.js';
import type * as WorkspaceToolsModule from '../../tools/workspace-tools.js';

const mocks = vi.hoisted(() => ({
  transitionToolToRunningMock: vi.fn(),
}));

vi.mock('../../infra/db.js', () => ({
  WORKSPACE_ROOT: '/home/await/project/OpenAWork',
  WORKSPACE_ACCESS_RESTRICTED: false,
  WORKSPACE_ROOTS: ['/home/await/project/OpenAWork'],
  sqliteAll: vi.fn(() => []),
  sqliteGet: vi.fn((query: string) =>
    query.includes('SELECT user_id FROM sessions') ? { user_id: 'user-1' } : undefined,
  ),
  sqliteRun: vi.fn(() => undefined),
}));

vi.mock('../../message/message-store-v2.js', async () => {
  const actual = await vi.importActual<typeof MessageStoreV2>('../../message/message-store-v2.js');
  return {
    ...actual,
    transitionToolToRunning: mocks.transitionToolToRunningMock,
  };
});

vi.mock('../../tools/workspace-tools.js', async () => {
  const actual = await vi.importActual<typeof WorkspaceToolsModule>(
    '../../tools/workspace-tools.js',
  );
  return {
    ...actual,
    listTool: {
      ...actual.listTool,
      execute: vi.fn(async (_input, signal: AbortSignal) => {
        await new Promise<never>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => reject(new Error('workspace list aborted by timeout')),
            { once: true },
          );
        });
      }),
    },
  };
});

describe('ToolSandbox.execute', () => {
  beforeEach(() => {
    mocks.transitionToolToRunningMock.mockReset();
  });

  it('transitions to running after permission checks and before tool execution', async () => {
    const { ToolSandbox } = await import('../../tools/tool-sandbox.js');

    const toolExecute = vi.fn(async () => ({
      output: 'ok',
      isError: false,
      durationMs: 1,
    }));

    const sandbox = new ToolSandbox({
      allowedTools: ['unit_tool'],
      defaultTimeoutMs: 1000,
    });
    sandbox.register({
      name: 'unit_tool',
      description: 'unit tool',
      inputSchema: z.object({ value: z.string() }),
      outputSchema: z.object({ output: z.string() }),
      execute: toolExecute,
    });

    const result = await sandbox.execute(
      {
        toolCallId: 'call-1',
        toolName: 'unit_tool',
        rawInput: { value: 'ok' },
      },
      new AbortController().signal,
      'session-1',
    );

    expect(result.isError).toBe(false);
    expect(mocks.transitionToolToRunningMock).toHaveBeenCalledWith({
      sessionId: 'session-1',
      userId: 'user-1',
      callID: 'call-1',
      title: 'unit_tool',
    });
    expect(toolExecute).toHaveBeenCalledTimes(1);
    const transitionOrder = mocks.transitionToolToRunningMock.mock.invocationCallOrder[0] ?? 0;
    const executeOrder = toolExecute.mock.invocationCallOrder[0] ?? 0;
    expect(transitionOrder).toBeLessThan(executeOrder);
  }, 15_000);

  it('keeps ToolRegistry timeout protection for gateway-managed workspace tools', async () => {
    const { createDefaultSandbox } = await import('../../tools/tool-sandbox.js');

    const sandbox = createDefaultSandbox();
    const result = await sandbox.execute(
      {
        toolCallId: 'call-list-timeout',
        toolName: 'list',
        rawInput: { path: '/home/await/project/OpenAWork', depth: 1 },
      },
      new AbortController().signal,
      'session-1',
    );

    expect(result.isError).toBe(true);
    expect(String(result.output)).toContain('Tool timed out after 10000ms');
  }, 15_000);

  it('Windows 会话带有 POSIX 工作区路径时将工具失败返回给调用方', async () => {
    const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');
    if (!platformDescriptor) {
      throw new Error('无法读取 Node.js platform 属性描述符');
    }

    Object.defineProperty(process, 'platform', { ...platformDescriptor, value: 'win32' });
    try {
      const { createDefaultSandbox } = await import('../../tools/tool-sandbox.js');
      const sandbox = createDefaultSandbox();

      const result = await sandbox.execute(
        {
          toolCallId: 'call-list-posix-on-windows',
          toolName: 'list',
          rawInput: { path: '/home/await/project/OpenAWork', depth: 1 },
        },
        new AbortController().signal,
        'session-1',
      );

      expect(result).toMatchObject({
        toolCallId: 'call-list-posix-on-windows',
        toolName: 'list',
        isError: true,
      });
      expect(String(result.output)).toContain('当前网关运行在 Windows，无法访问 POSIX 路径');
    } finally {
      Object.defineProperty(process, 'platform', platformDescriptor);
    }
  });
});
