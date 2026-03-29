import { describe, expect, it } from 'vitest';
import { parseUlwVerifyDecision } from '../routes/command-helpers.js';

describe('parseUlwVerifyDecision', () => {
  it('parses --pass followed by a note', () => {
    const result = parseUlwVerifyDecision({
      named: { pass: 'looks-good' },
      positional: ['after', 'review'],
    });

    expect(result).toEqual({
      decision: 'pass',
      note: 'looks-good after review',
    });
  });

  it('parses --fail followed by a reason', () => {
    const result = parseUlwVerifyDecision({
      named: { fail: 'missing-proof' },
      positional: ['needs', 'evidence'],
    });

    expect(result).toEqual({
      decision: 'fail',
      note: 'missing-proof needs evidence',
    });
  });

  it('rejects ambiguous or missing decision flags', () => {
    expect(parseUlwVerifyDecision({ named: {}, positional: [] })).toEqual({
      decision: null,
      note: '',
    });

    expect(parseUlwVerifyDecision({ named: { pass: true, fail: true }, positional: [] })).toEqual({
      decision: null,
      note: '',
    });
  });
});
