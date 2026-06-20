import type { TeamRuntimeSessionRecord } from '@openAwork/web-client';
import type {
  HandoffEntry,
  HandoffState,
  LayerNode,
  TeamRoleLayer,
} from '../../../../../stores/team/team-events.js';
import {
  collectSessionScope,
  isHandoffInSessionScope,
  isSessionInScope,
} from '../../data/team-runtime-session-scope.js';

export const TEAM_LAYER_LABELS: Record<TeamRoleLayer, string> = {
  user: '用户',
  reception: '接待',
  pm1: 'PM1 · 规划',
  pm2: 'PM2 · 管控',
  executor: '执行',
  tester: '测试',
  reviewer: '评审',
};

export const TEAM_LAYER_ORDER: TeamRoleLayer[] = [
  'user',
  'reception',
  'pm1',
  'pm2',
  'executor',
  'tester',
  'reviewer',
];

const LAYER_RANK = new Map<TeamRoleLayer, number>(
  TEAM_LAYER_ORDER.map((layer, index) => [layer, index]),
);
const PROMPT_PREVIEW_LAYER_SET = new Set<TeamRoleLayer>([
  'reception',
  'pm1',
  'pm2',
  'executor',
  'reviewer',
]);

export type LayerConversationFilter = TeamRoleLayer | 'all';
export type LayerConversationState = HandoffState | 'idle' | 'paused';
export type LayerConversationSource = 'handoff' | 'session';

export interface LayerConversationRow {
  childCount: number;
  depth: number;
  detail: string;
  displayName: string | null;
  fromRoleLayer: TeamRoleLayer | null;
  handoffCount: number;
  id: string;
  parentSessionId: string | null;
  personaKey: string | null;
  roleLayer: TeamRoleLayer;
  sessionId: string;
  source: LayerConversationSource;
  state: LayerConversationState;
  timestampMs: number;
  title: string;
  toRoleLayer: TeamRoleLayer;
}

interface SessionCandidate {
  displayName: string | null;
  parentSessionId: string | null;
  personaKey: string | null;
  roleLayer: TeamRoleLayer;
  sessionId: string;
  state: LayerConversationState;
  timestampMs: number;
  title: string | null;
}

interface BuildLayerConversationRowsInput {
  handoffs: Iterable<HandoffEntry>;
  nodes: Iterable<LayerNode>;
  selectedSessionId?: string | null;
  sessions: TeamRuntimeSessionRecord[];
}

function normalizeTeamRoleLayer(value: string | null | undefined): TeamRoleLayer {
  switch (value) {
    case 'user':
    case 'reception':
    case 'pm1':
    case 'pm2':
    case 'executor':
    case 'tester':
    case 'reviewer':
      return value;
    default:
      return 'reception';
  }
}

function normalizeConversationState(value: string | null | undefined): LayerConversationState {
  switch (value) {
    case 'pending':
    case 'claimed':
    case 'running':
    case 'completed':
    case 'failed':
    case 'cancelled':
    case 'paused':
      return value;
    default:
      return 'idle';
  }
}

