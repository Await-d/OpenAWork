/**
 * Regression (§0.119, capabilities installed-skill manifest per-row tolerance):
 * listCapabilitiesForUser reads enabled installed_skills via json_group_array
 * and parsed each manifest_json. The inner per-manifest JSON.parse lived inside
 * the outer try, so one corrupt manifest row (crash mid-write, disk error,
 * hand-edited DB) made the outer catch drop the user's ENTIRE installed-skill
 * capability view (shown to the model via buildCapabilityContext + the
 * /capabilities route), not just the bad skill. The inner parse now skips the
 * bad row individually. We seed one healthy + one corrupt enabled installed
 * skill and assert the healthy one still surfaces.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as CapabilitiesModule from '../../routes/capabilities.js';
import type { CapabilityDescriptor } from '@openAwork/shared';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let dbModule: typeof DbModule;
let capabilities: typeof CapabilitiesModule;

const USER_ID = 'u-capabilities';
const HEALTHY_SKILL_ID = 'com.example.healthy-cap';
const POISON_SKILL_ID = 'com.example.poison-cap';

function seedInstalledSkill(skillId: string, manifestJson: string): void {
  const now = Date.now();
  dbModule.sqliteRun(
    `INSERT INTO installed_skills
       (skill_id, user_id, source_id, manifest_json, granted_permissions_json, enabled, installed_at, updated_at)
     VALUES (?, ?, 'src', ?, '[]', 1, ?, ?)`,
    [skillId, USER_ID, manifestJson, now, now],
  );
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.migrate();
  capabilities = await import('../../routes/capabilities.js');
});

afterAll(async () => {
  await dbModule.closeDb();
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM installed_skills', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    `${USER_ID}@example.com`,
  ]);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('listCapabilitiesForUser installed-manifest resilience', () => {
  it('包含 resource agents 和 reference-only resource commands，但参考命令不可直接调用', () => {
    const caps = capabilities.listCapabilitiesForUser(USER_ID);

    expect(caps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'resource-code-reviewer',
          kind: 'agent',
          source: 'builtin',
          callable: false,
        }),
        expect.objectContaining({
          id: 'resource-command-commit',
          kind: 'command',
          source: 'reference',
          callable: false,
          tags: ['reference-resource', 'commit'],
        }),
      ]),
    );
    expect(
      caps.some(
        (capability) =>
          capability.id === 'resource-command-commit' &&
          capability.kind === 'command' &&
          capability.callable === true,
      ),
    ).toBe(false);
  });

  it('单行 manifest_json 损坏时不丢掉整份已安装技能能力，健康技能仍出现', () => {
    seedInstalledSkill(
      HEALTHY_SKILL_ID,
      JSON.stringify({
        id: HEALTHY_SKILL_ID,
        name: 'healthy-cap',
        displayName: 'Healthy Cap',
        description: 'a healthy installed skill',
        capabilities: ['cap.test'],
      }),
    );
    seedInstalledSkill(POISON_SKILL_ID, '{not valid json');

    let caps: CapabilityDescriptor[] | undefined;
    expect(() => {
      caps = capabilities.listCapabilitiesForUser(USER_ID);
    }).not.toThrow();

    const installedSkillIds = (caps ?? [])
      .filter((c) => c.kind === 'skill' && c.source === 'installed')
      .map((c) => c.id);
    // The healthy installed skill survived despite the poison row.
    expect(installedSkillIds).toContain(HEALTHY_SKILL_ID);
    // The corrupt manifest produced no descriptor.
    expect(installedSkillIds).not.toContain(POISON_SKILL_ID);
    expect(console.warn).toHaveBeenCalled();
  });
});
