/**
 * Regression (§0.105, boot-time per-user sync): syncSystemSkillsForAllUsers
 * iterates every user and syncs system skills via DELETE / INSERT / UPDATE
 * writes (and a per-user existing-rows SELECT). Without per-user isolation one
 * user's DB error starved sync for every subsequent user. This runs at boot AND
 * on the background scheduler. We mock db.js so the poison user's existing-rows
 * query throws and assert the sweep still processes the healthy user, keeps the
 * aggregate count honest, and does not reject.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as SystemSkillsModule from '../../skill/system-skills.js';

const POISON_USER_ID = 'u-poison';
const GOOD_USER_ID = 'u-good';

const processedUserIds: string[] = [];

vi.mock('../../infra/db.js', () => ({
  sqliteAll: (sql: string, params: unknown[] = []) => {
    if (/FROM\s+users/i.test(sql)) {
      return [{ id: POISON_USER_ID }, { id: GOOD_USER_ID }];
    }
    if (/FROM\s+installed_skills/i.test(sql)) {
      const userId = params[0];
      if (userId === POISON_USER_ID) {
        throw new Error('simulated installed_skills query failure');
      }
      if (typeof userId === 'string') {
        processedUserIds.push(userId);
      }
      return [];
    }
    return [];
  },
  sqliteRun: () => undefined,
}));

let systemSkills: typeof SystemSkillsModule;

beforeEach(async () => {
  processedUserIds.length = 0;
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  systemSkills = await import('../../skill/system-skills.js');
});

describe('syncSystemSkillsForAllUsers per-user resilience', () => {
  it('单个用户同步抛错时不中断，其余用户仍被处理且不抛出', async () => {
    const result = await systemSkills.syncSystemSkillsForAllUsers();

    // Both users counted, but the healthy user was actually processed while
    // the poison user's failure was isolated (not fatal).
    expect(result.users).toBe(2);
    expect(processedUserIds).toContain(GOOD_USER_ID);
    expect(processedUserIds).not.toContain(POISON_USER_ID);
    expect(console.warn).toHaveBeenCalled();
  });
});
