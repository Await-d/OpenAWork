import type {
  FileChangeGuaranteeLevel,
  FileChangeSourceKind,
  FileDiffContent,
} from '@openAwork/shared';

type SnapshotScopeKind = 'request' | 'backup' | 'scope' | 'unknown';

interface SnapshotSummaryLike {
  additions: number;
  deletions: number;
  files: number;
  guaranteeLevel?: FileChangeGuaranteeLevel;
  sourceKinds?: FileChangeSourceKind[];
}

interface SessionSnapshotLike {
  clientRequestId?: string;
  createdAt: string;
  files?: FileDiffContent[];
  scopeKind: SnapshotScopeKind;
  snapshotRef: string;
  summary: SnapshotSummaryLike;
}

export interface SessionFileChangesSummary {
  latestSnapshotAt?: string;
  latestSnapshotRef?: string;
  latestSnapshotScopeKind?: SnapshotScopeKind;
  snapshotCount: number;
  sourceKinds: FileChangeSourceKind[];
  totalAdditions: number;
  totalDeletions: number;
  totalFileDiffs: number;
  weakestGuaranteeLevel?: FileChangeGuaranteeLevel;
}

export interface SessionFileChangesProjection {
  fileDiffs: FileDiffContent[];
  snapshots: SessionSnapshotLike[];
  summary: SessionFileChangesSummary;
}

export interface SessionTurnDiffFileSummary {
  additions: number;
  deletions: number;
  file: string;
  guaranteeLevel?: FileChangeGuaranteeLevel;
  sourceKind?: FileChangeSourceKind;
  status?: 'added' | 'deleted' | 'modified';
}

export interface SessionTurnDiffSummary {
  clientRequestId: string;
  createdAt: string;
  files: SessionTurnDiffFileSummary[];
  snapshotRef: string;
  summary: SnapshotSummaryLike & { scopeKind: SnapshotScopeKind };
}

export interface SessionTurnDiffReadModel {
  debugSurface: {
    requestFileChangesRouteTemplate: string;
    restorePreviewRoute: string;
    sessionFileChangesRoute: string;
    snapshotCompareRoute: string;
    snapshotDetailRouteTemplate: string;
  };
  sessionSummary: SessionFileChangesSummary & { turnCount: number };
  turns: SessionTurnDiffSummary[];
}

export function buildSessionFileChangesProjection(input: {
  fileDiffs: FileDiffContent[];
  snapshots: SessionSnapshotLike[];
}): SessionFileChangesProjection {
  const sourceKinds = new Set<FileChangeSourceKind>();
  input.fileDiffs.forEach((diff) => {
    if (diff.sourceKind) {
      sourceKinds.add(diff.sourceKind);
    }
  });
  input.snapshots.forEach((snapshot) => {
    snapshot.summary.sourceKinds?.forEach((kind) => {
      sourceKinds.add(kind);
    });
  });

  const latestSnapshot = input.snapshots[0];
  return {
    fileDiffs: input.fileDiffs,
    snapshots: input.snapshots,
    summary: {
      totalFileDiffs: input.fileDiffs.length,
      snapshotCount: input.snapshots.length,
      totalAdditions: input.fileDiffs.reduce((sum, diff) => sum + diff.additions, 0),
      totalDeletions: input.fileDiffs.reduce((sum, diff) => sum + diff.deletions, 0),
      sourceKinds: Array.from(sourceKinds),
      weakestGuaranteeLevel: deriveWeakestGuaranteeLevel([
        ...input.fileDiffs.map((diff) => diff.guaranteeLevel),
        ...input.snapshots.map((snapshot) => snapshot.summary.guaranteeLevel),
      ]),
      latestSnapshotRef: latestSnapshot?.snapshotRef,
      latestSnapshotScopeKind: latestSnapshot?.scopeKind,
      latestSnapshotAt: latestSnapshot?.createdAt,
    },
  };
}

export function buildSessionTurnDiffReadModel(input: {
  fileDiffs: FileDiffContent[];
  sessionId: string;
  snapshots: SessionSnapshotLike[];
}): SessionTurnDiffReadModel {
  const projection = buildSessionFileChangesProjection({
    fileDiffs: input.fileDiffs,
    snapshots: input.snapshots,
  });

  const turns = projection.snapshots
    .filter(
      (
        snapshot,
      ): snapshot is SessionSnapshotLike & {
        clientRequestId: string;
        files: FileDiffContent[];
      } => {
        return (
          snapshot.scopeKind === 'request' &&
          typeof snapshot.clientRequestId === 'string' &&
          Array.isArray(snapshot.files)
        );
      },
    )
    .map((snapshot) => ({
      clientRequestId: snapshot.clientRequestId,
      snapshotRef: snapshot.snapshotRef,
      createdAt: snapshot.createdAt,
      summary: {
        ...snapshot.summary,
        scopeKind: snapshot.scopeKind,
      },
      files: snapshot.files.map((file) => ({
        file: file.file,
        additions: file.additions,
        deletions: file.deletions,
        ...(file.status ? { status: file.status } : {}),
        ...(file.guaranteeLevel ? { guaranteeLevel: file.guaranteeLevel } : {}),
        ...(file.sourceKind ? { sourceKind: file.sourceKind } : {}),
      })),
    }))
    .sort((left, right) => {
      if (left.createdAt !== right.createdAt) {
        return left.createdAt < right.createdAt ? 1 : -1;
      }
      return left.snapshotRef < right.snapshotRef
        ? 1
        : left.snapshotRef > right.snapshotRef
          ? -1
          : 0;
    });

  return {
    sessionSummary: {
      ...projection.summary,
      turnCount: turns.length,
    },
    turns,
    debugSurface: {
      sessionFileChangesRoute: `/sessions/${input.sessionId}/file-changes`,
      requestFileChangesRouteTemplate: `/sessions/${input.sessionId}/requests/{clientRequestId}/file-changes`,
      snapshotDetailRouteTemplate: `/sessions/${input.sessionId}/snapshots/{snapshotRef}`,
      snapshotCompareRoute: `/sessions/${input.sessionId}/snapshots/compare`,
      restorePreviewRoute: `/sessions/${input.sessionId}/restore/preview`,
    },
  };
}

function deriveWeakestGuaranteeLevel(
  values: Array<FileChangeGuaranteeLevel | undefined>,
): FileChangeGuaranteeLevel | undefined {
  if (values.includes('weak')) {
    return 'weak';
  }
  if (values.includes('medium')) {
    return 'medium';
  }
  if (values.includes('strong')) {
    return 'strong';
  }
  return undefined;
}
