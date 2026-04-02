import { describe, expect, it } from 'vitest';
import { buildSessionFileChangesProjection } from '../session-file-changes-projection.js';

describe('session-file-changes-projection', () => {
  it('builds a unified summary across diffs and snapshots', () => {
    expect(
      buildSessionFileChangesProjection({
        fileDiffs: [
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
          {
            file: 'src/app.ts',
            before: 'export const a = 1;\n',
            after: 'export const a = 2;\n',
            additions: 1,
            deletions: 1,
            status: 'modified',
            sourceKind: 'structured_tool_diff',
            guaranteeLevel: 'medium',
          },
        ],
        snapshots: [
          {
            snapshotRef: 'backup:backup-1',
            scopeKind: 'backup',
            createdAt: '2026-04-02T08:00:00.000Z',
            summary: {
              files: 2,
              additions: 2,
              deletions: 1,
              guaranteeLevel: 'weak',
              sourceKinds: ['workspace_reconcile', 'structured_tool_diff'],
            },
          },
        ],
      }),
    ).toEqual({
      fileDiffs: [
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
        {
          file: 'src/app.ts',
          before: 'export const a = 1;\n',
          after: 'export const a = 2;\n',
          additions: 1,
          deletions: 1,
          status: 'modified',
          sourceKind: 'structured_tool_diff',
          guaranteeLevel: 'medium',
        },
      ],
      snapshots: [
        {
          snapshotRef: 'backup:backup-1',
          scopeKind: 'backup',
          createdAt: '2026-04-02T08:00:00.000Z',
          summary: {
            files: 2,
            additions: 2,
            deletions: 1,
            guaranteeLevel: 'weak',
            sourceKinds: ['workspace_reconcile', 'structured_tool_diff'],
          },
        },
      ],
      summary: {
        totalFileDiffs: 2,
        snapshotCount: 1,
        totalAdditions: 2,
        totalDeletions: 1,
        sourceKinds: ['workspace_reconcile', 'structured_tool_diff'],
        weakestGuaranteeLevel: 'weak',
        latestSnapshotRef: 'backup:backup-1',
        latestSnapshotScopeKind: 'backup',
        latestSnapshotAt: '2026-04-02T08:00:00.000Z',
      },
    });
  });
});
