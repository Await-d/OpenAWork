import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { ToolDefinition } from '@openAwork/agent-core';
import { wrapToolForAiSdk, wrapToolsForAiSdk } from '../../v2-runtime/upstream/index.js';

// A representative ToolDefinition that mirrors what the OpenAWork
// tool registry actually ships (zod input schema, async execute,
// signal forwarded to the body).
const echoTool: ToolDefinition = {
  name: 'echo',
  description: 'Return the input string unchanged.',
  inputSchema: z.object({ value: z.string() }),
  outputSchema: z.object({ echoed: z.string() }),
  execute: async (input) => ({ echoed: (input as { value: string }).value }),
};

const addTool: ToolDefinition = {
  name: 'add',
  description: 'Sum two numbers.',
  inputSchema: z.object({ a: z.number(), b: z.number() }),
  outputSchema: z.object({ sum: z.number() }),
  execute: async (input) => {
    const { a, b } = input as { a: number; b: number };
    return { sum: a + b };
  },
};

describe('wrapToolForAiSdk', () => {
  it('preserves description and exposes the same input schema', () => {
    const wrapped = wrapToolForAiSdk(echoTool);
    expect(wrapped.description).toBe('Return the input string unchanged.');
    expect(wrapped.inputSchema).toBe(echoTool.inputSchema);
  });

  it('forwards the execute call (and its output) to the original tool', async () => {
    const wrapped = wrapToolForAiSdk(echoTool);
    if (!wrapped.execute) {
      throw new Error('expected wrapped tool to have execute');
    }
    const result = await wrapped.execute(
      { value: 'hello' },
      { toolCallId: 't1', messages: [], context: {} },
    );
    expect(result).toEqual({ echoed: 'hello' });
  });

  it('passes the AbortSignal through when AI SDK provides one', async () => {
    let observedSignal: AbortSignal | undefined;
    const probe: ToolDefinition = {
      ...echoTool,
      execute: async (input, signal) => {
        observedSignal = signal;
        return { echoed: (input as { value: string }).value };
      },
    };
    const wrapped = wrapToolForAiSdk(probe);
    if (!wrapped.execute) throw new Error('expected execute');
    const ac = new AbortController();
    await wrapped.execute(
      { value: 'x' },
      { toolCallId: 't1', messages: [], context: {}, abortSignal: ac.signal },
    );
    expect(observedSignal).toBe(ac.signal);
  });

  it('synthesises a no-op AbortSignal when AI SDK omits one', async () => {
    let observedSignal: AbortSignal | undefined;
    const probe: ToolDefinition = {
      ...echoTool,
      execute: async (input, signal) => {
        observedSignal = signal;
        return { echoed: (input as { value: string }).value };
      },
    };
    const wrapped = wrapToolForAiSdk(probe);
    if (!wrapped.execute) throw new Error('expected execute');
    await wrapped.execute({ value: 'x' }, { toolCallId: 't1', messages: [], context: {} });
    expect(observedSignal).toBeInstanceOf(AbortSignal);
    expect(observedSignal?.aborted).toBe(false);
  });
});

describe('wrapToolsForAiSdk', () => {
  it('builds a ToolSet keyed by tool name', () => {
    const set = wrapToolsForAiSdk([echoTool, addTool]);
    expect(Object.keys(set)).toEqual(['echo', 'add']);
    expect(set['echo']).toBeDefined();
    expect(set['add']).toBeDefined();
  });

  it('uses last-write-wins on duplicate names', () => {
    const replacement: ToolDefinition = {
      ...echoTool,
      description: 'overridden',
      execute: async () => ({ echoed: 'replaced' }),
    };
    const set = wrapToolsForAiSdk([echoTool, replacement]);
    expect(set['echo']?.description).toBe('overridden');
  });
});
