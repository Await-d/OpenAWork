import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { ToolDefinition } from '@openAwork/agent-core';
import { wrapToolForNative, wrapToolsForNative } from '../../v2-runtime/upstream/index.js';

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

describe('wrapToolForNative', () => {
  it('converts the tool declaration to a native JSON schema', () => {
    const wrapped = wrapToolForNative(echoTool);
    expect(wrapped.name).toBe('echo');
    expect(wrapped.description).toBe('Return the input string unchanged.');
    expect(wrapped.inputSchema).toMatchObject({
      type: 'object',
      required: ['value'],
    });
  });
});

describe('wrapToolsForNative', () => {
  it('builds a native tool set keyed by tool name', () => {
    const set = wrapToolsForNative([echoTool, addTool]);
    expect(Object.keys(set)).toEqual(['echo', 'add']);
    expect(set['echo']?.name).toBe('echo');
    expect(set['add']?.name).toBe('add');
  });

  it('uses last-write-wins on duplicate names', () => {
    const replacement: ToolDefinition = {
      ...echoTool,
      description: 'overridden',
      execute: async () => ({ echoed: 'replaced' }),
    };
    const set = wrapToolsForNative([echoTool, replacement]);
    expect(set['echo']?.description).toBe('overridden');
  });
});
