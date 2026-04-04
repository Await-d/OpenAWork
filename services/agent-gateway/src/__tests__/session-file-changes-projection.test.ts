import { describe, expect, it } from 'vitest';
import {
  buildSessionFileChangesProjection,
  buildSessionTurnDiffReadModel,
} from '../session-file-changes-projection.js';

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

  it('builds a ui-friendly turn diff read model', () => {
    expect(
      buildSessionTurnDiffReadModel({
        sessionId: 'session-a',
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
            requestId: 'req-route-1:tool:bash-1',
            toolCallId: 'bash-1',
          },
        ],
        snapshots: [
          {
            clientRequestId: 'req-route-1',
            snapshotRef: 'req:req-route-1',
            scopeKind: 'request',
            createdAt: '2026-04-02T08:00:00.000Z',
            files: [
              {
                file: 'copied.txt',
                before: '',
                after: 'hello\n',
                additions: 1,
                deletions: 0,
                status: 'added',
                sourceKind: 'workspace_reconcile',
                guaranteeLevel: 'weak',
                requestId: 'req-route-1:tool:bash-1',
                toolCallId: 'bash-1',
              },
            ],
            summary: {
              files: 1,
              additions: 1,
              deletions: 0,
              guaranteeLevel: 'weak',
              sourceKinds: ['workspace_reconcile'],
            },
          },
          {
            snapshotRef: 'backup:backup-1',
            scopeKind: 'backup',
            createdAt: '2026-04-02T08:10:00.000Z',
            summary: {
              files: 1,
              additions: 1,
              deletions: 0,
              guaranteeLevel: 'weak',
              sourceKinds: ['workspace_reconcile'],
            },
          },
        ],
      }),
    ).toEqual({
      sessionSummary: {
        totalFileDiffs: 1,
        snapshotCount: 2,
        totalAdditions: 1,
        totalDeletions: 0,
        sourceKinds: ['workspace_reconcile'],
        weakestGuaranteeLevel: 'weak',
        latestSnapshotRef: 'req:req-route-1',
        latestSnapshotScopeKind: 'request',
        latestSnapshotAt: '2026-04-02T08:00:00.000Z',
        turnCount: 1,
      },
      turns: [
        {
          clientRequestId: 'req-route-1',
          snapshotRef: 'req:req-route-1',
          createdAt: '2026-04-02T08:00:00.000Z',
          summary: {
            files: 1,
            additions: 1,
            deletions: 0,
            guaranteeLevel: 'weak',
            sourceKinds: ['workspace_reconcile'],
            scopeKind: 'request',
          },
          files: [
            {
              file: 'copied.txt',
              additions: 1,
              deletions: 0,
              status: 'added',
              sourceKind: 'workspace_reconcile',
              guaranteeLevel: 'weak',
            },
          ],
        },
      ],
      debugSurface: {
        sessionFileChangesRoute: '/sessions/session-a/file-changes',
        requestFileChangesRouteTemplate:
          '/sessions/session-a/requests/{clientRequestId}/file-changes',
        snapshotDetailRouteTemplate: '/sessions/session-a/snapshots/{snapshotRef}',
        snapshotCompareRoute: '/sessions/session-a/snapshots/compare',
        restorePreviewRoute: '/sessions/session-a/restore/preview',
      },
    });
  });

  it('sorts turns deterministically when snapshots share the same timestamp', () => {
    const readModel = buildSessionTurnDiffReadModel({
      sessionId: 'session-a',
      fileDiffs: [],
      snapshots: [
        {
          clientRequestId: 'req-a',
          snapshotRef: 'req:req-a',
          scopeKind: 'request',
          createdAt: '2026-04-02T08:00:00.000Z',
          files: [],
          summary: { files: 0, additions: 0, deletions: 0 },
        },
        {
          clientRequestId: 'req-b',
          snapshotRef: 'req:req-b',
          scopeKind: 'request',
          createdAt: '2026-04-02T08:00:00.000Z',
          files: [],
          summary: { files: 0, additions: 0, deletions: 0 },
        },
      ],
    });

    expect(readModel.sessionSummary.latestSnapshotRef).toBe('req:req-a');
    expect(readModel.turns.map((turn) => turn.snapshotRef)).toEqual(['req:req-b', 'req:req-a']);
  });
});
