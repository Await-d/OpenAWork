import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sqliteRunMock: vi.fn<(query: string, params: unknown[]) => void>(),
}));

vi.mock('../db.js', () => ({
  sqliteRun: mocks.sqliteRunMock,
}));

import { writeAuditLog } from '../audit-log.js';

describe('writeAuditLog', () => {
  beforeEach(() => {
    mocks.sqliteRunMock.mockReset();
  });

  it('falls back for top-level function and symbol values', () => {
    function namedAuditHandler(): void {}

    writeAuditLog({
      sessionId: 'session-1',
      category: 'tool',
      sourceName: 'bash',
      requestId: 'request-1',
      input: namedAuditHandler,
      output: Symbol.for('audit-log'),
    });

    expect(mocks.sqliteRunMock).toHaveBeenCalledTimes(1);
    const [, params] = mocks.sqliteRunMock.mock.calls[0] ?? [];
    expect(params).toEqual([
      'session-1',
      'bash',
      'request-1',
      '[Function: namedAuditHandler]',
      'Symbol(audit-log)',
      1,
      null,
    ]);
  });

  it('preserves JSON serialization for regular objects', () => {
    writeAuditLog({
      sessionId: 'session-2',
      category: 'route',
      sourceName: 'STREAM_ERROR',
      requestId: 'request-2',
      input: { reason: 'network' },
      output: { message: 'failed' },
      isError: false,
      durationMs: 25,
    });

    expect(mocks.sqliteRunMock).toHaveBeenCalledTimes(1);
    const [, params] = mocks.sqliteRunMock.mock.calls[0] ?? [];
    expect(params).toEqual([
      'session-2',
      'route:STREAM_ERROR',
      'request-2',
      '{"reason":"network"}',
      '{"message":"failed"}',
      0,
      25,
    ]);
  });

  it('keeps non function or symbol undefined serialization as null', () => {
    const hiddenPayload = {
      toJSON: () => undefined,
    };

    writeAuditLog({
      sessionId: 'session-3',
      category: 'stream',
      sourceName: 'STREAM_ERROR',
      requestId: 'request-3',
      input: hiddenPayload,
      output: hiddenPayload,
    });

    expect(mocks.sqliteRunMock).toHaveBeenCalledTimes(1);
    const [, params] = mocks.sqliteRunMock.mock.calls[0] ?? [];
    expect(params).toEqual(['session-3', 'stream:STREAM_ERROR', 'request-3', null, null, 1, null]);
  });

  it('preserves custom toJSON for top-level function objects', () => {
    const serializableHandler = Object.assign(function auditCallable(): void {}, {
      toJSON: () => ({ type: 'callable' }),
    });

    writeAuditLog({
      sessionId: 'session-4',
      category: 'tool',
      sourceName: 'task',
      requestId: 'request-4',
      input: serializableHandler,
      output: serializableHandler,
    });

    expect(mocks.sqliteRunMock).toHaveBeenCalledTimes(1);
    const [, params] = mocks.sqliteRunMock.mock.calls[0] ?? [];
    expect(params).toEqual([
      'session-4',
      'task',
      'request-4',
      '{"type":"callable"}',
      '{"type":"callable"}',
      1,
      null,
    ]);
  });
});
