import type { HandoffEvent } from '../../../../../stores/team/team-events.js';
import { substateLabelAny } from '../../data/substates.js';
import { teamEventLayerLabel, teamEventTypeLabel } from '../../data/team-event-labels.js';

export type TeamDynamicTone = 'danger' | 'warning' | 'info' | 'success';

export interface TeamDynamicEntry {
  actions?: string[];
  count: number;
  detail?: string;
  eventLabel: string;
  id: string;
  layerLabel?: string | null;
  summary: string;
  timeLabel: string;
  title: string;
  tone: TeamDynamicTone;
}

type PendingClarificationItem = {
  context: string;
  createdAt: number;
  fromSessionId: string;
  id: string;
  question: string;
  sessionId: string;
  status: 'answered' | 'dismissed' | 'pending';
};

const DISPLAYABLE_EVENT_TYPES = new Set([
  'artifact.needs-clarification',
  'handoff.completed',
  'handoff.failed',
  'handoff.cancelled',
  'scheduler.task-paused',
  'scheduler.task-resumed',
  'scheduler.all-paused',
  'scheduler.all-resumed',
  'session.inbound.submitted',
  'session.init.changed',
  'session.substate.changed',
]);

function isSessionIdInScope(
  sessionId: string | null | undefined,
  sessionScope: ReadonlySet<string> | null,
  rootSessionId: string,
): boolean {
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    return false;
  }
  if (sessionId === rootSessionId) {
    return true;
  }
  return sessionScope?.has(sessionId) ?? false;
}

function extractSuggestedActions(payload: Record<string, unknown>): string[] | undefined {
  const suggestedActions = payload['suggestedActions'];
  if (!Array.isArray(suggestedActions)) {
    return undefined;
  }

  const labels = suggestedActions
    .map((item) => {
      if (typeof item === 'string') {
        const trimmed = item.trim();
        return trimmed.length > 0 ? trimmed : null;
      }
      if (typeof item === 'object' && item !== null) {
        const label = item['label'];
        if (typeof label === 'string' && label.trim().length > 0) {
          return label.trim();
        }
      }
      return null;
    })
    .filter((value): value is string => value !== null);

  return labels.length > 0 ? labels : undefined;
}

function extractQuestionPreview(payload: Record<string, unknown>): string | null {
  const questions = payload['questions'];
  if (!Array.isArray(questions) || questions.length === 0) {
    return null;
  }

  const labels = questions
    .map((item) => {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) {
        return null;
      }
      const question = item['question'];
      return typeof question === 'string' && question.trim().length > 0 ? question.trim() : null;
    })
    .filter((value): value is string => value !== null)
    .slice(0, 2);

  if (labels.length === 0) {
    return null;
  }
  return labels.join(' · ');
}

function extractSummary(payload: Record<string, unknown>): string {
  const explicitSummary =
    typeof payload['summary'] === 'string'
      ? payload['summary'].trim()
      : typeof payload['context'] === 'string'
        ? payload['context'].trim()
        : typeof payload['textPreview'] === 'string'
          ? payload['textPreview'].trim()
          : typeof payload['message'] === 'string'
            ? payload['message'].trim()
            : '';
  if (explicitSummary.length > 0) {
    return explicitSummary;
  }

  const questionPreview = extractQuestionPreview(payload);
  if (questionPreview) {
    return questionPreview;
  }

  return '团队运行状态已更新';
}

function resolveTone(event: HandoffEvent): TeamDynamicTone {
  if (event.type === 'handoff.failed' || event.type === 'artifact.needs-clarification') {
    return 'danger';
  }
  if (
    event.type === 'scheduler.all-paused' ||
    event.type === 'scheduler.task-paused' ||
    event.type === 'handoff.cancelled'
  ) {
    return 'warning';
  }
  if (event.type === 'handoff.completed') {
    return 'success';
  }
  return 'info';
}

function resolveTitle(event: HandoffEvent): string {
  if (event.type === 'artifact.needs-clarification') {
    return '等待你的澄清';
  }
  if (
    event.type === 'session.inbound.submitted' &&
    event.payload['reason'] === 'needs_clarification'
  ) {
    return '等待你的回复';
  }
  if (event.type === 'session.substate.changed') {
    const nextSubstate =
      typeof event.payload['substate'] === 'string' ? event.payload['substate'] : null;
    return substateLabelAny(nextSubstate) ?? teamEventTypeLabel(event.type);
  }
  return teamEventTypeLabel(event.type);
}

function resolveDetail(event: HandoffEvent, layerLabel: string | null): string | undefined {
  const questionPreview = extractQuestionPreview(event.payload);
  if (questionPreview) {
    return questionPreview;
  }

  if (layerLabel) {
    return `${layerLabel} · ${teamEventTypeLabel(event.type)}`;
  }

  const detail =
    typeof event.payload['detail'] === 'string' ? event.payload['detail'].trim() : '';
  return detail.length > 0 ? detail : undefined;
}

function shouldDisplayEvent(event: HandoffEvent): boolean {
  if (!DISPLAYABLE_EVENT_TYPES.has(event.type)) {
    return false;
  }
  if (event.type === 'session.substate.changed') {
    return typeof event.payload['substate'] === 'string';
  }
  return true;
}

