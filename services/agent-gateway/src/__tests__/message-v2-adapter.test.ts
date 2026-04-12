import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { MessageID, PartID, TextPart } from '../message-v2-schema.js';

// ─── Mocks ───

const emittedEvents: Array<{ definition: { type: string }; aggregateID: string; data: unknown }> =
  [];
const busEventsPublished: Array<{ type: string; payload: unknown }> = [];

vi.mock('../sync-event.js', () => ({
  emitEvent: (input: { definition: { type: string }; aggregateID: string; data: unknown }) => {
    emittedEvents.push(input);
  },
  publishBusEvent: (type: string, payload: unknown) => {
    busEventsPublished.push({ type, payload });
  },
  MessageEvents: {
    Created: { type: 'message.created', version: 1, aggregate: 'sessionID' },
    Updated: { type: 'message.updated', version: 1, aggregate: 'sessionID' },
    Removed: { type: 'message.removed', version: 1, aggregate: 'sessionID' },
    PartCreated: { type: 'message.part.created', version: 1, aggregate: 'sessionID' },
    PartUpdated: { type: 'message.part.updated', version: 1, aggregate: 'sessionID' },
    PartDelta: { type: 'message.part.delta', version: 1, aggregate: 'sessionID' },
    PartRemoved: { type: 'message.part.removed', version: 1, aggregate: 'sessionID' },
  },
  SessionEvents: {
    Created: { type: 'session.created', version: 1, aggregate: 'sessionID' },
    Updated: { type: 'session.updated', version: 1, aggregate: 'sessionID' },
    Deleted: { type: 'session.deleted', version: 1, aggregate: 'sessionID' },
  },
  SessionBusEvents: {
    Diff: { type: 'session.diff' },
    Error: { type: 'session.error' },
    Compacted: { type: 'session.compacted' },
    Status: { type: 'session.status' },
  },
  TodoBusEvents: {
    Updated: { type: 'todo.updated' },
  },
}));

vi.mock('../message-v2-projectors.js', () => ({}));

vi.mock('../message-store-v2.js', () => ({
  insertMessage: vi.fn(),
  updateMessage: vi.fn(),
  deleteMessage: vi.fn(),
  getMessage: vi.fn(),
  listMessages: vi.fn(() => []),
  insertPart: vi.fn(),
  updatePart: vi.fn(),
  deletePart: vi.fn(),
  getPart: vi.fn(),
  listPartsForMessage: vi.fn(() => []),
  listPartsForSession: vi.fn(() => []),
  listMessagesWithParts: vi.fn(() => []),
  updatePartDelta: vi.fn(),
  findToolPartByCallID: vi.fn(),
  transitionToolToRunning: vi.fn(),
  transitionToolToCompleted: vi.fn(),
  transitionToolToError: vi.fn(),
  truncateMessagesAfter: vi.fn(),
}));

vi.mock('../session-message-store.js', () => ({
  appendSessionMessage: vi.fn(),
  listSessionMessages: vi.fn(() => []),
  truncateSessionMessagesAfter: vi.fn(),
}));

vi.mock('../session-snapshot-store.js', () => ({
  listSessionSnapshots: vi.fn(() => []),
}));

vi.mock('../session-file-diff-store.js', () => ({
  listSessionFileDiffs: vi.fn(() => []),
}));

vi.mock('../db.js', () => ({
  sqliteRun: vi.fn(),
  sqliteGet: vi.fn(),
  sqliteAll: vi.fn(() => []),
}));

import {
  removeMessageV2,
  removePartV2,
  updatePartV2,
  updatePartDeltaV2,
  appendSnapshotPart,
  appendPatchPart,
  emitSessionCreated,
  emitSessionUpdated,
  emitSessionDeleted,
  sessionRevert,
  sessionUnrevert,
  publishSessionDiff,
  publishSessionError,
  publishSessionCompacted,
  publishSessionStatus,
  publishTodoUpdated,
} from '../message-v2-adapter.js';

function toMessageId(value: string): MessageID {
  return value as MessageID;
}

function toPartId(value: string): PartID {
  return value as PartID;
}

function getFirstEventData<T>(events: Array<{ data: unknown }>): T {
  return events[0]!.data as T;
}

