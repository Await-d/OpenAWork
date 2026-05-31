import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type * as MessageStoreV2 from '../../message/message-store-v2.js';

// Regression (§0.94-class, execution layer): the `batch` tool runs each
// sub-call via `Promise.all(...map(sandbox.execute))`. `sandbox.execute` has
// throw surfaces BEFORE the registry try/catch (permission checks,
// transitionToolToRunning, inline edit/skill branches). Without a per-sub-call
// guard, one throwing sub-tool rejected the whole Promise.all and failed the
// ENTIRE batch — defeating the batch tool's purpose of collecting N results.
// transitionToolToRunning is mocked to throw for the index-0 sub-call to
// deterministically reproduce a mid-execute throw.

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

describe('batch tool per-sub-call resilience', () => {
  beforeEach(() => {
    mocks.transitionToolToRunningMock.mockReset();
  });

  it('单个子工具执行抛错时其余子工具仍完成，整批不被 reject', async () => {
    const { ToolSandbox } = await import('../../tools/tool-sandbox.js');

    // The index-0 sub-call (callID ends with ":0") throws inside execute;
    // every other transition (top-level batch call + ":1") succeeds.
    mocks.transitionToolToRunningMock.mockImplementation((input: { callID: string }) => {
      if (input.callID.endsWith(':0')) {
        throw new Error('simulated mid-execute throw');
      }
    });

    const toolExecute = vi.fn(async () => ({ output: 'ok', isError: false, durationMs: 1 }));

    const sandbox = new ToolSandbox({
      allowedTools: ['unit_tool', 'batch'],
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
        toolCallId: 'call-batch',
        toolName: 'batch',
        rawInput: {
          tool_calls: [
            { tool: 'unit_tool', parameters: { value: 'a' } },
            { tool: 'unit_tool', parameters: { value: 'b' } },
          ],
        },
      },
      new AbortController().signal,
      'session-1',
    );

    const output = result.output as {
      results: Array<{ isError: boolean; output: string }>;
      total: number;
    };
    expect(output.total).toBe(2);
    // index-0 degraded to an error result (threw), index-1 completed normally.
    expect(output.results[0]?.isError).toBe(true);
    expect(output.results[0]?.output).toContain('threw');
    expect(output.results[1]?.isError).toBe(false);
    // The batch as a whole reports isError (one sub-tool failed) but did NOT reject.
    expect(result.isError).toBe(true);
    // The good sub-tool actually executed.
    expect(toolExecute).toHaveBeenCalledTimes(1);
  }, 15_000);
});
