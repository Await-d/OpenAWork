import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  ToolNotFoundError,
  ToolRegistry,
  ToolTimeoutError,
  ToolValidationError,
} from './tool-contract.js';

describe('ToolRegistry execution contract', () => {
  it('executes a validated tool and returns its validated output', async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'sum',
      description: 'sum numbers',
      inputSchema: z.object({ left: z.number(), right: z.number() }),
      outputSchema: z.object({ value: z.number() }),
      execute: async ({ left, right }) => ({ value: left + right }),
    });

    const result = await registry.execute(
      { toolCallId: 'call-1', toolName: 'sum', rawInput: { left: 2, right: 3 } },
      new AbortController().signal,
    );

    expect(result).toMatchObject({
      toolCallId: 'call-1',
      toolName: 'sum',
      output: { value: 5 },
      isError: false,
    });
  });

  it('rejects unknown tools and invalid inputs before execution', async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'read',
      description: 'read',
      inputSchema: z.object({ path: z.string().min(1) }),
      outputSchema: z.string(),
      execute: async ({ path }) => path,
    });

    await expect(
      registry.execute(
        { toolCallId: 'missing', toolName: 'missing', rawInput: {} },
        new AbortController().signal,
      ),
    ).rejects.toBeInstanceOf(ToolNotFoundError);
    await expect(
      registry.execute(
        { toolCallId: 'invalid', toolName: 'read', rawInput: { path: '' } },
        new AbortController().signal,
      ),
    ).rejects.toBeInstanceOf(ToolValidationError);
  });

  it('rejects output that violates the declared schema', async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'broken',
      description: 'broken',
      inputSchema: z.object({}),
      outputSchema: z.string().refine(() => false, 'invalid output'),
      execute: async () => 'invalid',
    });

    await expect(
      registry.execute(
        { toolCallId: 'output', toolName: 'broken', rawInput: {} },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ isError: true, toolName: 'broken' });
  });

  it('returns a timeout error result when execution exceeds the tool budget', async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'slow',
      description: 'slow',
      inputSchema: z.object({}),
      outputSchema: z.string(),
      timeout: 5,
      execute: async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return 'late';
      },
    });

    const result = await registry.dispatch(
      { type: 'tool_call', toolCallId: 'timeout', toolName: 'slow', input: {} },
      new AbortController().signal,
    );

    expect(result).toMatchObject({
      toolCallId: 'timeout',
      isError: true,
      output: new ToolTimeoutError('slow', 5).message,
    });
  });

  it('maps dispatch failures into a tool_result without rejecting the stream', async () => {
    const registry = new ToolRegistry();

    const result = await registry.dispatch(
      { type: 'tool_call', toolCallId: 'missing', toolName: 'missing', input: {} },
      new AbortController().signal,
    );

    expect(result).toMatchObject({
      type: 'tool_result',
      toolCallId: 'missing',
      isError: true,
      output: 'Tool "missing" not found',
    });
  });
});
