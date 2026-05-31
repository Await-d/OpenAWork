/**
 * Regression tests for `slimMessagesForRecovery` batch/bash structure
 * preservation.
 *
 * Background: the recovery endpoint slims tool outputs to keep the payload
 * small. The generic object slimmer used to collapse any object whose
 * serialized form exceeded `SLIM_OUTPUT_TOTAL_MAX` (4000 chars) into a
 * truncated JSON *string*. For `batch` outputs (`{ results: [...] }`) this
 * destroyed the structure the frontend `BatchToolCallCard` relies on,
 * leaving every sub-row spinning forever after a refresh. Bash outputs
 * (`{ command, exitCode, stdout, stderr, diffs }`) lost their terminal
 * panes for the same reason.
 *
 * The fix keeps batch + bash shaped objects as objects (their long leaf
 * strings / diffs are still truncated), so the cards recover per-sub status
 * and the terminal view after a refresh.
 */
import { describe, expect, it } from 'vitest';
import type { Message } from '@openAwork/shared';
import { slimMessagesForRecovery } from '../../routes/session-route-helpers.js';

function toolResultMessage(output: unknown): Message {
  return {
    id: 'tool-msg-1',
    role: 'tool',
    createdAt: 1,
    content: [
      {
        type: 'tool_result',
        toolCallId: 'call-1',
        toolName: 'batch',
        output,
        isError: false,
      },
    ],
  } as Message;
}

function bigBashSubOutput(label: string) {
  return {
    command: `pnpm ${label}`,
    cwd: '/repo',
    exitCode: 0,
    stdout: 'x'.repeat(2000),
    stderr: '',
    diffs: [
      {
        file: 'package.json',
        before: 'a'.repeat(5000),
        after: 'b'.repeat(5000),
        additions: 0,
        deletions: 0,
        status: 'modified',
      },
    ],
  };
}

describe('slimMessagesForRecovery — batch output structure', () => {
  it('keeps the { results: [...] } object shape even when oversized', () => {
    // Three bash sub-results, each large enough that the whole batch output
    // serialized far exceeds the 4000-char total cap.
    const output = {
      results: [
        { tool: 'bash', isError: false, output: bigBashSubOutput('a') },
        { tool: 'bash', isError: false, output: bigBashSubOutput('b') },
        { tool: 'bash', isError: true, output: bigBashSubOutput('c') },
      ],
    };

    const [msg] = slimMessagesForRecovery([toolResultMessage(output)]);
    const result = msg!.content[0] as { output: unknown };
    const slimmed = result.output as Record<string, unknown>;

    // The fix: output stays an object (not a truncated JSON string).
    expect(typeof slimmed).toBe('object');
    expect(Array.isArray(slimmed)).toBe(false);
    expect(Array.isArray(slimmed.results)).toBe(true);

    const results = slimmed.results as Array<Record<string, unknown>>;
    expect(results).toHaveLength(3);
    // Per-sub status fields survive so the card recovers completed/failed.
    expect(results[0]!.tool).toBe('bash');
    expect(results[0]!.isError).toBe(false);
    expect(results[2]!.isError).toBe(true);
  });

  it('truncates long leaf strings inside batch sub-results but keeps structure', () => {
    const output = {
      results: [{ tool: 'bash', isError: false, output: bigBashSubOutput('a') }],
    };

    const [msg] = slimMessagesForRecovery([toolResultMessage(output)]);
    const slimmed = (msg!.content[0] as { output: Record<string, unknown> }).output;
    const sub = (slimmed.results as Array<Record<string, unknown>>)[0]!;
    const subOutput = sub.output as Record<string, unknown>;

    // Bash sub-output keeps its structured fields.
    expect(subOutput.command).toBe('pnpm a');
    expect(subOutput.exitCode).toBe(0);
    // Long stdout is truncated (>800 chars → truncation marker appended).
    expect(typeof subOutput.stdout).toBe('string');
    expect(subOutput.stdout as string).toContain('truncated');
    // Diffs are capped/truncated but remain an array.
    expect(Array.isArray(subOutput.diffs)).toBe(true);
  });

  it('keeps a standalone bash output object shaped (not collapsed to string)', () => {
    const msg: Message = {
      id: 'tool-msg-2',
      role: 'tool',
      createdAt: 1,
      content: [
        {
          type: 'tool_result',
          toolCallId: 'call-2',
          toolName: 'bash',
          output: bigBashSubOutput('standalone'),
          isError: false,
        },
      ],
    } as Message;

    const [slimMsg] = slimMessagesForRecovery([msg]);
    const slimmed = (slimMsg!.content[0] as { output: unknown }).output as Record<string, unknown>;
    expect(typeof slimmed).toBe('object');
    expect(slimmed.command).toBe('pnpm standalone');
    expect(slimmed.exitCode).toBe(0);
  });

  it('still collapses an oversized generic (non-batch, non-bash) object to a string', () => {
    // A generic blob with no results/command/exitCode/stdout/stderr markers
    // should still hit the size guard and become a truncated string.
    const generic: Record<string, unknown> = {};
    for (let i = 0; i < 200; i += 1) {
      generic[`field_${i}`] = 'y'.repeat(50);
    }
    const msg: Message = {
      id: 'tool-msg-3',
      role: 'tool',
      createdAt: 1,
      content: [
        {
          type: 'tool_result',
          toolCallId: 'call-3',
          toolName: 'some_tool',
          output: generic,
          isError: false,
        },
      ],
    } as Message;

    const [slimMsg] = slimMessagesForRecovery([msg]);
    const slimmed = (slimMsg!.content[0] as { output: unknown }).output;
    expect(typeof slimmed).toBe('string');
    expect(slimmed as string).toContain('truncated');
  });
});