function parseTimestampMs(value: string | null | undefined): number {
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function mergeCandidate(
  candidates: Map<string, SessionCandidate>,
  candidate: SessionCandidate,
): void {
  const existing = candidates.get(candidate.sessionId);
  if (!existing) {
    candidates.set(candidate.sessionId, candidate);
    return;
  }

  candidates.set(candidate.sessionId, {
    ...existing,
    displayName: existing.displayName ?? candidate.displayName,
    parentSessionId: existing.parentSessionId ?? candidate.parentSessionId,
    personaKey: existing.personaKey ?? candidate.personaKey,
    roleLayer:
      existing.roleLayer === 'reception' && candidate.roleLayer !== 'reception'
        ? candidate.roleLayer
        : existing.roleLayer,
    state: existing.state === 'idle' ? candidate.state : existing.state,
    timestampMs: Math.max(existing.timestampMs, candidate.timestampMs),
    title: existing.title ?? candidate.title,
  });
}

export function resolveLayerConversationRootId(input: {
  nodes: Iterable<LayerNode>;
  selectedSessionId?: string | null;
  sessions: TeamRuntimeSessionRecord[];
}): string | null {
  if (!input.selectedSessionId) {
    return null;
  }

  const parentById = new Map<string, string | null>();
  for (const session of input.sessions) {
    parentById.set(session.id, session.parentSessionId);
  }
  for (const node of input.nodes) {
    if (!parentById.has(node.sessionId) || parentById.get(node.sessionId) === null) {
      parentById.set(node.sessionId, node.parentSessionId);
    }
  }

  let current = input.selectedSessionId;
  const visited = new Set<string>();
  while (!visited.has(current)) {
    visited.add(current);
    const parent = parentById.get(current);
    if (!parent) {
      return current;
    }
    current = parent;
  }

  return input.selectedSessionId;
}

function computeDepth(
  sessionId: string,
  candidates: Map<string, SessionCandidate>,
  cache: Map<string, number>,
  visiting: Set<string>,
): number {
  const cached = cache.get(sessionId);
  if (cached !== undefined) {
    return cached;
  }
  if (visiting.has(sessionId)) {
    return 0;
  }

  visiting.add(sessionId);
  const parentId = candidates.get(sessionId)?.parentSessionId ?? null;
  const depth =
    parentId && candidates.has(parentId)
      ? computeDepth(parentId, candidates, cache, visiting) + 1
      : 0;
  visiting.delete(sessionId);
  cache.set(sessionId, depth);
  return depth;
}

function buildSessionCandidateFromRuntime(session: TeamRuntimeSessionRecord): SessionCandidate {
  return {
    displayName: session.roleInstance?.displayName ?? null,
    parentSessionId: session.parentSessionId,
    personaKey: session.roleInstance?.personaKey ?? null,
    roleLayer: normalizeTeamRoleLayer(session.roleLayer ?? session.roleInstance?.roleLayer),
    sessionId: session.id,
    state: normalizeConversationState(session.paused ? 'paused' : session.stateStatus),
    timestampMs: parseTimestampMs(session.updatedAt),
    title: session.title,
  };
}

function buildSessionCandidateFromNode(node: LayerNode): SessionCandidate {
  return {
    displayName: node.displayName ?? null,
    parentSessionId: node.parentSessionId,
    personaKey: node.personaKey ?? null,
    roleLayer: node.roleLayer,
    sessionId: node.sessionId,
    state: node.state,
    timestampMs: 0,
    title: node.title ?? null,
  };
}

function pickNewestCandidate(
  candidates: Map<string, SessionCandidate>,
  predicate: (candidate: SessionCandidate) => boolean,
): SessionCandidate | null {
  const matches = Array.from(candidates.values()).filter(predicate);
  matches.sort((left, right) => {
    if (left.timestampMs !== right.timestampMs) {
      return right.timestampMs - left.timestampMs;
    }
    return left.sessionId.localeCompare(right.sessionId, 'zh-CN');
  });
  return matches[0] ?? null;
}

function resolveHandoffTargetSessionId(
  handoff: HandoffEntry,
  candidates: Map<string, SessionCandidate>,
): string | null {
  if (handoff.toSessionId) {
    return handoff.toSessionId;
  }

  const sessionCandidate = handoff.sessionId ? (candidates.get(handoff.sessionId) ?? null) : null;
  if (sessionCandidate?.roleLayer === handoff.toRoleLayer) {
    return handoff.sessionId ?? null;
  }

  const directChild = handoff.fromSessionId
    ? pickNewestCandidate(
        candidates,
        (candidate) =>
          candidate.parentSessionId === handoff.fromSessionId &&
          candidate.roleLayer === handoff.toRoleLayer,
      )
    : null;
  if (directChild) {
    return directChild.sessionId;
  }

  const sessionChild = handoff.sessionId
    ? pickNewestCandidate(
        candidates,
        (candidate) =>
          candidate.parentSessionId === handoff.sessionId &&
          candidate.roleLayer === handoff.toRoleLayer,
      )
    : null;
  if (sessionChild) {
    return sessionChild.sessionId;
  }

  const scopedLayerMatch = pickNewestCandidate(
    candidates,
    (candidate) =>
      candidate.roleLayer === handoff.toRoleLayer && candidate.sessionId !== handoff.fromSessionId,
  );
  return scopedLayerMatch?.sessionId ?? handoff.sessionId ?? null;
}

function rowMatchesLayer(row: LayerConversationRow, layer: TeamRoleLayer): boolean {
  return row.roleLayer === layer || row.fromRoleLayer === layer || row.toRoleLayer === layer;
}

export function filterLayerConversationRows(
  rows: LayerConversationRow[],
  layer: LayerConversationFilter,
): LayerConversationRow[] {
  if (layer === 'all') {
    return rows;
  }
  return rows.filter((row) => rowMatchesLayer(row, layer));
}

export function countLayerConversationRowsByLayer(
  rows: LayerConversationRow[],
): Map<TeamRoleLayer, number> {
  const counts = new Map<TeamRoleLayer, number>();
  for (const row of rows) {
    counts.set(row.roleLayer, (counts.get(row.roleLayer) ?? 0) + 1);
  }
  return counts;
}

export function canPreviewTeamLayerPrompt(layer: TeamRoleLayer): boolean {
  return PROMPT_PREVIEW_LAYER_SET.has(layer);
}

export function buildLayerConversationRows({
  handoffs,
  nodes,
  selectedSessionId,
  sessions,
}: BuildLayerConversationRowsInput): LayerConversationRow[] {
  const nodeList = Array.from(nodes);
  const rootSessionId = resolveLayerConversationRootId({
    nodes: nodeList,
    selectedSessionId,
    sessions,
  });
  const scopedSessionIds = rootSessionId
    ? collectSessionScope(rootSessionId, [...sessions, ...nodeList])
    : null;

  const candidates = new Map<string, SessionCandidate>();
  for (const session of sessions) {
    if (scopedSessionIds && !isSessionInScope(session.id, scopedSessionIds)) {
      continue;
    }
    mergeCandidate(candidates, buildSessionCandidateFromRuntime(session));
  }
  for (const node of nodeList) {
    if (scopedSessionIds && !isSessionInScope(node.sessionId, scopedSessionIds)) {
      continue;
    }
    mergeCandidate(candidates, buildSessionCandidateFromNode(node));
  }

  const childCountByParent = new Map<string, number>();
  for (const candidate of candidates.values()) {
    if (candidate.parentSessionId && candidates.has(candidate.parentSessionId)) {
      childCountByParent.set(
        candidate.parentSessionId,
        (childCountByParent.get(candidate.parentSessionId) ?? 0) + 1,
      );
    }
  }

  const latestHandoffBySession = new Map<string, HandoffEntry>();
  const handoffCountBySession = new Map<string, number>();
  for (const handoff of handoffs) {
    if (scopedSessionIds && !isHandoffInSessionScope(handoff, scopedSessionIds)) {
      continue;
    }
    const sessionId = resolveHandoffTargetSessionId(handoff, candidates);
    if (!sessionId) {
      continue;
    }
    handoffCountBySession.set(sessionId, (handoffCountBySession.get(sessionId) ?? 0) + 1);
    const existing = latestHandoffBySession.get(sessionId);
    if (!existing || handoff.updatedAt >= existing.updatedAt) {
      latestHandoffBySession.set(sessionId, handoff);
    }
  }

  const depthCache = new Map<string, number>();
  const rows: LayerConversationRow[] = [];

  for (const candidate of candidates.values()) {
    const handoff = latestHandoffBySession.get(candidate.sessionId) ?? null;
    const parent = candidate.parentSessionId
      ? (candidates.get(candidate.parentSessionId) ?? null)
      : null;
    const roleLayer = handoff?.toRoleLayer ?? candidate.roleLayer;
    const fromRoleLayer = handoff?.fromRoleLayer ?? parent?.roleLayer ?? null;
    const state = handoff?.state ?? candidate.state;
    const title = candidate.title ?? candidate.displayName ?? candidate.sessionId;
    const detail =
      handoff?.summary ??
      (candidate.displayName
        ? `角色实例：${candidate.displayName}`
        : candidate.parentSessionId
          ? `派生自 ${candidate.parentSessionId}`
          : '根层级会话');

    rows.push({
      childCount: childCountByParent.get(candidate.sessionId) ?? 0,
      depth: computeDepth(candidate.sessionId, candidates, depthCache, new Set()),
      detail,
      displayName: candidate.displayName,
      fromRoleLayer,
      handoffCount: handoffCountBySession.get(candidate.sessionId) ?? 0,
      id: `session-${candidate.sessionId}`,
      parentSessionId: candidate.parentSessionId,
      personaKey: candidate.personaKey,
      roleLayer,
      sessionId: candidate.sessionId,
      source: handoff ? 'handoff' : 'session',
      state,
      timestampMs: handoff?.updatedAt ?? candidate.timestampMs,
      title,
      toRoleLayer: roleLayer,
    });
  }

  for (const [sessionId, handoff] of latestHandoffBySession) {
    if (candidates.has(sessionId)) {
      continue;
    }
    const roleLayer = handoff.toRoleLayer;
    rows.push({
      childCount: 0,
      depth: 0,
      detail: handoff.summary ?? `由 ${TEAM_LAYER_LABELS[handoff.fromRoleLayer]} 交接而来`,
      displayName: null,
      fromRoleLayer: handoff.fromRoleLayer,
      handoffCount: handoffCountBySession.get(sessionId) ?? 1,
      id: `handoff-${handoff.id}`,
      parentSessionId: handoff.fromSessionId ?? null,
      roleLayer,
      sessionId,
      source: 'handoff',
      state: handoff.state,
      timestampMs: handoff.updatedAt,
      title: sessionId,
      toRoleLayer: roleLayer,
    });
  }

  return rows.sort((left, right) => {
    if (left.depth !== right.depth) {
      return left.depth - right.depth;
    }
    const layerDelta =
      (LAYER_RANK.get(left.roleLayer) ?? 99) - (LAYER_RANK.get(right.roleLayer) ?? 99);
    if (layerDelta !== 0) {
      return layerDelta;
    }
    if (left.timestampMs !== right.timestampMs) {
      return right.timestampMs - left.timestampMs;
    }
    return left.title.localeCompare(right.title, 'zh-CN');
  });
}
