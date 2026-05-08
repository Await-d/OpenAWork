import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type * as MessageStoreV2 from '../message-store-v2.js';

const mocks = vi.hoisted(() => ({
  transitionToolToRunningMock: vi.fn(),
}));

vi.mock('../db.js', () => ({
  WORKSPACE_ROOT: '/home/await/project/OpenAWork',
  WORKSPACE_ACCESS_RESTRICTED: false,
  WORKSPACE_ROOTS: ['/home/await/project/OpenAWork'],
  sqliteAll: vi.fn(() => []),
  sqliteGet: vi.fn((query: string) =>
    query.includes('SELECT user_id FROM sessions') ? { user_id: 'user-1' } : undefined,
  ),
  sqliteRun: vi.fn(() => undefined),
}));

vi.mock('../message-store-v2.js', async () => {
  const actual = await vi.importActual<typeof MessageStoreV2>('../message-store-v2.js');
  return {
    ...actual,
    transitionToolToRunning: mocks.transitionToolToRunningMock,
  };
});

describe('ToolSandbox.execute', () => {
  beforeEach(() => {
    mocks.transitionToolToRunningMock.mockReset();
  });

  it('transitions to running after permission checks and before tool execution', async () => {
    const { ToolSandbox } = await import('../tool-sandbox.js');

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
});
