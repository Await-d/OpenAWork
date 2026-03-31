import { describe, expect, it } from 'vitest';
import { dispatchClaudeCodeTool } from '../claude-code-tool-dispatch.js';

describe('dispatchClaudeCodeTool', () => {
  it('normalizes Edit input from Claude Code field names', () => {
    const result = dispatchClaudeCodeTool('Edit', {
      file_path: '/tmp/example.ts',
      old_string: 'before',
      new_string: 'after',
      replace_all: true,
    });

    expect(result).toEqual({
      kind: 'resolved',
      normalized: {
        canonicalName: 'edit',
        normalizedFields: {
          filePath: '/tmp/example.ts',
          oldString: 'before',
          newString: 'after',
          replaceAll: true,
        },
        remapped: true,
      },
    });
  });

  it('normalizes TaskGet and TaskUpdate identifiers', () => {
    expect(dispatchClaudeCodeTool('TaskGet', { taskId: 'task-1' })).toEqual({
      kind: 'resolved',
      normalized: {
        canonicalName: 'task_get',
        normalizedFields: { id: 'task-1' },
        remapped: true,
      },
    });

    expect(
      dispatchClaudeCodeTool('TaskUpdate', {
        taskId: 'task-2',
        status: 'in_progress',
        activeForm: 'working',
      }),
    ).toEqual({
      kind: 'resolved',
      normalized: {
        canonicalName: 'task_update',
        normalizedFields: {
          id: 'task-2',
          status: 'in_progress',
          metadata: { activeForm: 'working' },
        },
        remapped: true,
      },
    });
  });

  it('drops unsupported Bash extras and keeps supported fields', () => {
    const result = dispatchClaudeCodeTool('Bash', {
      command: 'pnpm test',
      timeout: 120000,
      description: 'Run tests',
      run_in_background: false,
    });

    expect(result).toEqual({
      kind: 'resolved',
      normalized: {
        canonicalName: 'bash',
        normalizedFields: {
          command: 'pnpm test',
          timeout: 120000,
        },
        remapped: true,
      },
    });
  });

  it('returns unsupported for low-compat tools', () => {
    const result = dispatchClaudeCodeTool('WebFetch', {
      url: 'https://example.com',
      prompt: 'Summarize the page',
    });

    expect(result.kind).toBe('unsupported');
    if (result.kind === 'unsupported') {
      expect(result.result.presentedName).toBe('WebFetch');
      expect(result.result.hint).toContain('prompt-driven semantics');
    }
  });
});
