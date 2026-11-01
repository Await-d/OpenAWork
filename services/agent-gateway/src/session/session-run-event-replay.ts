import type { RunEvent } from '@openAwork/shared';
import { setImmediate as yieldToLoop } from 'node:timers/promises';
import { sqliteAll, sqliteGet } from '../infra/db.js';
import { flushSessionRunEventQueue } from './session-run-events.js';
import {
  RUN_EVENT_MAX_BYTES,
  RUN_EVENT_PAGE_MAX_BYTES,
  RunEventSizeError,
} from './run-event-size-budget.js';

export const RUN_EVENT_REPLAY_PAGE_SIZE = 128;

interface ReplayRow {
  id: number;
  seq: number | null;
  client_request_id: string | null;
  occurred: number;
  bytes: number;
}

export interface ReplayEvent {
  event: RunEvent;
  cursor: number;
  clientRequestId: string | undefined;
}

export interface RunEventReplayPage {
  events: ReplayEvent[];
  nextCursor: number;
  more: boolean;
}

export type RunEventReplayReader = (after: number) => RunEventReplayPage;
const METADATA =
  'id, seq, client_request_id, COALESCE(occurred_at_ms, 0) AS occurred, octet_length(payload_json) AS bytes';

function parseRow(row: ReplayRow): RunEvent | undefined {
  if (row.bytes > RUN_EVENT_MAX_BYTES) throw new RunEventSizeError();
  const payload = sqliteGet<{ payload: string | null }>(
    'SELECT CASE WHEN octet_length(payload_json) <= ? THEN payload_json ELSE NULL END AS payload FROM session_run_events WHERE id = ?',
    [RUN_EVENT_MAX_BYTES, row.id],
  )?.payload;
  if (payload === null) throw new RunEventSizeError();
  if (payload === undefined) return undefined;
  if (Buffer.byteLength(payload) > RUN_EVENT_MAX_BYTES) throw new RunEventSizeError();
  try {
    return JSON.parse(payload) as RunEvent;
  } catch {
    return undefined;
  }
}

/** 旧 NULL seq 保留末尾排序语义；坏行跨窗口时让出执行权，不使用 OFFSET。 */
export async function getLatestRequestRunEvent(
  sessionId: string,
  clientRequestId: string,
): Promise<RunEvent | undefined> {
  flushSessionRunEventQueue(sessionId);
  for (const nullSeq of [true, false]) {
    let before: ReplayRow | undefined;
    while (true) {
      const tuple = nullSeq
        ? '(COALESCE(occurred_at_ms, 0), id)'
        : '(seq, COALESCE(occurred_at_ms, 0), id)';
      const rows = sqliteAll<ReplayRow>(
        `SELECT ${METADATA} FROM session_run_events
         WHERE session_id = ? AND client_request_id = ? AND seq IS ${nullSeq ? '' : 'NOT '}NULL
         ${before ? `AND ${tuple} < (${nullSeq ? '?, ?' : '?, ?, ?'})` : ''}
         ORDER BY ${nullSeq ? '' : 'seq DESC, '}COALESCE(occurred_at_ms, 0) DESC, id DESC LIMIT ?`,
        [
          sessionId,
          clientRequestId,
          ...(before ? [...(nullSeq ? [] : [before.seq!]), before.occurred, before.id] : []),
          RUN_EVENT_REPLAY_PAGE_SIZE,
        ],
      );
      let bytes = 0;
      for (const row of rows) {
        if (bytes + row.bytes > RUN_EVENT_PAGE_MAX_BYTES) {
          await yieldToLoop();
          bytes = 0;
        }
        const event = parseRow(row);
        bytes += row.bytes;
        if (event) return event;
      }
      if (rows.length < RUN_EVENT_REPLAY_PAGE_SIZE) break;
      before = rows.at(-1);
      await yieldToLoop();
    }
  }
  return undefined;
}

/** 固定高水位；先读轻量元信息，再按页字节预算读取正文。 */
export function createRunEventReplayReader(input: {
  sessionId: string;
  clientRequestId?: string;
}): RunEventReplayReader {
  flushSessionRunEventQueue(input.sessionId);
  const scoped = input.clientRequestId !== undefined;
  const column = scoped ? 'seq' : 'id';
  const scope = scoped ? ' AND client_request_id = ?' : '';
  const parameters = scoped ? [input.sessionId, input.clientRequestId!] : [input.sessionId];
  const upper =
    sqliteGet<{ cursor: number | null }>(
      `SELECT MAX(${column}) AS cursor FROM session_run_events WHERE session_id = ?${scope}`,
      parameters,
    )?.cursor ?? 0;

  return (after) => {
    const rows = sqliteAll<ReplayRow>(
      `SELECT ${METADATA} FROM session_run_events
       WHERE session_id = ?${scope} AND ${column} > ? AND ${column} <= ?
       ORDER BY ${column} ASC, id ASC LIMIT ?`,
      [...parameters, after, upper, RUN_EVENT_REPLAY_PAGE_SIZE],
    );
    const events: ReplayEvent[] = [];
    let nextCursor = after;
    let bytes = 0;
    for (const row of rows) {
      if (row.bytes > RUN_EVENT_MAX_BYTES || bytes + row.bytes > RUN_EVENT_PAGE_MAX_BYTES) {
        if (nextCursor > after) return { events, nextCursor, more: true };
        throw new RunEventSizeError();
      }
      const event = parseRow(row);
      bytes += row.bytes;
      nextCursor = scoped ? row.seq! : row.id;
      if (event)
        events.push({
          event,
          cursor: nextCursor,
          clientRequestId: row.client_request_id ?? undefined,
        });
    }
    return {
      events,
      nextCursor: rows.length === 0 ? upper : nextCursor,
      more: rows.length === RUN_EVENT_REPLAY_PAGE_SIZE && nextCursor < upper,
    };
  };
}
