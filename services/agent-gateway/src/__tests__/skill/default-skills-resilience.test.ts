/**
 * Regression (§0.105, boot-time per-user seeding): ensureDefaultInstalledSkillsForAllUsers
 * iterates every user and seeds default installed skills via unguarded sqliteRun
 * writes. Without per-user isolation one user's write throwing skipped seeding
 * for every subsequent user — and because this runs at gateway boot, an
 * unguarded throw aborted startup. We mock db.js so the poison user's writes
 * throw and assert the helper still seeds the healthy user and does not reject.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DefaultSkillsModule from '../../skill/default-skills.js';

const POISON_USER_ID = 'u-poison';
const GOOD_USER_ID = 'u-good';

const seededUserIds: string[] = [];

vi.mock('../../infra/db.js', () => ({
  // user-list query → poison first so we prove the loop continues past it.
  sqliteAll: (sql: string) => {
    if (/FROM\s+users/i.test(sql)) {
      return [{ id: POISON_USER_ID }, { id: GOOD_USER_ID }];
    }
    return [];
  },
  // installed_skills INSERT params: [skillId, userId, ...]; throw for poison.
  sqliteRun: (_sql: string, params: unknown[] = []) => {
    const userId = params[1];
    if (userId === POISON_USER_ID) {
      throw new Error('simulated default-skill seed failure');
    }
    if (typeof userId === 'string') {
      seededUserIds.push(userId);
    }
  },
}));

let defaultSkills: typeof DefaultSkillsModule;

beforeEach(async () => {
  seededUserIds.length = 0;
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  defaultSkills = await import('../../skill/default-skills.js');
});

describe('ensureDefaultInstalledSkillsForAllUsers per-user resilience', () => {
  it('单个用户播种写入抛错时不中断，其余用户仍被播种且不抛出', () => {
    // Must not throw despite the poison user's writes failing.
    expect(() => defaultSkills.ensureDefaultInstalledSkillsForAllUsers()).not.toThrow();
    // The healthy user was still seeded — the loop continued past the poison user.
    expect(seededUserIds).toContain(GOOD_USER_ID);
    expect(seededUserIds).not.toContain(POISON_USER_ID);
    expect(console.warn).toHaveBeenCalled();
  });
});
