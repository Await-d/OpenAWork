import { describe, expect, it } from 'vitest';
import {
  normalizeSqliteBindParams,
  normalizeUnknownSqliteBindParams,
} from '../sqlite-bind-params.js';

describe('sqlite bind params', () => {
  it('normalizes boolean and undefined values before node:sqlite binding', () => {
    expect(normalizeSqliteBindParams([true, false, undefined, 'session-1', 3])).toEqual([
      1,
      0,
      null,
      'session-1',
      3,
    ]);
  });

  it('rejects unsupported object parameters with a clear error', () => {
    expect(() => normalizeUnknownSqliteBindParams([{ sessionId: 'session-1' }])).toThrow(
      'Unsupported SQLite bind parameter type: object',
    );
  });

  it('rejects array parameters instead of treating them as named binds', () => {
    expect(() => normalizeUnknownSqliteBindParams([['session-1']])).toThrow(
      'Unsupported SQLite bind parameter type: array',
    );
  });
});
