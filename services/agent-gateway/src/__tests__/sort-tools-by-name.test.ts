/**
 * Regression coverage for {@link sortToolsByName}.
 *
 * The serialised tool list is hashed into the prompt-cache key by
 * Anthropic, OpenAI Responses, and Bedrock. If the agent gateway
 * passes the same logical tool set in different iteration orders
 * across requests, every request becomes a cache miss. The sort
 * helper guarantees a stable order so the cache hit rate stays
 * high even when upstream loaders construct the tool record by
 * different paths.
 *
 * Mirrors opencode #26370 (`fix: ensure tools are always in same order`).
 */

import { describe, expect, it } from 'vitest';
import type { ToolSet } from 'ai';

import { sortToolsByName } from '../v2-runtime/upstream/stream-runner.js';

function fakeTool(name: string): ToolSet[string] {
  // The actual shape is irrelevant for the sort helper — we only
  // observe key order. Cast through `unknown` to avoid pulling in
  // the entire ToolSet entry type just for this test.
  return { description: name } as unknown as ToolSet[string];
}

describe('sortToolsByName', () => {
  it('returns undefined when input is undefined', () => {
    expect(sortToolsByName(undefined)).toBeUndefined();
  });

  it('returns an empty record when input is empty', () => {
    const sorted = sortToolsByName({});
    expect(sorted).not.toBeUndefined();
    expect(Object.keys(sorted as ToolSet)).toEqual([]);
  });

  it('orders entries by name using localeCompare', () => {
    const tools: ToolSet = {
      write: fakeTool('write'),
      read: fakeTool('read'),
      bash: fakeTool('bash'),
      grep: fakeTool('grep'),
    };

    const sorted = sortToolsByName(tools);
    expect(Object.keys(sorted as ToolSet)).toEqual(['bash', 'grep', 'read', 'write']);
  });

  it('produces the same key order regardless of insertion order', () => {
    const insertionA: ToolSet = {
      glob: fakeTool('glob'),
      ast_grep_search: fakeTool('ast_grep_search'),
      Bash: fakeTool('Bash'),
      websearch: fakeTool('websearch'),
    };
    const insertionB: ToolSet = {
      websearch: fakeTool('websearch'),
      Bash: fakeTool('Bash'),
      ast_grep_search: fakeTool('ast_grep_search'),
      glob: fakeTool('glob'),
    };

    expect(Object.keys(sortToolsByName(insertionA) as ToolSet)).toEqual(
      Object.keys(sortToolsByName(insertionB) as ToolSet),
    );
  });

  it('does not mutate the input record', () => {
    const tools: ToolSet = {
      zeta: fakeTool('zeta'),
      alpha: fakeTool('alpha'),
    };
    const beforeKeys = Object.keys(tools);
    sortToolsByName(tools);
    expect(Object.keys(tools)).toEqual(beforeKeys);
  });

  it('preserves the tool definitions associated with each name', () => {
    const tools: ToolSet = {
      write: fakeTool('write-def'),
      read: fakeTool('read-def'),
    };
    const sorted = sortToolsByName(tools) as Record<string, { description: string }>;
    expect(sorted['read']?.description).toBe('read-def');
    expect(sorted['write']?.description).toBe('write-def');
  });
});
