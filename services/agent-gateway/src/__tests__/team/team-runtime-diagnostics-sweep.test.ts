/**
 * Regression: the runtime-incident audit dedupe map
 * (`lastIncidentAuditAtBySignature`) keys on (user × category × code ×
 * entityId). entityId derives from sessionId / handoffId, so over a long-lived
 * process the distinct-key space is effectively unbounded — and an entry only
 * matters for the INCIDENT_AUDIT_DEDUPE_MS (60s) window after it is written, so
 * older entries are pure leak. The store now sweeps expired entries every N
 * writes. This test pins that the map stays bounded instead of growing forever.
 *
 * The audit write + telemetry sinks are hoisted-mocked so the test stays fully
 * in-memory: it must never touch the shared SQLite DB (doing so contaminates
 * sibling team test files that share the process-global connection).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../team/team-audit-store.js', () => ({
  logTeamAudit: vi.fn(),
}));
vi.mock('../../team/team-runtime-telemetry.js', () => ({
  trackTeamRuntimeIncident: vi.fn(),
}));

import {
  recordTeamRuntimeIncident,
  __resetTeamRuntimeDiagnosticsForTesting,
  __setIncidentAuditSweepIntervalForTesting,
  __incidentAuditSignatureCountForTesting,
  type TeamRuntimeIncident,
} from '../../team/team-runtime-diagnostics-store.js';

// Base the fake clock at a realistic epoch: the dedupe guard compares
// `now - lastAt < 60s`, and a default `lastAt` of 0 would wrongly suppress the
// very first write if `now` were also near 0.
const BASE = 1_700_000_000_000;

beforeEach(() => {
  __resetTeamRuntimeDiagnosticsForTesting();
  vi.useFakeTimers();
  vi.setSystemTime(BASE);
});

afterEach(() => {
  __resetTeamRuntimeDiagnosticsForTesting();
  __setIncidentAuditSweepIntervalForTesting(null);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function incident(entityId: string, at: number): TeamRuntimeIncident {
  return {
    category: 'handoff_failure',
    code: 'handoff:test',
    context: { handoffId: entityId },
    message: 'boom',
    severity: 'warning',
    timestamp: at,
    userId: 'u-sweep',
  };
}

describe('team-runtime diagnostics audit-signature sweep', () => {
  it('过期签名在写入达到 sweep interval 时被清除，map 不随唯一 entityId 无界增长', () => {
    __setIncidentAuditSweepIntervalForTesting(10);

    // 9 distinct-entity incidents at BASE → 9 fresh signatures.
    for (let i = 0; i < 9; i++) {
      recordTeamRuntimeIncident(incident(`h-${i}`, Date.now()));
    }
    expect(__incidentAuditSignatureCountForTesting()).toBe(9);

    // Advance past the 60s dedupe window so the BASE signatures are expired.
    vi.setSystemTime(BASE + 120_000);

    // The 10th write hits the sweep interval → expired entries pruned, leaving
    // only the just-written signature.
    recordTeamRuntimeIncident(incident('h-final', Date.now()));
    expect(__incidentAuditSignatureCountForTesting()).toBe(1);
  });

  it('窗口内未过期的签名不会被 sweep 误删', () => {
    __setIncidentAuditSweepIntervalForTesting(3);

    recordTeamRuntimeIncident(incident('a', Date.now()));
    recordTeamRuntimeIncident(incident('b', Date.now()));
    // Small advance, still inside the 60s window; third write triggers the sweep.
    vi.setSystemTime(BASE + 1_000);
    recordTeamRuntimeIncident(incident('c', Date.now()));

    expect(__incidentAuditSignatureCountForTesting()).toBe(3);
  });
});