function toTimeLabel(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function buildMergeKey(entry: TeamDynamicEntry): string {
  return [
    entry.tone,
    entry.title,
    entry.summary,
    entry.detail ?? '',
    entry.layerLabel ?? '',
    entry.eventLabel,
    entry.actions?.join('|') ?? '',
  ].join('||');
}

function mapEventToDynamicEntry(event: HandoffEvent, index: number): TeamDynamicEntry {
  const layerLabel = teamEventLayerLabel(event.layer);
  return {
    actions: extractSuggestedActions(event.payload),
    count: 1,
    detail: resolveDetail(event, layerLabel) ?? undefined,
    eventLabel: teamEventTypeLabel(event.type),
    id: `team-dynamic-${event.type}-${event.timestamp}-${index}`,
    layerLabel,
    summary: extractSummary(event.payload),
    timeLabel: toTimeLabel(event.timestamp),
    title: resolveTitle(event),
    tone: resolveTone(event),
  };
}

export function buildClarificationPushEvents(
  items: PendingClarificationItem[],
  events: HandoffEvent[],
): HandoffEvent[] {
  const pending = items.filter((item) => item.status === 'pending');
  if (pending.length === 0) {
    return [];
  }

  const uncoveredBySession = new Map<string, typeof pending>();
  for (const item of pending) {
    const alreadyCovered = events.some((event) => {
      if (event.type === 'artifact.needs-clarification' && event.sessionId === item.sessionId) {
        return true;
      }
      if (event.payload['reason'] !== 'needs_clarification') {
        return false;
      }
      const eventFromSessionId =
        typeof event.payload['fromSessionId'] === 'string' ? event.payload['fromSessionId'] : null;
      return eventFromSessionId === item.fromSessionId || event.sessionId === item.sessionId;
    });
    if (alreadyCovered) {
      continue;
    }
    const group = uncoveredBySession.get(item.fromSessionId) ?? [];
    group.push(item);
    uncoveredBySession.set(item.fromSessionId, group);
  }

  return Array.from(uncoveredBySession.values()).map((group) => {
    const latest = group.slice().sort((left, right) => right.createdAt - left.createdAt)[0]!;
    const summary =
      latest.context.trim().length > 0
        ? latest.context.trim()
        : `有 ${group.length} 个澄清问题等待回答`;

    return {
      type: 'session.inbound.submitted',
      sessionId: latest.sessionId,
      layer: 'pm1',
      timestamp: latest.createdAt,
      payload: {
        blocking: false,
        reason: 'needs_clarification',
        fromSessionId: latest.fromSessionId,
        summary,
        questions: group.map((item) => ({
          id: item.id,
          question: item.question,
          context: item.context,
        })),
        suggestedActions: [{ label: '回答澄清问题', action: 'answer' }],
      },
    };
  });
}

export function filterPendingClarificationsForScope(
  items: PendingClarificationItem[],
  sessionScope: ReadonlySet<string> | null,
  rootSessionId: string,
): PendingClarificationItem[] {
  return items.filter(
    (item) =>
      isSessionIdInScope(item.sessionId, sessionScope, rootSessionId) ||
      isSessionIdInScope(item.fromSessionId, sessionScope, rootSessionId),
  );
}

export function filterTeamDynamicEventsForScope(
  events: HandoffEvent[],
  sessionScope: ReadonlySet<string> | null,
  rootSessionId: string,
): HandoffEvent[] {
  return events.filter((event) => {
    if (!shouldDisplayEvent(event)) {
      return false;
    }

    const payload = event.payload;
    const payloadSessionIds = Array.isArray(payload['sessionIds'])
      ? payload['sessionIds'].filter(
          (value): value is string => typeof value === 'string' && value.length > 0,
        )
      : [];

    return (
      isSessionIdInScope(event.sessionId, sessionScope, rootSessionId) ||
      isSessionIdInScope(
        typeof payload['sessionId'] === 'string' ? payload['sessionId'] : null,
        sessionScope,
        rootSessionId,
      ) ||
      isSessionIdInScope(
        typeof payload['fromSessionId'] === 'string' ? payload['fromSessionId'] : null,
        sessionScope,
        rootSessionId,
      ) ||
      isSessionIdInScope(
        typeof payload['toSessionId'] === 'string' ? payload['toSessionId'] : null,
        sessionScope,
        rootSessionId,
      ) ||
      isSessionIdInScope(
        typeof payload['rootSessionId'] === 'string' ? payload['rootSessionId'] : null,
        sessionScope,
        rootSessionId,
      ) ||
      payloadSessionIds.some((sessionId) => isSessionIdInScope(sessionId, sessionScope, rootSessionId))
    );
  });
}

export function buildTeamDynamicEntries(events: HandoffEvent[]): TeamDynamicEntry[] {
  const groups: TeamDynamicEntry[] = [];
  const sorted = [...events].sort((left, right) => left.timestamp - right.timestamp);

  for (let index = 0; index < sorted.length; index += 1) {
    const event = sorted[index]!;
    if (!shouldDisplayEvent(event)) {
      continue;
    }

    const entry = mapEventToDynamicEntry(event, index);
    const last = groups[groups.length - 1];
    if (last && buildMergeKey(last) === buildMergeKey(entry)) {
      last.count += 1;
      last.timeLabel = entry.timeLabel;
      continue;
    }
    groups.push(entry);
  }

  return groups.slice(-4).reverse();
}
