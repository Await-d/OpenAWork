/**
 * Unit coverage for `resolveEffectiveSkills`.
 *
 * Each test uses a fresh in-memory DB seeded through the real `migrate()`
 * pipeline so the resolver exercises the production schema (installed_skills
 * + chat_workspace_skill_selections + chat_session_skill_overrides) rather
 * than a hand-rolled fixture.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as SkillSelectionModule from '../../skill/skill-selection.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let dbModule: typeof DbModule;
let selection: typeof SkillSelectionModule;

const USER_ID = 'u-test';
const WORKSPACE_A = '/home/alice/projects/alpha';
const WORKSPACE_B = '/home/alice/projects/beta';
const SESSION_ID = 's-test';

const customSkillManifest = {
  apiVersion: 'agent-skill/v1',
  id: 'com.example.custom',
  name: 'custom-skill',
  displayName: 'Custom Skill',
  version: '1.0.0',
  description: 'A custom skill for testing',
  capabilities: ['custom.test'],
  permissions: [],
};

const anotherManifest = {
  ...customSkillManifest,
  id: 'com.example.another',
  name: 'another-skill',
  displayName: 'Another Skill',
};

const disabledManifest = {
  ...customSkillManifest,
  id: 'com.example.disabled',
  name: 'disabled-skill',
  displayName: 'Disabled Skill',
};

function seedUser(): void {
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    'u@example.com',
  ]);
}

function seedSession(): void {
  dbModule.sqliteRun("INSERT OR IGNORE INTO sessions (id, user_id, title) VALUES (?, ?, 'demo')", [
    SESSION_ID,
    USER_ID,
  ]);
}

function seedInstalled(manifest: typeof customSkillManifest, enabled: 1 | 0 = 1): void {
  const now = Date.now();
  dbModule.sqliteRun(
    `INSERT OR REPLACE INTO installed_skills
       (skill_id, user_id, source_id, manifest_json, granted_permissions_json, enabled, installed_at, updated_at)
     VALUES (?, ?, 'local', ?, '[]', ?, ?, ?)`,
    [manifest.id, USER_ID, JSON.stringify(manifest), enabled, now, now],
  );
}

function seedWorkspaceSelection(
  workspacePath: string,
  items: Array<{ skillId: string; enabled: 0 | 1; pinned?: 0 | 1; reason?: string }>,
): void {
  const now = Date.now();
  for (const item of items) {
    dbModule.sqliteRun(
      `INSERT OR REPLACE INTO chat_workspace_skill_selections
         (user_id, workspace_path, skill_id, enabled, pinned, reason, source, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'manual', ?)`,
      [
        USER_ID,
        workspacePath,
        item.skillId,
        item.enabled,
        item.pinned ?? 0,
        item.reason ?? null,
        now,
      ],
    );
  }
}

function seedSessionOverride(
  items: Array<{ skillId: string; enabled: 0 | 1; pinned?: 0 | 1 | null }>,
): void {
  const now = Date.now();
  for (const item of items) {
    dbModule.sqliteRun(
      `INSERT OR REPLACE INTO chat_session_skill_overrides
         (session_id, skill_id, enabled, pinned, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      [SESSION_ID, item.skillId, item.enabled, item.pinned === undefined ? 0 : item.pinned, now],
    );
  }
}

function markWorkspaceConfigured(workspacePath: string): void {
  dbModule.sqliteRun(
    `INSERT INTO chat_workspace_skill_configured (user_id, workspace_path, configured_at)
     VALUES (?, ?, ?)
     ON CONFLICT(user_id, workspace_path) DO UPDATE SET configured_at = excluded.configured_at`,
    [USER_ID, workspacePath, Date.now()],
  );
}

function resetTables(): void {
  dbModule.sqliteRun('DELETE FROM chat_session_skill_overrides');
  dbModule.sqliteRun('DELETE FROM chat_workspace_skill_selections');
  dbModule.sqliteRun('DELETE FROM chat_workspace_skill_configured');
  dbModule.sqliteRun('DELETE FROM installed_skills');
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  selection = await import('../../skill/skill-selection.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  seedUser();
  seedSession();
});

afterAll(async () => {
  await dbModule.closeDb();
});

beforeEach(() => {
  resetTables();
});

describe('normalizeWorkspacePathKey', () => {
  it('falls back to the sentinel for nullish/empty input', () => {
    expect(selection.normalizeWorkspacePathKey(null)).toBe(selection.DEFAULT_WORKSPACE_PATH_KEY);
    expect(selection.normalizeWorkspacePathKey(undefined)).toBe(
      selection.DEFAULT_WORKSPACE_PATH_KEY,
    );
    expect(selection.normalizeWorkspacePathKey('   ')).toBe(selection.DEFAULT_WORKSPACE_PATH_KEY);
  });

  it('strips trailing slashes and resolves to absolute form', () => {
    expect(selection.normalizeWorkspacePathKey('/tmp/foo/')).toBe('/tmp/foo');
    expect(selection.normalizeWorkspacePathKey('/tmp/foo///')).toBe('/tmp/foo');
  });
});

describe('resolveEffectiveSkills', () => {
  it('falls back to installed_skills.enabled when no selection rows exist', () => {
    seedInstalled(customSkillManifest);
    seedInstalled(anotherManifest);
    seedInstalled(disabledManifest, 0);

    const effective = selection.resolveEffectiveSkills({
      userId: USER_ID,
      workspacePath: WORKSPACE_A,
      sessionId: null,
    });

    const installedEntries = effective.filter((entry) => entry.origin === 'workspace-fallback');
    expect(installedEntries.map((e) => e.skillId).sort()).toEqual([
      'com.example.another',
      'com.example.custom',
    ]);
    // BUILTIN is always appended regardless of fallback.
    expect(effective.some((entry) => entry.origin === 'builtin')).toBe(true);
  });

  it('honours explicit workspace rows over fallback once configured', () => {
    seedInstalled(customSkillManifest);
    seedInstalled(anotherManifest);
    seedWorkspaceSelection(WORKSPACE_A, [
      { skillId: 'com.example.custom', enabled: 1, pinned: 1, reason: 'primary' },
    ]);

    const effective = selection.resolveEffectiveSkills({
      userId: USER_ID,
      workspacePath: WORKSPACE_A,
      sessionId: null,
    });

    const installedEntries = effective.filter((e) => e.origin === 'workspace');
    expect(installedEntries).toHaveLength(1);
    expect(installedEntries[0]).toMatchObject({
      skillId: 'com.example.custom',
      enabled: true,
      pinned: true,
      reason: 'primary',
    });
    // `another` was NOT in the workspace row so it is excluded entirely
    // (not fallback-injected) — this is the whole point of the filter.
    expect(effective.some((e) => e.skillId === 'com.example.another')).toBe(false);
  });

  it('drops rows whose installed_skills row is disabled at the user level', () => {
    seedInstalled(customSkillManifest);
    seedInstalled(disabledManifest, 0);
    seedWorkspaceSelection(WORKSPACE_A, [
      { skillId: 'com.example.custom', enabled: 1 },
      { skillId: 'com.example.disabled', enabled: 1 },
    ]);

    const effective = selection.resolveEffectiveSkills({
      userId: USER_ID,
      workspacePath: WORKSPACE_A,
      sessionId: null,
    });

    const ids = effective.filter((e) => e.origin === 'workspace').map((e) => e.skillId);
    expect(ids).toEqual(['com.example.custom']);
  });

  it('applies session overrides on top of workspace selections', () => {
    seedInstalled(customSkillManifest);
    seedInstalled(anotherManifest);
    seedWorkspaceSelection(WORKSPACE_A, [{ skillId: 'com.example.custom', enabled: 1, pinned: 1 }]);
    seedSessionOverride([
      { skillId: 'com.example.custom', enabled: 0, pinned: 0 },
      { skillId: 'com.example.another', enabled: 1 },
    ]);

    const effective = selection.resolveEffectiveSkills({
      userId: USER_ID,
      workspacePath: WORKSPACE_A,
      sessionId: SESSION_ID,
    });

    const byId = new Map(effective.map((e) => [e.skillId, e]));
    expect(byId.get('com.example.custom')).toMatchObject({
      origin: 'session-override',
      enabled: false,
      pinned: false,
    });
    expect(byId.get('com.example.another')).toMatchObject({
      origin: 'session-override',
      enabled: true,
    });
  });

  it('always appends BUILTIN entries and marks them as enabled/not-pinned', () => {
    const effective = selection.resolveEffectiveSkills({
      userId: USER_ID,
      workspacePath: null,
      sessionId: null,
    });
    const builtins = effective.filter((e) => e.origin === 'builtin');
    expect(builtins.length).toBeGreaterThan(0);
    expect(builtins.every((b) => b.enabled && !b.pinned)).toBe(true);
  });

  it('collapses null workspacePath to the __default__ sentinel', () => {
    seedInstalled(customSkillManifest);
    seedWorkspaceSelection(selection.DEFAULT_WORKSPACE_PATH_KEY, [
      { skillId: 'com.example.custom', enabled: 1 },
    ]);

    const effective = selection.resolveEffectiveSkills({
      userId: USER_ID,
      workspacePath: null,
      sessionId: null,
    });
    expect(
      effective.some((e) => e.skillId === 'com.example.custom' && e.origin === 'workspace'),
    ).toBe(true);
  });

  it('honors an explicitly empty workspace configuration as BUILTIN-only', () => {
    // Regression: previously an empty `chat_workspace_skill_selections` was
    // indistinguishable from "never configured", causing the resolver to
    // fall back to installed_skills.enabled and re-enable every installed
    // skill. The `chat_workspace_skill_configured` marker breaks the tie.
    seedInstalled(customSkillManifest);
    seedInstalled(anotherManifest);
    markWorkspaceConfigured(WORKSPACE_A);

    const effective = selection.resolveEffectiveSkills({
      userId: USER_ID,
      workspacePath: WORKSPACE_A,
      sessionId: null,
    });

    expect(effective.some((entry) => entry.origin === 'workspace')).toBe(false);
    expect(effective.some((entry) => entry.origin === 'workspace-fallback')).toBe(false);
    // BUILTIN entries must still be appended.
    expect(effective.every((entry) => entry.origin === 'builtin')).toBe(true);
    expect(effective.length).toBeGreaterThan(0);
  });

  it('does not consult __default__ once the path-specific tuple is explicitly configured', () => {
    seedInstalled(customSkillManifest);
    // Global default has a pinned row, but the path-specific tuple was
    // saved as an explicitly empty set. The path-specific marker wins.
    seedWorkspaceSelection(selection.DEFAULT_WORKSPACE_PATH_KEY, [
      { skillId: 'com.example.custom', enabled: 1, pinned: 1 },
    ]);
    markWorkspaceConfigured(selection.DEFAULT_WORKSPACE_PATH_KEY);
    markWorkspaceConfigured(WORKSPACE_A);

    const effective = selection.resolveEffectiveSkills({
      userId: USER_ID,
      workspacePath: WORKSPACE_A,
      sessionId: null,
    });
    expect(effective.some((entry) => entry.skillId === 'com.example.custom')).toBe(false);
  });

  it('isolates workspace paths so WORKSPACE_B selections do not bleed into WORKSPACE_A', () => {
    seedInstalled(customSkillManifest);
    seedWorkspaceSelection(WORKSPACE_B, [{ skillId: 'com.example.custom', enabled: 1, pinned: 1 }]);

    // WORKSPACE_A has no rows → fallback to installed_skills.enabled, not to
    // WORKSPACE_B's explicit row (that would be cross-contamination).
    const effective = selection.resolveEffectiveSkills({
      userId: USER_ID,
      workspacePath: WORKSPACE_A,
      sessionId: null,
    });
    const match = effective.find((e) => e.skillId === 'com.example.custom');
    expect(match?.origin).toBe('workspace-fallback');
    expect(match?.pinned).toBe(false);
  });
});

describe('resolveEffectiveSkills · requestedSkillIds (模板初始绑定)', () => {
  it('force-enables an installed skill via requestedSkillIds even without workspace selection', () => {
    seedInstalled(customSkillManifest);
    seedWorkspaceSelection(WORKSPACE_A, [
      // 显式配置了 workspace，但没把 custom 选进来。
      { skillId: 'com.example.another', enabled: 1 },
    ]);
    seedInstalled(anotherManifest);

    const effective = selection.resolveEffectiveSkills({
      userId: USER_ID,
      workspacePath: WORKSPACE_A,
      sessionId: SESSION_ID,
      requestedSkillIds: ['com.example.custom'],
    });

    const custom = effective.find((e) => e.skillId === 'com.example.custom');
    expect(custom).toBeDefined();
    expect(custom?.enabled).toBe(true);
    expect(custom?.origin).toBe('session-override');
  });

  it('ignores requestedSkillIds for a skill that is not installed / disabled', () => {
    seedInstalled(disabledManifest, 0);

    const effective = selection.resolveEffectiveSkills({
      userId: USER_ID,
      workspacePath: WORKSPACE_A,
      sessionId: SESSION_ID,
      requestedSkillIds: ['com.example.disabled', 'com.example.ghost'],
    });

    expect(effective.some((e) => e.skillId === 'com.example.disabled')).toBe(false);
    expect(effective.some((e) => e.skillId === 'com.example.ghost')).toBe(false);
  });

  it('does not duplicate a skill already enabled by workspace selection', () => {
    seedInstalled(customSkillManifest);
    seedWorkspaceSelection(WORKSPACE_A, [
      { skillId: 'com.example.custom', enabled: 1, pinned: 1, reason: 'primary' },
    ]);

    const effective = selection.resolveEffectiveSkills({
      userId: USER_ID,
      workspacePath: WORKSPACE_A,
      sessionId: SESSION_ID,
      requestedSkillIds: ['com.example.custom'],
    });

    const matches = effective.filter((e) => e.skillId === 'com.example.custom');
    expect(matches).toHaveLength(1);
    // 保留 workspace 选择的 pinned 状态，不被覆盖。
    expect(matches[0]?.pinned).toBe(true);
  });
});
