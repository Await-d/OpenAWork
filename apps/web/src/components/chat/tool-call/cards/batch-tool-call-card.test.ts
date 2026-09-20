/**
 * Regression tests for batch sub-tool status recovery after a page refresh.
 *
 * The bug: when a `batch` tool's output is large (e.g. several bash diffs +
 * long stdout), the gateway persists the output as a JSON *string* instead of
 * the structured `{ results: [...] }` object (see
 * `normalizeToolResultOutputForStorage`). After a refresh the batch card
 * received a string output, `subResults` resolved to `[]`, and every sub-call
 * row defaulted to a perpetual "running" spinner even though the batch had
 * long since completed.
 *
 * The fix:
 * 1. `parseBatchOutputString` parses a clean persisted output string back into
 *    the structured object so per-sub status is recovered.
 * 2. When the string is truncated (unparseable), `batchSubVisualState` falls
 *    back to the parent batch's terminal state instead of "running".
 */
import { describe, expect, it } from 'vitest';
import {
  batchSubVisualState,
  parseBatchOutputString,
  type BatchSubResultLike,
} from './batch-tool-call-card.js';

describe('parseBatchOutputString', () => {
  it('parses a clean persisted batch output string into an object', () => {
    const obj = {
      results: [
        { tool: 'bash', isError: false, output: { command: 'ls', exitCode: 0 } },
        { tool: 'bash', isError: false, output: { command: 'pwd', exitCode: 0 } },
      ],
    };
    const parsed = parseBatchOutputString(JSON.stringify(obj));
    expect(parsed).toEqual(obj);
  });

  it('returns null for a truncated / unparseable string', () => {
    const truncated = '{"results":[{"tool":"bash","isError":false,"output":{"command":"ls';
    expect(parseBatchOutputString(truncated)).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(parseBatchOutputString('')).toBeNull();
    expect(parseBatchOutputString('   ')).toBeNull();
  });
});

describe('batchSubVisualState', () => {
  it('returns the per-sub status when result data is present', () => {
    const completed: BatchSubResultLike = { index: 0, tool: 'bash', status: 'completed' };
    const failed: BatchSubResultLike = { index: 1, tool: 'bash', status: 'error' };
    expect(batchSubVisualState(completed)).toBe('completed');
    expect(batchSubVisualState(failed)).toBe('failed');
  });

  it('defaults to running when no result and parent still running', () => {
    expect(batchSubVisualState(undefined)).toBe('running');
    expect(batchSubVisualState(undefined, undefined)).toBe('running');
  });

  it('falls back to parent terminal state when no result (truncated output)', () => {
    // This is the core fix: a finished batch whose output string was
    // truncated must not leave its sub-rows spinning forever.
    expect(batchSubVisualState(undefined, 'completed')).toBe('completed');
    expect(batchSubVisualState(undefined, 'failed')).toBe('failed');
  });

  it('per-sub result still wins over parent terminal state', () => {
    const running: BatchSubResultLike = { index: 0, tool: 'bash', status: 'running' };
    // Even if parent says completed, an explicit running sub stays running
    // (live-stream correctness — parent fallback only applies to missing data)
    expect(batchSubVisualState(running, 'completed')).toBe('running');
  });

  it('keeps the four existing states unchanged', () => {
    expect(batchSubVisualState(undefined)).toBe('running');
    expect(batchSubVisualState({ index: 0, tool: 'bash', status: 'running' })).toBe('running');
    expect(batchSubVisualState({ index: 0, tool: 'bash', status: 'completed' })).toBe('completed');
    expect(batchSubVisualState({ index: 0, tool: 'bash', status: 'error' })).toBe('failed');
    expect(batchSubVisualState({ index: 0, tool: 'edit', status: 'skipped' })).toBe('skipped');
  });
});

describe('batchSubVisualState pending-permission classification', () => {
  const pendingPermissionOutputs = [
    'Tool "bash" requires approval before it can run. Permission request req-1 has been created. Ask the user to approve it, then retry.',
    'Tool "bash" is waiting for approval. Permission request req-1 is still pending. Ask the user to approve it, then retry.',
    '等待审批：bash 需要用户授权后重试',
  ];

  it.each(pendingPermissionOutputs)('classifies %s as pending', (output) => {
    const result: BatchSubResultLike = {
      index: 0,
      tool: 'bash',
      status: 'error',
      isError: true,
      output,
    };
    expect(batchSubVisualState(result)).toBe('pending');
  });

  it('keeps a plain error output as failed', () => {
    const result: BatchSubResultLike = {
      index: 0,
      tool: 'bash',
      status: 'error',
      isError: true,
      output: 'command not found: pnpm',
    };
    expect(batchSubVisualState(result)).toBe('failed');
  });

  it('does not fire pending detection for non-error results', () => {
    const completed: BatchSubResultLike = {
      index: 0,
      tool: 'bash',
      status: 'completed',
      isError: false,
      output: 'waiting for approval',
    };
    const running: BatchSubResultLike = {
      index: 1,
      tool: 'bash',
      status: 'running',
      output: 'waiting for approval',
    };
    expect(batchSubVisualState(completed)).toBe('completed');
    expect(batchSubVisualState(running)).toBe('running');
  });

  it('stringifies non-string outputs safely before matching', () => {
    const structured: BatchSubResultLike = {
      index: 0,
      tool: 'bash',
      status: 'error',
      isError: true,
      output: { message: 'requires approval', requestId: 'req-9' },
    };
    expect(batchSubVisualState(structured)).toBe('pending');

    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const circularResult: BatchSubResultLike = {
      index: 1,
      tool: 'bash',
      status: 'error',
      isError: true,
      output: circular,
    };
    expect(batchSubVisualState(circularResult)).toBe('failed');
  });
});
