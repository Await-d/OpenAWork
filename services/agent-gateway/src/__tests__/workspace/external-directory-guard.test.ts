/**
 * Regression: sessionExternalDirs (in external-directory-guard) keys on
 * sessionId and never evicted on its own — clearExternalAccessTracking had
 * zero callers before, so a deleted session leaked its Set for the process
 * lifetime. The session-delete path now calls clearExternalAccessTracking;
 * this test pins that clearing resets the per-session first-access tracking
 * (the observable proof the map entry was actually dropped).
 */

import { describe, expect, it } from 'vitest';
import {
  recordExternalAccess,
  clearExternalAccessTracking,
} from '../../workspace/external-directory-guard.js';

describe('external-directory-guard session tracking cleanup', () => {
  it('clearExternalAccessTracking 丢弃该 session 的累计目录集合，first-access 检测随之重置', () => {
    const sessionId = 's-extdir-cleanup';
    const file = '/tmp/some-external-dir/file.txt';

    // First access for this dir in the session → true.
    expect(recordExternalAccess(sessionId, file)).toBe(true);
    // Same dir again → false (already recorded in the session's Set).
    expect(recordExternalAccess(sessionId, file)).toBe(false);

    // Simulate session delete: drop the in-memory tracking.
    clearExternalAccessTracking(sessionId);

    // The Set is gone, so the same dir is treated as first-access again —
    // proving the map entry was actually evicted rather than lingering.
    expect(recordExternalAccess(sessionId, file)).toBe(true);
  });

  it('clear 只影响目标 session，其它 session 的累计集合不受影响', () => {
    const a = 's-extdir-a';
    const b = 's-extdir-b';
    const file = '/tmp/shared-external/file.txt';

    expect(recordExternalAccess(a, file)).toBe(true);
    expect(recordExternalAccess(b, file)).toBe(true);

    clearExternalAccessTracking(a);

    // a was cleared → first-access again; b untouched → still recorded.
    expect(recordExternalAccess(a, file)).toBe(true);
    expect(recordExternalAccess(b, file)).toBe(false);
  });
});
