import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  ToolRegistry,
  ToolNotFoundError,
  ToolValidationError,
  ToolTimeoutError,
} from '../tool-contract.js';
import type { ToolDefinition } from '../tool-contract.js';

const echoTool: ToolDefinition<
  z.ZodObject<{ msg: z.ZodString }>,
  z.ZodObject<{ echo: z.ZodString }>
> = {
  name: 'echo',
  description: 'echoes input',
  inputSchema: z.object({ msg: z.string() }),
  outputSchema: z.object({ echo: z.string() }),
  execute: async (input) => ({ echo: input.msg }),
};

describe('ToolRegistry: register & list', () => {
  it('lists registered tools', () => {
    const registry = new ToolRegistry();
    registry.register(echoTool);
    expect(registry.list()).toHaveLength(1);
    expect(registry.list()[0]?.name).toBe('echo');
  });

  it('get returns tool by name', () => {
    const registry = new ToolRegistry();
    registry.register(echoTool);
    expect(registry.get('echo')).toBeDefined();
  });

  it('get returns undefined for unknown tool', () => {
    const registry = new ToolRegistry();
    expect(registry.get('unknown')).toBeUndefined();
  });

  it('unregister removes tool', () => {
    const registry = new ToolRegistry();
    registry.register(echoTool);
    registry.unregister('echo');
    expect(registry.list()).toHaveLength(0);
  });
});

describe('ToolRegistry: execute success', () => {
  it('executes tool and returns validated output', async () => {
    const registry = new ToolRegistry();
    registry.register(echoTool);
    const signal = new AbortController().signal;
    const result = await registry.execute(
      { toolCallId: 'tc1', toolName: 'echo', rawInput: { msg: 'hello' } },
      signal,
    );
    expect(result.isError).toBe(false);
    expect(result.output).toEqual({ echo: 'hello' });
    expect(result.toolCallId).toBe('tc1');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe('ToolRegistry: execute errors', () => {
  it('throws ToolNotFoundError for unknown tool', async () => {
    const registry = new ToolRegistry();
    const signal = new AbortController().signal;
    await expect(
      registry.execute({ toolCallId: 'tc1', toolName: 'unknown', rawInput: {} }, signal),
    ).rejects.toBeInstanceOf(ToolNotFoundError);
  });

  it('throws ToolValidationError for invalid input', async () => {
    const registry = new ToolRegistry();
    registry.register(echoTool);
    const signal = new AbortController().signal;
    await expect(
      registry.execute({ toolCallId: 'tc1', toolName: 'echo', rawInput: { msg: 42 } }, signal),
    ).rejects.toBeInstanceOf(ToolValidationError);
  });

  it('includes the missing field path in validation errors', async () => {
    const registry = new ToolRegistry();
    registry.register(echoTool);
    const signal = new AbortController().signal;

    await expect(
      registry.execute({ toolCallId: 'tc1', toolName: 'echo', rawInput: {} }, signal),
    ).rejects.toThrow('msg: Required');
  });

  it('returns isError=true when execute throws', async () => {
    const registry = new ToolRegistry();
    const failTool: ToolDefinition<z.ZodObject<{ x: z.ZodString }>, z.ZodString> = {
      name: 'fail',
      description: 'always fails',
      inputSchema: z.object({ x: z.string() }),
      outputSchema: z.string(),
      execute: async () => {
        throw new Error('boom');
      },
    };
    registry.register(failTool);
    const signal = new AbortController().signal;
    const result = await registry.execute(
      { toolCallId: 'tc2', toolName: 'fail', rawInput: { x: 'test' } },
      signal,
    );
    expect(result.isError).toBe(true);
    expect(result.output).toBe('boom');
  });

  it('throws ToolTimeoutError when timeout exceeded', async () => {
    const registry = new ToolRegistry();
    const slowTool: ToolDefinition<z.ZodObject<{ x: z.ZodString }>, z.ZodString> = {
      name: 'slow',
      description: 'slow tool',
      inputSchema: z.object({ x: z.string() }),
      outputSchema: z.string(),
      timeout: 50,
      execute: async (_, signal) => {
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(resolve, 500);
          signal.addEventListener('abort', () => {
            clearTimeout(t);
            reject(new Error('aborted'));
          });
        });
        return 'done';
      },
    };
    registry.register(slowTool);
    const signal = new AbortController().signal;
    await expect(
      registry.execute({ toolCallId: 'tc3', toolName: 'slow', rawInput: { x: 'y' } }, signal),
    ).rejects.toBeInstanceOf(ToolTimeoutError);
  }, 2000);
});
