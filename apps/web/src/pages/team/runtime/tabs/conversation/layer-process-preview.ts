import type { HandoffRecord } from '@openAwork/web-client';
import { extractLayerDialoguePreview, type LayerDialoguePreview } from './layer-dialogue-preview.js';

export type LayerProcessRecordKind = 'incoming' | 'outgoing' | 'related';

export interface LayerProcessRecord {
  id: string;
  kind: LayerProcessRecordKind;
  preview: LayerDialoguePreview;
  record: HandoffRecord;
  timeMs: number;
}

function parseRecordTimeMs(record: HandoffRecord): number {
  const value = record.completedAt ?? record.updatedAt;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function classifyProcessRecordKind(
  record: HandoffRecord,
  sessionId: string,
): LayerProcessRecordKind {
  if (record.toSessionId === sessionId) {
    return 'incoming';
  }
  if (record.fromSessionId === sessionId) {
    return 'outgoing';
  }
  return 'related';
}

function isRelatedToSession(record: HandoffRecord, sessionId: string): boolean {
  return record.toSessionId === sessionId || record.fromSessionId === sessionId;
}

export function resolveLayerProcessRecords(input: {
  focusHandoffId?: string | null;
  maxItems?: number;
  records: HandoffRecord[];
  sessionId: string | null;
}): LayerProcessRecord[] {
  if (!input.sessionId) {
    return [];
  }

  const maxItems = input.maxItems ?? 4;
  const relatedRecords = input.records
    .filter((record) => isRelatedToSession(record, input.sessionId!))
    .map((record) => ({
      id: record.id,
      kind: classifyProcessRecordKind(record, input.sessionId!),
      preview: extractLayerDialoguePreview(record.payload, null),
      record,
      timeMs: parseRecordTimeMs(record),
    }))
    .sort((left, right) => left.timeMs - right.timeMs);

  if (relatedRecords.length === 0) {
    return [];
  }

  const focusedRecord = input.focusHandoffId
    ? (relatedRecords.find((record) => record.id === input.focusHandoffId) ?? null)
    : null;
  const anchorTimeMs = focusedRecord?.timeMs ?? relatedRecords[relatedRecords.length - 1]!.timeMs;
  const currentRoundStartRecord =
    [...relatedRecords]
      .reverse()
      .find((record) => record.kind === 'incoming' && record.timeMs <= anchorTimeMs) ?? null;

  const windowedRecords =
    currentRoundStartRecord !== null
      ? relatedRecords.filter(
          (record) => record.timeMs >= currentRoundStartRecord.timeMs && record.timeMs <= anchorTimeMs,
        )
      : relatedRecords.filter((record) => record.timeMs <= anchorTimeMs);

  const selectedWindow =
    windowedRecords.length > 0
      ? windowedRecords.slice(-maxItems)
      : relatedRecords.filter((record) => record.timeMs <= anchorTimeMs).slice(-maxItems);

  return selectedWindow;
}

export function summarizeLayerProcessRecord(record: LayerProcessRecord): string {
  return (
    record.preview.summary ??
    record.preview.rewrittenIntent ??
    record.preview.sourceIntent ??
    record.preview.recommendedNextStep ??
    record.record.failureReason ??
    '当前交接没有留下更详细的文字记录。'
  );
}
