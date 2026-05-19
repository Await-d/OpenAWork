/**
 * Unit coverage for `syncSystemSkillsForUser`.
 *
 * Each test creates a temp dir layout mirroring `~/.claude/skills` or
 * `~/.config/openAwork/skills`, points `CRUSH_SKILLS_DIR` at it, then
 * runs the sync against an in-memory SQLite. The contract under test:
 *
 *   1. SKILL.md files become rows in `installed_skills` with
 *      `source_id LIKE 'local-system:%'` and `enabled = 1`.
 *   2. Re-running the sync after editing a SKILL.md updates the
 *      manifest but does NOT flip a user-disabled row back to enabled.
 *   3. Deleting a SKILL.md directory removes the row on next sync.
 *   4. Non-SKILL files and ignored directories (`node_modules`, `.git`)
 *      are skipped.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as DbModule from '../../db.js';
import type * as SystemSkillsModule from '../../skill/system-skills.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let dbModule: typeof DbModule;
let systemSkills: typeof SystemSkillsModule;

const USER_ID = 'u-system-skill-test';

function syncOnly(
  userId: string,
  paths: ReadonlyArray<string>,
): ReturnType<typeof systemSkills.syncSystemSkillsForUser> {
  return systemSkills.syncSystemSkillsForUser(userId, { pathsOverride: paths });
}

interface InstalledSkillRow {
  skill_id: string;
  source_id: string;
  manifest_json: string;
  enabled: number;
}

function listLocalSystemRows(): InstalledSkillRow[] {
  return dbModule.sqliteAll<InstalledSkillRow>(
    `SELECT skill_id, source_id, manifest_json, enabled
       FROM installed_skills
      WHERE user_id = ? AND source_id LIKE ?
      ORDER BY skill_id ASC`,
    [USER_ID, 'local-system:%'],
  );
}

function seedUser(): void {
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    'system-skill@test.local',
  ]);
}

function resetInstalled(): void {
  dbModule.sqliteRun('DELETE FROM installed_skills WHERE user_id = ?', [USER_ID]);
}

async function writeSkillMd(
  rootDir: string,
  skillName: string,
  body: string,
  frontmatter: Record<string, string> = {},
): Promise<string> {
  const dirPath = join(rootDir, skillName);
  await mkdir(dirPath, { recursive: true });
  const fmLines = Object.entries({ name: skillName, ...frontmatter }).map(
    ([key, value]) => `${key}: ${value}`,
  );
  const text = `---\n${fmLines.join('\n')}\n---\n\n${body}`;
  const manifestPath = join(dirPath, 'SKILL.md');
  await writeFile(manifestPath, text, 'utf8');
  return dirPath;
}

let tempRoot: string;

beforeAll(async () => {
  dbModule = await import('../../db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  systemSkills = await import('../../skill/system-skills.js');
  seedUser();
});

afterAll(async () => {
  await dbModule.closeDb();
});

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'openAwork-system-skills-'));
  resetInstalled();
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe('syncSystemSkillsForUser', () => {
  it('imports SKILL.md files into installed_skills with enabled=1', async () => {
    await writeSkillMd(tempRoot, 'hello-world', 'Lorem ipsum body content.', {
      description: 'Say hello',
    });
    await writeSkillMd(tempRoot, 'goodbye', 'Body for goodbye skill.', {
      description: 'Say goodbye',
    });

    const result = await syncOnly(USER_ID, [tempRoot]);

    expect(result.added).toBe(2);
    expect(result.removed).toBe(0);
    expect(result.total).toBe(2);

    const rows = listLocalSystemRows();
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.enabled).toBe(1);
      expect(row.source_id.startsWith('local-system:')).toBe(true);
      const manifest = JSON.parse(row.manifest_json) as { descriptionForModel?: string };
      expect(manifest.descriptionForModel?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it('does NOT re-enable a user-disabled row when re-syncing', async () => {
    const dirPath = await writeSkillMd(tempRoot, 'sticky-disabled', 'Body content.');
    await syncOnly(USER_ID, [tempRoot]);

    // User explicitly disables the skill.
    dbModule.sqliteRun(
      `UPDATE installed_skills SET enabled = 0 WHERE user_id = ? AND skill_id = ?`,
      [USER_ID, `local-system:${dirPath}`],
    );

    // Edit the SKILL.md so manifest content changes.
    await writeFile(
      join(dirPath, 'SKILL.md'),
      '---\nname: sticky-disabled\ndescription: edited\n---\n\nEdited body.',
      'utf8',
    );

    const result = await syncOnly(USER_ID, [tempRoot]);
    expect(result.added).toBe(0);
    expect(result.updated).toBe(1);
    expect(result.removed).toBe(0);

    const rows = listLocalSystemRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.enabled).toBe(0);
    const manifest = JSON.parse(rows[0]!.manifest_json) as { description: string };
    expect(manifest.description).toBe('edited');
  });

  it('removes rows whose SKILL.md directory disappeared from disk', async () => {
    const dirPath = await writeSkillMd(tempRoot, 'gone-tomorrow', 'Body.');
    await syncOnly(USER_ID, [tempRoot]);
    expect(listLocalSystemRows()).toHaveLength(1);

    await rm(dirPath, { recursive: true, force: true });
    const result = await syncOnly(USER_ID, [tempRoot]);

    expect(result.removed).toBe(1);
    expect(result.total).toBe(0);
    expect(listLocalSystemRows()).toHaveLength(0);
  });

  it('coalesces concurrent calls for the same user (in-flight dedup)', async () => {
    // Two calls without overrides must share a single in-flight entry
    // and resolve to byte-identical results. We sample the map BEFORE
    // awaiting so we catch the dedup window — by the time awaits
    // finish the entry has been deleted.
    const a = systemSkills.syncSystemSkillsForUser(USER_ID);
    const b = systemSkills.syncSystemSkillsForUser(USER_ID);
    expect(systemSkills.__getInflightUserSyncSize()).toBe(1);

    const [first, second] = await Promise.all([a, b]);
    expect(first).toEqual(second);

    // Cleanup hook is fired via Promise.finally → it runs as a
    // microtask after the awaited resolutions, so the map is empty
    // again before the next test starts.
    await Promise.resolve();
    expect(systemSkills.__getInflightUserSyncSize()).toBe(0);
  });

  it('skips ignored directories (node_modules, .git) and dot-children', async () => {
    await writeSkillMd(tempRoot, 'good-skill', 'Real body.');
    // Put a fake SKILL.md inside an ignored directory.
    const noiseDir = join(tempRoot, 'node_modules', 'fake-pkg');
    await mkdir(noiseDir, { recursive: true });
    await writeFile(join(noiseDir, 'SKILL.md'), '---\nname: should-not-show\n---\nbody', 'utf8');
    const dotDir = join(tempRoot, '.claude-plugin');
    await mkdir(dotDir, { recursive: true });
    await writeFile(join(dotDir, 'SKILL.md'), '---\nname: also-should-not-show\n---\nbody', 'utf8');

    const result = await syncOnly(USER_ID, [tempRoot]);
    expect(result.total).toBe(1);
    const rows = listLocalSystemRows();
    expect(rows.map((r) => JSON.parse(r.manifest_json).name)).toEqual(['good-skill']);
  });
});
