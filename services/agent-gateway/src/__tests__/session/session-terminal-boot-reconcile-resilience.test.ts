/**
 * Regression (§0.109, boot-time per-row reconcile isolation):
 * reconcileStaleRunningTerminalsAtBoot flips every still-`running` terminal row
 * to `stale` after a gateway restart so the UI doesn't show ghost terminals.
 * Before the fix the per-row UPDATE was unguarded, so one row throwing (DB lock
 * / disk error) aborted the rest of the sweep — leaving the remaining ghost
 * terminals stuck showing `running`. And it returned the PLANNED row count, not
 * actual successes. The loop now isolates per row and returns the real count.
 * We mock db.js so one row's UPDATE throws and assert the rest are still flipped
 * and the returned count reflects actual successes.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as RegistryModule from '../../session/session-terminal-registry.js';

const POISON_TERMINAL_ID = 't-poison';
const GOOD_TERMINAL_ID_1 = 't-good-1';
const GOOD_TERMINAL_ID_2 = 't-good-2';

const updatedTerminalIds: string[] = [];

vi.mock('../../session/session-run-events.js', () => ({
  publishSessionRunEvent: vi.fn(),
}));

vi.mock('../../infra/db.js', () => ({
  // Boot reconcile query → three running terminals (poison in the middle so we
  // prove the loop continues past the throwing row).
  sqliteAll: (sql: string) => {
    if (/FROM\s+session_terminals/i.test(sql)) {
      return [
        { terminal_id: GOOD_TERMINAL_ID_1 },
        { terminal_id: POISON_TERMINAL_ID },
        { terminal_id: GOOD_TERMINAL_ID_2 },
      ];
    }
    return [];
  },
  sqliteGet: () => undefined,
  // UPDATE params end with the terminal_id; throw for the poison row only.
  sqliteRun: (_sql: string, params: unknown[] = []) => {
    const terminalId = params[params.length - 1];
    if (terminalId === POISON_TERMINAL_ID) {
      throw new Error('simulated terminal UPDATE failure');
    }
    if (typeof terminalId === 'string') {
      updatedTerminalIds.push(terminalId);
    }
  },
}));

let registry: typeof RegistryModule;

beforeEach(async () => {
  updatedTerminalIds.length = 0;
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  registry = await import('../../session/session-terminal-registry.js');
});

describe('reconcileStaleRunningTerminalsAtBoot per-row resilience', () => {
  it('单行 UPDATE 抛错时不中断，其余行仍被标记 stale 且返回实际成功数', () => {
    // Must not throw despite the poison row's UPDATE failing.
    let count = 0;
    expect(() => {
      count = registry.reconcileStaleRunningTerminalsAtBoot();
    }).not.toThrow();

    // Both healthy rows were flipped; the poison one was skipped.
    expect(updatedTerminalIds).toContain(GOOD_TERMINAL_ID_1);
    expect(updatedTerminalIds).toContain(GOOD_TERMINAL_ID_2);
    expect(updatedTerminalIds).not.toContain(POISON_TERMINAL_ID);
    // Count reflects ACTUAL successes (2), not the planned 3.
    expect(count).toBe(2);
    expect(console.warn).toHaveBeenCalled();
  });
});
