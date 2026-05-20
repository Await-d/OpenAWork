import { afterEach, describe, expect, it } from 'vitest';
import {
  checkDoomLoop,
  clearAllDoomLoopHistory,
  peekDoomLoop,
  recordDoomLoopEntry,
  resetDoomLoopHistory,
} from '../../session/doom-loop-detector.js';

const SESSION = 'sess-test';

afterEach(() => {
  clearAllDoomLoopHistory();
});

describe('doom-loop-detector', () => {
  describe('peekDoomLoop / recordDoomLoopEntry', () => {
    it('peek does not mutate history', () => {
      const args = { command: 'ls' };
      // Three peeks in a row never trip the threshold, because history
      // stays empty.
      expect(peekDoomLoop(SESSION, 'bash', args)).toBe(false);
      expect(peekDoomLoop(SESSION, 'bash', args)).toBe(false);
      expect(peekDoomLoop(SESSION, 'bash', args)).toBe(false);
    });

    it('record trips the threshold on the third identical entry', () => {
      const args = { command: 'ls' };
      recordDoomLoopEntry(SESSION, 'bash', args);
      recordDoomLoopEntry(SESSION, 'bash', args);
      // Third identical attempt — peek should report a loop *before*
      // we record the third entry, matching the stream.ts pattern.
      expect(peekDoomLoop(SESSION, 'bash', args)).toBe(true);
    });

    it('peek returns false when the history has fewer than threshold-1 entries', () => {
      const args = { command: 'ls' };
      expect(peekDoomLoop(SESSION, 'bash', args)).toBe(false);
      recordDoomLoopEntry(SESSION, 'bash', args);
      // History is 1, threshold is 3, threshold-1 is 2 — still below.
      expect(peekDoomLoop(SESSION, 'bash', args)).toBe(false);
    });

    it('different args between attempts breaks the loop signal', () => {
      recordDoomLoopEntry(SESSION, 'bash', { command: 'ls' });
      recordDoomLoopEntry(SESSION, 'bash', { command: 'pwd' });
      // Third attempt with the original args is not 3-in-a-row.
      expect(peekDoomLoop(SESSION, 'bash', { command: 'ls' })).toBe(false);
    });

    it('different tool names break the loop signal', () => {
      const args = { command: 'ls' };
      recordDoomLoopEntry(SESSION, 'bash', args);
      recordDoomLoopEntry(SESSION, 'bash', args);
      expect(peekDoomLoop(SESSION, 'read', args)).toBe(false);
    });

    it('treats objects with the same keys but different ordering as identical', () => {
      // Different upstream models / re-serialization layers may emit
      // the same logical args with different key ordering. The hash
      // must be order-insensitive, otherwise a real loop slips
      // through (model re-emits same call N times, hash differs each
      // time, doom loop never triggers).
      recordDoomLoopEntry(SESSION, 'bash', { command: 'ls', workdir: '/x' });
      recordDoomLoopEntry(SESSION, 'bash', { workdir: '/x', command: 'ls' });
      expect(peekDoomLoop(SESSION, 'bash', { command: 'ls', workdir: '/x' })).toBe(true);
    });

    it('preserves array order when hashing (different array order is not a match)', () => {
      // Arrays are sequence-sensitive — `[a, b]` and `[b, a]` carry
      // different semantics in most tool inputs (e.g. command flags),
      // so they must hash differently.
      recordDoomLoopEntry(SESSION, 'tool', { items: ['a', 'b'] });
      recordDoomLoopEntry(SESSION, 'tool', { items: ['a', 'b'] });
      expect(peekDoomLoop(SESSION, 'tool', { items: ['b', 'a'] })).toBe(false);
    });

    it('handles nested objects with mixed key ordering', () => {
      const a = { outer: { x: 1, y: 2 }, top: 'k' };
      const b = { top: 'k', outer: { y: 2, x: 1 } };
      recordDoomLoopEntry(SESSION, 'bash', a);
      recordDoomLoopEntry(SESSION, 'bash', b);
      expect(peekDoomLoop(SESSION, 'bash', a)).toBe(true);
    });

    it('skipping record (e.g. on schema validation failure) prevents the false positive', () => {
      // Simulates the scenario from the screenshot: model fires the
      // same bash call three times in a row but every attempt is
      // rejected by schema validation (missing description) — the
      // dispatcher peeks but never records, so no loop is signalled.
      const args = { command: 'git status' };
      expect(peekDoomLoop(SESSION, 'bash', args)).toBe(false);
      expect(peekDoomLoop(SESSION, 'bash', args)).toBe(false);
      expect(peekDoomLoop(SESSION, 'bash', args)).toBe(false);
    });
  });

  describe('checkDoomLoop legacy combined op', () => {
    it('returns true on the third identical record', () => {
      const args = { command: 'ls' };
      expect(checkDoomLoop(SESSION, 'bash', args)).toBe(false);
      expect(checkDoomLoop(SESSION, 'bash', args)).toBe(false);
      expect(checkDoomLoop(SESSION, 'bash', args)).toBe(true);
    });

    it('does not report a loop until exactly threshold consecutive entries', () => {
      const args = { command: 'ls' };
      expect(checkDoomLoop(SESSION, 'bash', args)).toBe(false);
      expect(checkDoomLoop(SESSION, 'bash', args)).toBe(false);
    });
  });

  describe('resetDoomLoopHistory', () => {
    it('clears history for a single session', () => {
      const args = { command: 'ls' };
      recordDoomLoopEntry(SESSION, 'bash', args);
      recordDoomLoopEntry(SESSION, 'bash', args);
      resetDoomLoopHistory(SESSION);
      // Fresh peek after reset must not see a pending loop.
      expect(peekDoomLoop(SESSION, 'bash', args)).toBe(false);
    });
  });
});
