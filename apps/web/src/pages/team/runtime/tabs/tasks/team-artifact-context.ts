import type { HandoffRecord } from '@openAwork/web-client';

type ArtifactRoleLayer = HandoffRecord['fromRoleLayer'] | null;

interface DispatchPayload {
  dispatch_package?: DispatchPackagePayload;
}

interface ReviewReportPayload {
  review_report?: {
    markdown?: string;
    overallVerdict?: 'pass' | 'implementation-failure' | 'planning-failure';
    specReviewPassed?: boolean;
    qualityReviewPassed?: boolean;
  };
}

export interface DispatchPackagePayload {
  goal?: string;
  role?: string;
  toolsets?: string[];
  taskMarkers?: {
    taskId?: string;
    parallel?: boolean;
    story?: string;
    priority?: string;
  };
  dependsOn?: string[];
}

export interface ArtifactReviewReport {
  markdown: string | null;
  overallVerdict: 'pass' | 'implementation-failure' | 'planning-failure' | null;
  specReviewPassed: boolean | null;
  qualityReviewPassed: boolean | null;
}

export interface ResolvedTeamArtifactContext {
  focusHandoff: HandoffRecord | null;
  pm2Handoff: HandoffRecord | null;
  pm1ArtifactSessionId: string | null;
  pm2ArtifactSessionId: string | null;
}

function isPayloadObject(value: unknown): value is ReviewReportPayload {
  return typeof value === 'object' && value !== null;
}

function isDispatchPayload(value: unknown): value is DispatchPayload {
  return typeof value === 'object' && value !== null;
}

function compareHandoffRecency(left: HandoffRecord, right: HandoffRecord): number {
  return (right.completedAt ?? right.updatedAt).localeCompare(left.completedAt ?? left.updatedAt);
}

function isDispatchTargetLayer(
  layer: HandoffRecord['toRoleLayer'],
): layer is 'executor' | 'tester' | 'reviewer' {
  return layer === 'executor' || layer === 'tester' || layer === 'reviewer';
}

function findLatestPm2Handoff(records: HandoffRecord[], sessionId: string): HandoffRecord | null {
  const candidates = records
    .filter((record) => record.toRoleLayer === 'pm2' && record.toSessionId === sessionId)
    .sort(compareHandoffRecency);
  return candidates[0] ?? null;
}

function pickRelevantPm2Handoff(
  records: HandoffRecord[],
  focusHandoff: HandoffRecord | null,
): HandoffRecord | null {
  if (focusHandoff?.toRoleLayer === 'pm2') {
    return focusHandoff;
  }

  if (focusHandoff?.toRoleLayer === 'pm1' && focusHandoff.toSessionId) {
    const downstream = records
      .filter(
        (record) =>
          record.toRoleLayer === 'pm2' && record.fromSessionId === focusHandoff.toSessionId,
      )
      .sort(compareHandoffRecency);
    if (downstream[0]) {
      return downstream[0];
    }
  }

  if (focusHandoff?.fromRoleLayer === 'pm2' && isDispatchTargetLayer(focusHandoff.toRoleLayer)) {
    return findLatestPm2Handoff(records, focusHandoff.fromSessionId);
  }

  const candidates = records
    .filter((record) => record.toRoleLayer === 'pm2')
    .sort(compareHandoffRecency);
  return candidates[0] ?? null;
}

export function parseDispatchPackage(record: HandoffRecord): DispatchPackagePayload | null {
  const payload = record.payload;
  if (!isDispatchPayload(payload)) {
    return null;
  }
  if (payload.dispatch_package) {
    return payload.dispatch_package;
  }
  if (typeof (payload as Record<string, unknown>)['goal'] === 'string') {
    return payload as DispatchPackagePayload;
  }
  return null;
}

export function extractReviewReport(
  records: HandoffRecord[],
  focusHandoffId?: string | null,
): ArtifactReviewReport {
  const candidates = records
    .filter((record) => record.toRoleLayer === 'pm2' && record.state === 'completed')
    .sort(compareHandoffRecency);

  const orderedCandidates = focusHandoffId
    ? [
        ...candidates.filter((record) => record.id === focusHandoffId),
        ...candidates.filter((record) => record.id !== focusHandoffId),
      ]
    : candidates;

  for (const record of orderedCandidates) {
    if (!isPayloadObject(record.payload)) {
      continue;
    }
    const reviewReport = record.payload.review_report;
    if (!reviewReport) {
      continue;
    }
    return {
      markdown: reviewReport.markdown ?? null,
      overallVerdict: reviewReport.overallVerdict ?? null,
      specReviewPassed: reviewReport.specReviewPassed ?? null,
      qualityReviewPassed: reviewReport.qualityReviewPassed ?? null,
    };
  }

  return {
    markdown: null,
    overallVerdict: null,
    specReviewPassed: null,
    qualityReviewPassed: null,
  };
}

export function resolveTeamArtifactContext(input: {
  focusHandoffId?: string | null;
  handoffs: HandoffRecord[];
  selectedSessionId: string | null;
  selectedSessionRoleLayer?: ArtifactRoleLayer;
}): ResolvedTeamArtifactContext {
  const focusHandoff = input.focusHandoffId
    ? (input.handoffs.find((record) => record.id === input.focusHandoffId) ?? null)
    : null;
  const pm2Handoff = pickRelevantPm2Handoff(input.handoffs, focusHandoff);

  const pm1ArtifactSessionId =
    pm2Handoff?.fromSessionId ??
    (focusHandoff?.toRoleLayer === 'pm1' ? focusHandoff.toSessionId : null) ??
    (input.selectedSessionRoleLayer === 'pm1' ? input.selectedSessionId : null) ??
    null;

  const pm2ArtifactSessionId =
    pm2Handoff?.toSessionId ??
    (focusHandoff?.toRoleLayer === 'pm2' ? focusHandoff.toSessionId : null) ??
    (focusHandoff?.fromRoleLayer === 'pm2' ? focusHandoff.fromSessionId : null) ??
    (input.selectedSessionRoleLayer === 'pm2' ? input.selectedSessionId : null) ??
    null;

  return {
    focusHandoff,
    pm2Handoff,
    pm1ArtifactSessionId,
    pm2ArtifactSessionId,
  };
}
