import type { HandoffRecord } from '@openAwork/web-client';

type ArtifactRoleLayer = HandoffRecord['fromRoleLayer'] | null;

/** 后端 ReviewReport.overallVerdict 的完整 union 类型 */
export type ReviewOverallVerdict =
  | 'pass'
  | 'implementation-failure'
  | 'planning-failure'
  | 'execution-protocol-failure';

interface DispatchPayload {
  dispatch_package?: DispatchPackagePayload;
}

interface ReviewReportPayload {
  review_report?: {
    markdown?: string;
    overallVerdict?: ReviewOverallVerdict;
    specReviewPassed?: boolean;
    qualityReviewPassed?: boolean;
  };
}

interface ReviewResultPayload {
  reviewReportArtifactId?: string;
  overallVerdict?: ReviewOverallVerdict;
  specReviewPassed?: boolean;
  qualityReviewPassed?: boolean;
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
  reviewArtifactId: string | null;
  markdown: string | null;
  overallVerdict: ReviewOverallVerdict | null;
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

function isReviewResultPayload(value: unknown): value is ReviewResultPayload {
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

function findSelectedDownstreamDispatch(
  records: HandoffRecord[],
  sessionId: string,
  roleLayer: ArtifactRoleLayer,
): HandoffRecord | null {
  if (!roleLayer || !isDispatchTargetLayer(roleLayer)) {
    return null;
  }
  const candidates = records
    .filter(
      (record) =>
        record.fromRoleLayer === 'pm2' &&
        record.toSessionId === sessionId &&
        isDispatchTargetLayer(record.toRoleLayer),
    )
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
    if (isPayloadObject(record.payload)) {
      const reviewReport = record.payload.review_report;
      if (reviewReport) {
        return {
          reviewArtifactId: null,
          markdown: reviewReport.markdown ?? null,
          overallVerdict: reviewReport.overallVerdict ?? null,
          specReviewPassed: reviewReport.specReviewPassed ?? null,
          qualityReviewPassed: reviewReport.qualityReviewPassed ?? null,
        };
      }
    }

    if (isReviewResultPayload(record.resultJson)) {
      return {
        reviewArtifactId:
          typeof record.resultJson.reviewReportArtifactId === 'string'
            ? record.resultJson.reviewReportArtifactId
            : null,
        markdown: null,
        overallVerdict: record.resultJson.overallVerdict ?? null,
        specReviewPassed: record.resultJson.specReviewPassed ?? null,
        qualityReviewPassed: record.resultJson.qualityReviewPassed ?? null,
      };
    }
  }

  return {
    reviewArtifactId: null,
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
  const selectedDownstreamDispatch =
    input.selectedSessionId && input.selectedSessionRoleLayer
      ? findSelectedDownstreamDispatch(
          input.handoffs,
          input.selectedSessionId,
          input.selectedSessionRoleLayer,
        )
      : null;
  const selectedPm1Handoff =
    input.selectedSessionId && input.selectedSessionRoleLayer === 'reception'
      ? (input.handoffs
          .filter(
            (record) =>
              record.fromSessionId === input.selectedSessionId &&
              record.toRoleLayer === 'pm1' &&
              record.toSessionId,
          )
          .sort(compareHandoffRecency)[0] ?? null)
      : null;

  const pm1ArtifactSessionId =
    pm2Handoff?.fromSessionId ??
    (focusHandoff?.toRoleLayer === 'pm1' ? focusHandoff.toSessionId : null) ??
    selectedPm1Handoff?.toSessionId ??
    (input.selectedSessionRoleLayer === 'pm1' ? input.selectedSessionId : null) ??
    null;

  const pm2ArtifactSessionId =
    pm2Handoff?.toSessionId ??
    (focusHandoff?.toRoleLayer === 'pm2' ? focusHandoff.toSessionId : null) ??
    (focusHandoff?.fromRoleLayer === 'pm2' ? focusHandoff.fromSessionId : null) ??
    selectedDownstreamDispatch?.fromSessionId ??
    (input.selectedSessionRoleLayer === 'pm2' ? input.selectedSessionId : null) ??
    null;

  return {
    focusHandoff,
    pm2Handoff,
    pm1ArtifactSessionId,
    pm2ArtifactSessionId,
  };
}
