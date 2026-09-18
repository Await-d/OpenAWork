import type {
  SessionFileChangesProjection,
  SessionFileChangesSummary,
  SessionFileDiffEntry,
  SessionSnapshot,
} from '@openAwork/web-client';

export function makeReviewPanelDiffEntry(
  file: string,
  overrides: Partial<Omit<SessionFileDiffEntry, 'file'>> = {},
): SessionFileDiffEntry {
  return {
    additions: 1,
    after: `export const file = "${file}";\n`,
    before: '',
    deletions: 0,
    file,
    guaranteeLevel: 'strong',
    requestId: `request:${file}`,
    sourceKind: 'structured_tool_diff',
    status: 'modified',
    toolName: 'hash_edit',
    ...overrides,
  };
}

export function makeReviewPanelSnapshot(
  files: readonly SessionFileDiffEntry[],
  overrides: Partial<SessionSnapshot> = {},
): SessionSnapshot {
  return {
    createdAt: '2026-01-01T00:00:00.000Z',
    files: [...files],
    scopeKind: 'request',
    snapshotRef: `request:snapshot-${files.length}`,
    summary: {
      additions: files.reduce((sum, file) => sum + file.additions, 0),
      deletions: files.reduce((sum, file) => sum + file.deletions, 0),
      files: files.length,
    },
    ...overrides,
  };
}

function collectSourceKinds(
  fileDiffs: readonly SessionFileDiffEntry[],
): SessionFileChangesSummary['sourceKinds'] {
  const sourceKinds: SessionFileChangesSummary['sourceKinds'] = [];
  for (const fileDiff of fileDiffs) {
    if (fileDiff.sourceKind && !sourceKinds.includes(fileDiff.sourceKind)) {
      sourceKinds.push(fileDiff.sourceKind);
    }
  }
  return sourceKinds;
}

export function makeReviewPanelProjection(
  fileDiffs: readonly SessionFileDiffEntry[],
  options: {
    readonly snapshots?: readonly SessionSnapshot[];
    readonly summary?: Partial<SessionFileChangesSummary>;
  } = {},
): SessionFileChangesProjection {
  const totalAdditions = fileDiffs.reduce((sum, file) => sum + file.additions, 0);
  const totalDeletions = fileDiffs.reduce((sum, file) => sum + file.deletions, 0);
  const guaranteeSummary =
    fileDiffs.length > 0 && fileDiffs[0]?.guaranteeLevel
      ? { weakestGuaranteeLevel: fileDiffs[0].guaranteeLevel }
      : {};

  return {
    fileDiffs: [...fileDiffs],
    snapshots: [...(options.snapshots ?? [])],
    summary: {
      snapshotCount: options.snapshots?.length ?? 1,
      sourceKinds: collectSourceKinds(fileDiffs),
      totalAdditions,
      totalDeletions,
      totalFileDiffs: fileDiffs.length,
      ...guaranteeSummary,
      ...options.summary,
    },
  };
}