function getFirstBusPayload<T>(events: Array<{ payload: unknown }>): T {
  return events[0]!.payload as T;
}

describe('message-v2-adapter', () => {
  beforeEach(() => {
    emittedEvents.length = 0;
    busEventsPublished.length = 0;
  });

  // ─── Message/Part Event-Sourced Operations ───

  it('removeMessageV2 emits message.removed event', () => {
    removeMessageV2({ sessionId: 'session-1', messageID: toMessageId('msg-1') });
    expect(emittedEvents).toHaveLength(1);
    expect(emittedEvents[0]!.definition.type).toBe('message.removed');
    expect(emittedEvents[0]!.data).toEqual({ sessionID: 'session-1', messageID: 'msg-1' });
  });

  it('removePartV2 emits message.part.removed event', () => {
    removePartV2({
      sessionId: 'session-1',
      messageID: toMessageId('msg-1'),
      partID: toPartId('part-1'),
    });
    expect(emittedEvents).toHaveLength(1);
    expect(emittedEvents[0]!.definition.type).toBe('message.part.removed');
    expect(emittedEvents[0]!.data).toEqual({
      sessionID: 'session-1',
      messageID: 'msg-1',
      partID: 'part-1',
    });
  });

  it('updatePartV2 emits message.part.updated event', () => {
    const part: TextPart = {
      type: 'text',
      id: toPartId('part-1'),
      sessionID: 'session-1',
      messageID: toMessageId('msg-1'),
      text: 'updated',
    };
    updatePartV2({ sessionId: 'session-1', part, time: 12345 });
    expect(emittedEvents).toHaveLength(1);
    expect(emittedEvents[0]!.definition.type).toBe('message.part.updated');
    expect(getFirstEventData<{ time: number }>(emittedEvents).time).toBe(12345);
  });

  it('updatePartV2 defaults time to Date.now()', () => {
    const part: TextPart = {
      type: 'text',
      id: toPartId('part-1'),
      sessionID: 'session-1',
      messageID: toMessageId('msg-1'),
      text: 'hi',
    };
    const before = Date.now();
    updatePartV2({ sessionId: 'session-1', part });
    const after = Date.now();
    const data = getFirstEventData<{ time: number }>(emittedEvents);
    expect(data.time).toBeGreaterThanOrEqual(before);
    expect(data.time).toBeLessThanOrEqual(after);
  });

  it('updatePartDeltaV2 emits message.part.delta event', () => {
    updatePartDeltaV2({
      sessionId: 'session-1',
      messageId: toMessageId('msg-1'),
      partId: toPartId('part-1'),
      field: 'text',
      delta: ' world',
    });
    expect(emittedEvents).toHaveLength(1);
    expect(emittedEvents[0]!.definition.type).toBe('message.part.delta');
    expect(emittedEvents[0]!.data).toEqual({
      sessionID: 'session-1',
      messageID: 'msg-1',
      partID: 'part-1',
      field: 'text',
      delta: ' world',
    });
  });

  // ─── Snapshot/Patch Part Integration ───

  it('appendSnapshotPart emits message.part.created with SnapshotPart', () => {
    appendSnapshotPart({
      sessionId: 'session-1',
      messageId: toMessageId('msg-1'),
      snapshotRef: 'req:req-1',
    });
    expect(emittedEvents).toHaveLength(1);
    expect(emittedEvents[0]!.definition.type).toBe('message.part.created');
    const part = getFirstEventData<{ part: { type: string; snapshot: string } }>(
      emittedEvents,
    ).part;
    expect(part.type).toBe('snapshot');
    expect(part.snapshot).toBe('req:req-1');
  });

  it('appendPatchPart emits message.part.created with PatchPart', () => {
    appendPatchPart({
      sessionId: 'session-1',
      messageId: toMessageId('msg-1'),
      hash: 'abc123',
      files: ['/a.ts', '/b.ts'],
    });
    expect(emittedEvents).toHaveLength(1);
    expect(emittedEvents[0]!.definition.type).toBe('message.part.created');
    const part = getFirstEventData<{ part: { type: string; hash: string; files: string[] } }>(
      emittedEvents,
    ).part;
    expect(part.type).toBe('patch');
    expect(part.hash).toBe('abc123');
    expect(part.files).toEqual(['/a.ts', '/b.ts']);
  });

  // ─── Session Event Adapters ───

  it('emitSessionCreated emits session.created', () => {
    emitSessionCreated({
      sessionID: 'session-1',
      info: { id: 'session-1', userID: 'user-1', time: { created: 1, updated: 1 } },
    });
    expect(emittedEvents).toHaveLength(1);
    expect(emittedEvents[0]!.definition.type).toBe('session.created');
    expect(emittedEvents[0]!.aggregateID).toBe('session-1');
  });

  it('emitSessionUpdated emits session.updated with partial info', () => {
    emitSessionUpdated({ sessionID: 'session-1', info: { title: 'New Title' } });
    expect(emittedEvents).toHaveLength(1);
    expect(emittedEvents[0]!.definition.type).toBe('session.updated');
    expect(getFirstEventData<{ info: { title?: string } }>(emittedEvents).info.title).toBe(
      'New Title',
    );
  });

  it('emitSessionDeleted emits session.deleted', () => {
    emitSessionDeleted({
      sessionID: 'session-1',
      info: { id: 'session-1', userID: 'user-1', time: { created: 1, updated: 1 } },
    });
    expect(emittedEvents).toHaveLength(1);
    expect(emittedEvents[0]!.definition.type).toBe('session.deleted');
  });

  // ─── Session Revert ───

  it('sessionRevert emits session.updated with revert info', () => {
    sessionRevert({
      sessionID: 'session-1',
      messageID: toMessageId('msg-5'),
      partID: toPartId('part-3'),
      snapshot: 'snap-1',
    });
    expect(emittedEvents).toHaveLength(1);
    expect(emittedEvents[0]!.definition.type).toBe('session.updated');
    const info = getFirstEventData<{
      info: { revert: { messageID: MessageID; partID?: PartID; snapshot?: string } };
    }>(emittedEvents).info;
    expect(info.revert.messageID).toBe('msg-5');
    expect(info.revert.partID).toBe('part-3');
    expect(info.revert.snapshot).toBe('snap-1');
  });

  it('sessionUnrevert emits session.updated with null revert', () => {
    sessionUnrevert({ sessionID: 'session-1' });
    expect(emittedEvents).toHaveLength(1);
    const info = getFirstEventData<{ info: { revert: null } }>(emittedEvents).info;
    expect(info.revert).toBeNull();
  });

  // ─── BusEvent Publishers ───

  it('publishSessionDiff publishes session.diff bus event', () => {
    publishSessionDiff({
      sessionID: 'session-1',
      diffs: [{ file: '/a.ts', patch: '@@ -1 +1 @@' }],
    });
    expect(busEventsPublished).toHaveLength(1);
    expect(busEventsPublished[0]!.type).toBe('session.diff');
  });

  it('publishSessionError publishes session.error bus event', () => {
    publishSessionError({ sessionID: 'session-1', error: { name: 'APIError', message: 'fail' } });
    expect(busEventsPublished).toHaveLength(1);
    expect(busEventsPublished[0]!.type).toBe('session.error');
  });

  it('publishSessionCompacted publishes session.compacted bus event', () => {
    publishSessionCompacted({ sessionID: 'session-1' });
    expect(busEventsPublished).toHaveLength(1);
    expect(busEventsPublished[0]!.type).toBe('session.compacted');
  });

  it('publishSessionStatus publishes session.status bus event', () => {
    publishSessionStatus({ sessionID: 'session-1', status: 'running' });
    expect(busEventsPublished).toHaveLength(1);
    expect(busEventsPublished[0]!.type).toBe('session.status');
    expect(getFirstBusPayload<{ status: string }>(busEventsPublished).status).toBe('running');
  });

  it('publishTodoUpdated publishes todo.updated bus event', () => {
    publishTodoUpdated({
      sessionID: 'session-1',
      todos: [{ content: 'Task', status: 'pending', priority: 'high' }],
    });
    expect(busEventsPublished).toHaveLength(1);
    expect(busEventsPublished[0]!.type).toBe('todo.updated');
    expect(
      getFirstBusPayload<{ todos: Array<{ content: string }> }>(busEventsPublished).todos,
    ).toHaveLength(1);
  });
});
