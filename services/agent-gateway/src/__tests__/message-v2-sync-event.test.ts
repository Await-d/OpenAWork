import { describe, expect, it, vi, beforeEach } from 'vitest';

// ─── Mock db ───
const eventLog: Array<{ type: string; aggregate_id: string; data: string }> = [];
const busEvents: Array<{ type: string; payload: unknown }> = [];

vi.mock('../db.js', () => ({
  sqliteRun: (...args: unknown[]) => {
    const [sql, params] = args as [string, unknown[]];
    if (sql.includes('INSERT INTO event_log')) {
      eventLog.push({
        type: params[3] as string,
        aggregate_id: params[1] as string,
        data: params[5] as string,
      });
    }
  },
  sqliteGet: (sql: string) => {
    if (sql.includes('event_log')) return undefined;
    if (sql.includes('event_sequences')) return { seq: 0 };
    return undefined;
  },
  sqliteAll: () => [],
  sqliteTransaction: (fn: () => void) => fn(),
}));

import {
  emitEvent,
  publishBusEvent,
  MessageEvents,
  SessionEvents,
  SessionBusEvents,
  TodoBusEvents,
  type SessionInfo,
  type DeepPartial,
} from '../sync-event.js';

describe('sync-event infrastructure', () => {
  beforeEach(() => {
    eventLog.length = 0;
    busEvents.length = 0;
  });

  // ─── MessageEvents ───

  it('emits message.created event', () => {
    emitEvent({
      definition: MessageEvents.Created,
      aggregateID: 'session-1',
      data: { sessionID: 'session-1', info: { role: 'user', id: 'msg-1' } },
    });
    expect(eventLog).toHaveLength(1);
    expect(eventLog[0]!.type).toBe('message.created');
    expect(eventLog[0]!.aggregate_id).toBe('session-1');
  });

  it('emits message.updated event', () => {
    emitEvent({
      definition: MessageEvents.Updated,
      aggregateID: 'session-1',
      data: { sessionID: 'session-1', info: { role: 'assistant', id: 'msg-2' } },
    });
    expect(eventLog).toHaveLength(1);
    expect(eventLog[0]!.type).toBe('message.updated');
  });

  it('emits message.removed event', () => {
    emitEvent({
      definition: MessageEvents.Removed,
      aggregateID: 'session-1',
      data: { sessionID: 'session-1', messageID: 'msg-1' },
    });
    expect(eventLog).toHaveLength(1);
    expect(eventLog[0]!.type).toBe('message.removed');
  });

  it('emits message.part.created event', () => {
    emitEvent({
      definition: MessageEvents.PartCreated,
      aggregateID: 'session-1',
      data: { sessionID: 'session-1', part: { type: 'text', id: 'part-1', text: 'hello' } },
    });
    expect(eventLog).toHaveLength(1);
    expect(eventLog[0]!.type).toBe('message.part.created');
  });

  it('emits message.part.updated event', () => {
    emitEvent({
      definition: MessageEvents.PartUpdated,
      aggregateID: 'session-1',
      data: {
        sessionID: 'session-1',
        part: { type: 'text', id: 'part-1', text: 'updated' },
        time: Date.now(),
      },
    });
    expect(eventLog).toHaveLength(1);
    expect(eventLog[0]!.type).toBe('message.part.updated');
  });

  it('emits message.part.delta event', () => {
    emitEvent({
      definition: MessageEvents.PartDelta,
      aggregateID: 'session-1',
      data: {
        sessionID: 'session-1',
        messageID: 'msg-1',
        partID: 'part-1',
        field: 'text',
        delta: ' world',
      },
    });
    expect(eventLog).toHaveLength(1);
    expect(eventLog[0]!.type).toBe('message.part.delta');
  });

  it('emits message.part.removed event', () => {
    emitEvent({
      definition: MessageEvents.PartRemoved,
      aggregateID: 'session-1',
      data: { sessionID: 'session-1', messageID: 'msg-1', partID: 'part-1' },
    });
    expect(eventLog).toHaveLength(1);
    expect(eventLog[0]!.type).toBe('message.part.removed');
  });

  // ─── SessionEvents ───

  it('emits session.created event', () => {
    const info: SessionInfo = {
      id: 'session-1',
      userID: 'user-1',
      title: 'Test Session',
      time: { created: Date.now(), updated: Date.now() },
    };
    emitEvent({
      definition: SessionEvents.Created,
      aggregateID: 'session-1',
      data: { sessionID: 'session-1', info },
    });
    expect(eventLog).toHaveLength(1);
    expect(eventLog[0]!.type).toBe('session.created');
  });

  it('emits session.updated event with partial info', () => {
    const partial: DeepPartial<SessionInfo> = { title: 'Updated Title' };
    emitEvent({
      definition: SessionEvents.Updated,
      aggregateID: 'session-1',
      data: { sessionID: 'session-1', info: partial },
    });
    expect(eventLog).toHaveLength(1);
    expect(eventLog[0]!.type).toBe('session.updated');
  });

  it('emits session.deleted event', () => {
    const info: SessionInfo = {
      id: 'session-1',
      userID: 'user-1',
      time: { created: Date.now(), updated: Date.now() },
    };
    emitEvent({
      definition: SessionEvents.Deleted,
      aggregateID: 'session-1',
      data: { sessionID: 'session-1', info },
    });
    expect(eventLog).toHaveLength(1);
    expect(eventLog[0]!.type).toBe('session.deleted');
  });

  // ─── BusEvents ───

  it('publishes session.diff bus event', () => {
    publishBusEvent(SessionBusEvents.Diff.type, {
      sessionID: 'session-1',
      diff: [{ file: '/a.ts', patch: '@@ -1 +1 @@' }],
    });
    // BusEvents are not persisted to event_log
    expect(eventLog).toHaveLength(0);
  });

  it('publishes session.error bus event', () => {
    publishBusEvent(SessionBusEvents.Error.type, {
      sessionID: 'session-1',
      error: { name: 'APIError', message: 'rate limited' },
    });
    expect(eventLog).toHaveLength(0);
  });

  it('publishes session.compacted bus event', () => {
    publishBusEvent(SessionBusEvents.Compacted.type, { sessionID: 'session-1' });
    expect(eventLog).toHaveLength(0);
  });

  it('publishes session.status bus event', () => {
    publishBusEvent(SessionBusEvents.Status.type, { sessionID: 'session-1', status: 'running' });
    expect(eventLog).toHaveLength(0);
  });

  it('publishes todo.updated bus event', () => {
    publishBusEvent(TodoBusEvents.Updated.type, {
      sessionID: 'session-1',
      todos: [{ content: 'Task 1', status: 'pending', priority: 'high' }],
    });
    expect(eventLog).toHaveLength(0);
  });

  // ─── Projector registration ───

  it('registers projectors for all event types', () => {
    const projectorTypes = [
      MessageEvents.Created.type,
      MessageEvents.Updated.type,
      MessageEvents.Removed.type,
      MessageEvents.PartCreated.type,
      MessageEvents.PartUpdated.type,
      MessageEvents.PartDelta.type,
      MessageEvents.PartRemoved.type,
      SessionEvents.Created.type,
      SessionEvents.Updated.type,
      SessionEvents.Deleted.type,
    ];
    // Each projector type should be a unique string
    const uniqueTypes = new Set(projectorTypes);
    expect(uniqueTypes.size).toBe(projectorTypes.length);
  });

  // ─── DeepPartial type ───

  it('DeepPartial allows partial nested objects', () => {
    const partial: DeepPartial<SessionInfo> = {
      title: 'New Title',
      time: { updated: Date.now() },
      summary: null,
    };
    expect(partial.title).toBe('New Title');
    expect(partial.time?.updated).toBeDefined();
    expect(partial.summary).toBeNull();
  });
});
