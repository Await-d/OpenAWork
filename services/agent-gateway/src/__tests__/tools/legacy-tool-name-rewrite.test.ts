import { describe, expect, it } from 'vitest';
import {
  isLegacyToolName,
  rewriteLegacyToolRequest,
} from '../../tools/legacy-tool-name-rewrite.js';

describe('rewriteLegacyToolRequest', () => {
  it('passes through canonical names unchanged', () => {
    const out = rewriteLegacyToolRequest('read', { path: '/abs/file.txt', limit: 50 });
    expect(out.rewritten).toBe(false);
    expect(out.toolName).toBe('read');
    expect(out.rawInput).toEqual({ path: '/abs/file.txt', limit: 50 });
  });

  it('rewrites workspace_read_file to read and forwards offset/limit', () => {
    const out = rewriteLegacyToolRequest('workspace_read_file', {
      path: '/abs/file.txt',
      offset: 10,
      limit: 20,
    });
    expect(out.rewritten).toBe(true);
    expect(out.toolName).toBe('read');
    // workspace_read_file shares schema with read, so the input is forwarded
    // verbatim — `read` accepts both `path` and `filePath`.
    expect(out.rawInput).toEqual({ path: '/abs/file.txt', offset: 10, limit: 20 });
  });

  it('rewrites workspace_tree to list', () => {
    const out = rewriteLegacyToolRequest('workspace_tree', { path: '/abs', depth: 2 });
    expect(out.rewritten).toBe(true);
    expect(out.toolName).toBe('list');
    expect(out.rawInput).toEqual({ path: '/abs', depth: 2 });
  });

  it('rewrites workspace_write_file to write', () => {
    const out = rewriteLegacyToolRequest('workspace_write_file', {
      path: '/abs/file.txt',
      content: 'hello',
    });
    expect(out.rewritten).toBe(true);
    expect(out.toolName).toBe('write');
    expect(out.rawInput).toEqual({ path: '/abs/file.txt', content: 'hello' });
  });

  it('rewrites workspace_create_file to write (write upserts)', () => {
    const out = rewriteLegacyToolRequest('workspace_create_file', {
      path: '/abs/new.txt',
      content: 'hi',
    });
    expect(out.rewritten).toBe(true);
    expect(out.toolName).toBe('write');
    expect(out.rawInput).toEqual({ path: '/abs/new.txt', content: 'hi' });
  });

  it('rewrites workspace_search to grep with query → pattern remap', () => {
    const out = rewriteLegacyToolRequest('workspace_search', {
      path: '/abs',
      query: 'todo',
      maxResults: 30,
    });
    expect(out.rewritten).toBe(true);
    expect(out.toolName).toBe('grep');
    expect(out.rawInput).toEqual({
      path: '/abs',
      pattern: 'todo',
      head_limit: 30,
      output_mode: 'content',
    });
  });

  it('rewrites web_search to websearch', () => {
    const out = rewriteLegacyToolRequest('web_search', { query: 'foo' });
    expect(out.rewritten).toBe(true);
    expect(out.toolName).toBe('websearch');
    expect(out.rawInput).toEqual({ query: 'foo' });
  });

  it('rewrites the advertised execute_shell alias to the canonical bash tool', () => {
    const out = rewriteLegacyToolRequest('execute_shell', {
      command: 'node --version',
      workdir: '/abs',
      timeout: 120000,
    });
    expect(out.rewritten).toBe(true);
    expect(out.toolName).toBe('bash');
    expect(out.rawInput).toEqual({
      command: 'node --version',
      workdir: '/abs',
      timeout: 120000,
    });
  });

  it('keeps non-object inputs untouched (e.g. null) for non-search legacy names', () => {
    const out = rewriteLegacyToolRequest('workspace_read_file', null);
    expect(out.rewritten).toBe(true);
    expect(out.toolName).toBe('read');
    expect(out.rawInput).toBeNull();
  });

  describe('functions. namespace prefix', () => {
    it('rewrites functions.execute_shell to the canonical bash tool', () => {
      const out = rewriteLegacyToolRequest('functions.execute_shell', {
        command: 'node --version',
        workdir: '/abs',
        timeout: 120000,
      });
      expect(out.rewritten).toBe(true);
      expect(out.toolName).toBe('bash');
      expect(out.rawInput).toEqual({
        command: 'node --version',
        workdir: '/abs',
        timeout: 120000,
      });
    });

    it('rewrites other prefixed legacy names to their canonical forms', () => {
      const out = rewriteLegacyToolRequest('functions.workspace_read_file', {
        path: '/abs/file.txt',
      });
      expect(out.rewritten).toBe(true);
      expect(out.toolName).toBe('read');
      expect(out.rawInput).toEqual({ path: '/abs/file.txt' });
    });

    it('strips the prefix from non-legacy names so downstream dispatch sees the bare name', () => {
      const out = rewriteLegacyToolRequest('functions.Agent', { description: 'subtask' });
      expect(out.rewritten).toBe(true);
      expect(out.toolName).toBe('Agent');
      expect(out.rawInput).toEqual({ description: 'subtask' });
    });

    it('applies the workspace_search query → pattern remap to prefixed names', () => {
      const out = rewriteLegacyToolRequest('functions.workspace_search', {
        path: '/abs',
        query: 'todo',
      });
      expect(out.rewritten).toBe(true);
      expect(out.toolName).toBe('grep');
      expect(out.rawInput).toEqual({ path: '/abs', pattern: 'todo', output_mode: 'content' });
    });

    it('leaves bare names untouched (rewritten false)', () => {
      for (const name of ['read', 'bash', 'Agent', 'unknown_tool']) {
        const out = rewriteLegacyToolRequest(name, { path: '/abs' });
        expect(out.rewritten).toBe(false);
        expect(out.toolName).toBe(name);
        expect(out.rawInput).toEqual({ path: '/abs' });
      }
    });

    it('strips only a single prefix (functions.functions.x → functions.x)', () => {
      const out = rewriteLegacyToolRequest('functions.functions.execute_shell', {});
      expect(out.rewritten).toBe(true);
      expect(out.toolName).toBe('functions.execute_shell');
      expect(out.rawInput).toEqual({});
    });
  });
});

describe('isLegacyToolName', () => {
  it('detects every legacy alias and only those', () => {
    for (const name of [
      'web_search',
      'workspace_tree',
      'workspace_read_file',
      'workspace_search',
      'workspace_write_file',
      'workspace_create_file',
      'execute_shell',
    ]) {
      expect(isLegacyToolName(name)).toBe(true);
    }
    for (const name of ['read', 'write', 'grep', 'list', 'glob', 'unknown_tool']) {
      expect(isLegacyToolName(name)).toBe(false);
    }
  });
});
