import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DefaultWorkflowTemplatesModule from '../../runtime/default-workflow-templates.js';

/**
 * Regression (§0.102, boot-time seeding): ensureDefaultWorkflowTemplatesForAllUsers
 * iterates every user and seeds default workflow templates. Without per-user
 * isolation one user's write throwing skipped seeding for every subsequent
 * user — and because this runs at gateway boot, an unguarded throw aborted
 * startup. We mock db.js so the poison user's sqliteRun throws and assert the
 * helper still seeds the healthy user (loop survives) and does not reject.
 */

const POISON_USER_ID = 'u-poison';
const GOOD_USER_ID = 'u-good';

const seededUserIds: string[] = [];

vi.mock('../../infra/db.js', () => ({
  // user-list query → two users (poison first so we prove the loop continues);
  // existing-templates query → none (forces the INSERT path).
  sqliteAll: (sql: string) => {
    if (/FROM\s+users/i.test(sql)) {
      return [{ id: POISON_USER_ID }, { id: GOOD_USER_ID }];
    }
    return [];
  },
  // INSERT params are [id, userId, ...]; throw for the poison user only.
  sqliteRun: (_sql: string, params: unknown[] = []) => {
    const userId = params[1];
    if (userId === POISON_USER_ID) {
      throw new Error('simulated seed write failure');
    }
    if (typeof userId === 'string') {
      seededUserIds.push(userId);
    }
  },
}));

let ensureDefaultWorkflowTemplatesForAllUsers: typeof DefaultWorkflowTemplatesModule.ensureDefaultWorkflowTemplatesForAllUsers;

beforeEach(async () => {
  seededUserIds.length = 0;
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  ensureDefaultWorkflowTemplatesForAllUsers = (
    await import('../../runtime/default-workflow-templates.js')
  ).ensureDefaultWorkflowTemplatesForAllUsers;
});

describe('ensureDefaultWorkflowTemplatesForAllUsers per-user resilience', () => {
  it('单个用户播种写入抛错时不中断，其余用户仍被播种且不抛出', () => {
    // Must not throw despite the poison user's write failing.
    expect(() => ensureDefaultWorkflowTemplatesForAllUsers()).not.toThrow();
    // The healthy user was still seeded — the loop continued past the poison user.
    expect(seededUserIds).toContain(GOOD_USER_ID);
    expect(seededUserIds).not.toContain(POISON_USER_ID);
    expect(console.warn).toHaveBeenCalled();
  });
});
