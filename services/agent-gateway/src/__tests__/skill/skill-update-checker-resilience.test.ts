/**
 * Regression (§0.103, background network sweep): checkInstalledSkillUpdates
 * runs each installed-skill version probe through pMapConcurrent, whose runner
 * is `results[i] = await worker(...)` with NO per-item guard. The worker ends
 * with an unguarded `sqliteRun(UPDATE ...)`; if that write throws (DB lock /
 * disk error / constraint) for one row, the whole `Promise.all(runners)` used
 * to reject and abort the entire sweep — starving every remaining skill. The
 * worker now isolates per row + counts the failure. We mock db.js so the poison
 * skill's UPDATE throws and assert the healthy skill is still written and the
 * sweep still resolves.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as UpdateCheckerModule from '../../skill/skill-update-checker.js';

const POISON_SKILL_ID = 'github:owner/repo/skills/poison';
const HEALTHY_SKILL_ID = 'github:owner/repo/skills/healthy';

const updatedSkillIds: string[] = [];

vi.mock('../../infra/db.js', () => ({
  // Two GitHub candidates, neither with a prior check (so neither is skipped).
  sqliteAll: () => [
    {
      skill_id: POISON_SKILL_ID,
      user_id: 'u-1',
      source_id: 'github:owner/repo',
      manifest_json: JSON.stringify({ id: 'poison', name: 'poison', version: '1.0.0' }),
      latest_version_check_json: null,
    },
    {
      skill_id: HEALTHY_SKILL_ID,
      user_id: 'u-1',
      source_id: 'github:owner/repo',
      manifest_json: JSON.stringify({ id: 'healthy', name: 'healthy', version: '1.0.0' }),
      latest_version_check_json: null,
    },
  ],
  // The poison row's UPDATE throws; the healthy row's write is recorded.
  sqliteRun: (_sql: string, params: unknown[] = []) => {
    const skillId = params[1];
    if (skillId === POISON_SKILL_ID) {
      throw new Error('simulated DB write failure');
    }
    if (typeof skillId === 'string') {
      updatedSkillIds.push(skillId);
    }
  },
}));

let updateChecker: typeof UpdateCheckerModule;

beforeEach(async () => {
  updatedSkillIds.length = 0;
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  // Both probes return a parseable remote version so each worker reaches the
  // sqliteRun write (where the poison row throws).
  globalThis.fetch = vi.fn(async () => {
    return new Response('---\nname: x\nversion: 2.0.0\n---\nBody', { status: 200 });
  }) as unknown as typeof fetch;
  updateChecker = await import('../../skill/skill-update-checker.js');
});

describe('checkInstalledSkillUpdates per-row resilience', () => {
  it('单个技能写入抛错时不中断整轮，其余技能仍被刷新且计入 errors', async () => {
    const summary = await updateChecker.checkInstalledSkillUpdates();

    // Both candidates were scanned + fetched; the poison write threw but was
    // isolated (counted as an error) and the healthy skill was still written.
    expect(summary.scanned).toBe(2);
    expect(summary.fetched).toBe(2);
    expect(summary.errors).toBe(1);
    expect(updatedSkillIds).toContain(HEALTHY_SKILL_ID);
    expect(updatedSkillIds).not.toContain(POISON_SKILL_ID);
  });
});
