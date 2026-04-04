import { describe, expect, it } from 'vitest';
import { collectFileDiffsFromToolOutput, traceFileDiffs } from '../modified-files-summary.js';

describe('modified-files-summary', () => {
  it('normalizes traced diff metadata with durable defaults', () => {
    expect(
      traceFileDiffs({
        clientRequestId: 'req-1',
        diffs: [
          {
            file: '/repo/example.ts',
            before: 'const a = 1;',
            after: 'const a = 2;',
            additions: 1,
            deletions: 1,
            status: 'modified',
          },
        ],
        observability: {
          presentedToolName: 'Write',
          canonicalToolName: 'write',
          toolSurfaceProfile: 'openawork',
        },
        requestId: 'req-1:tool:call-1',
        toolCallId: 'call-1',
        toolName: 'write',
      }),
    ).toEqual([
      {
        file: '/repo/example.ts',
        before: 'const a = 1;',
        after: 'const a = 2;',
        additions: 1,
        deletions: 1,
        status: 'modified',
        clientRequestId: 'req-1',
        requestId: 'req-1:tool:call-1',
        toolName: 'write',
        toolCallId: 'call-1',
        sourceKind: 'structured_tool_diff',
        guaranteeLevel: 'medium',
        observability: {
          presentedToolName: 'Write',
          canonicalToolName: 'write',
          toolSurfaceProfile: 'openawork',
        },
      },
    ]);
  });

  it('preserves reconcile metadata when extracting diffs from tool output', () => {
    expect(
      collectFileDiffsFromToolOutput({
        diffs: [
          {
            file: 'copied.txt',
            before: '',
            after: 'hello\n',
            additions: 1,
            deletions: 0,
            status: 'added',
            sourceKind: 'workspace_reconcile',
            guaranteeLevel: 'weak',
          },
        ],
      }),
    ).toEqual([
      {
        file: 'copied.txt',
        before: '',
        after: 'hello\n',
        additions: 1,
        deletions: 0,
        status: 'added',
        sourceKind: 'workspace_reconcile',
        guaranteeLevel: 'weak',
      },
    ]);
  });

  it('preserves backupBeforeRef when extracting diffs from tool output', () => {
    expect(
      collectFileDiffsFromToolOutput({
        diffs: [
          {
            file: 'patched.txt',
            before: 'old\n',
            after: 'new\n',
            additions: 1,
            deletions: 1,
            status: 'modified',
            backupBeforeRef: {
              backupId: 'backup-apply-1',
              kind: 'before_write',
              contentHash: 'hash-apply-1',
              storagePath: '/tmp/backup-apply-1.txt',
            },
          },
        ],
      }),
    ).toEqual([
      {
        file: 'patched.txt',
        before: 'old\n',
        after: 'new\n',
        additions: 1,
        deletions: 1,
        status: 'modified',
        backupBeforeRef: {
          backupId: 'backup-apply-1',
          kind: 'before_write',
          contentHash: 'hash-apply-1',
          storagePath: '/tmp/backup-apply-1.txt',
        },
      },
    ]);
  });

  it('keeps explicit sourceKind and guaranteeLevel instead of overwriting with defaults', () => {
    const traced = traceFileDiffs({
      clientRequestId: 'req-1',
      diffs: [
        {
          file: '/repo/example.ts',
          before: 'a',
          after: 'b',
          additions: 1,
          deletions: 1,
          sourceKind: 'restore_replay',
          guaranteeLevel: 'strong',
        },
      ],
      requestId: 'req-1:tool:call-1',
      toolCallId: 'call-1',
      toolName: 'write',
    });

    expect(traced[0]).toMatchObject({
      sourceKind: 'restore_replay',
      guaranteeLevel: 'strong',
    });
  });

  it('drops invalid sourceKind and guaranteeLevel values from tool output', () => {
    expect(
      collectFileDiffsFromToolOutput({
        diffs: [
          {
            file: 'bad.txt',
            before: 'a',
            after: 'b',
            additions: 1,
            deletions: 1,
            status: 'modified',
            sourceKind: 'invalid-source',
            guaranteeLevel: 'ultra',
          },
        ],
      }),
    ).toEqual([
      {
        file: 'bad.txt',
        before: 'a',
        after: 'b',
        additions: 1,
        deletions: 1,
        status: 'modified',
      },
    ]);
  });
});
