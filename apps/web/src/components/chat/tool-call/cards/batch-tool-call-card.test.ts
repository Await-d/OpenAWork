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
});
