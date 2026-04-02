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
