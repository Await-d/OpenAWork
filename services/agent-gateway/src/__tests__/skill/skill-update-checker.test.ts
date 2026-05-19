/**
 * Unit coverage for `skill-update-checker`.
 *
 * Pure helpers (no network) are tested via the `__testing` export.
 * The DB-backed `checkInstalledSkillUpdates()` path is covered by a
 * smoke test using a mocked global fetch — full end-to-end is left
 * for an integration test once the HTTP test harness lands.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '../../db.js';
import type * as UpdateCheckerModule from '../../skill/skill-update-checker.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let dbModule: typeof DbModule;
let updateChecker: typeof UpdateCheckerModule;

const USER_ID = 'u-skill-update-test';

function seedUser(): void {
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    'update-checker@test.local',
  ]);
}

function seedInstalled(opts: {
  skillId: string;
  sourceId: string;
  manifest: Record<string, unknown>;
  latestCheck?: { latestVersion: string | null; checkedAt: number; error: string | null };
}): void {
  const now = Date.now();
  dbModule.sqliteRun(
    `INSERT OR REPLACE INTO installed_skills
       (skill_id, user_id, source_id, manifest_json, granted_permissions_json,
        enabled, installed_at, updated_at, latest_version_check_json)
     VALUES (?, ?, ?, ?, '[]', 1, ?, ?, ?)`,
    [
      opts.skillId,
      USER_ID,
      opts.sourceId,
      JSON.stringify(opts.manifest),
      now,
      now,
      opts.latestCheck ? JSON.stringify(opts.latestCheck) : null,
    ],
  );
}

function readCheck(
  skillId: string,
): { latestVersion: string | null; checkedAt: number; error: string | null } | null {
  const row = dbModule.sqliteGet<{ latest_version_check_json: string | null }>(
    'SELECT latest_version_check_json FROM installed_skills WHERE skill_id = ? AND user_id = ?',
    [skillId, USER_ID],
  );
  if (!row?.latest_version_check_json) return null;
  return JSON.parse(row.latest_version_check_json);
}

beforeAll(async () => {
  dbModule = await import('../../db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  updateChecker = await import('../../skill/skill-update-checker.js');
  seedUser();
});

afterAll(async () => {
  await dbModule.closeDb();
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM installed_skills WHERE user_id = ?', [USER_ID]);
});

describe('skill-update-checker / pure helpers', () => {
  it('parses `version:` from SKILL.md frontmatter', () => {
    const text = '---\nname: foo\nversion: 1.2.3\ndescription: bar\n---\n\nBody';
    expect(updateChecker.__testing.parseVersionFromFrontmatter(text)).toBe('1.2.3');
  });

  it('strips wrapping quotes around the version value', () => {
    const text = '---\nname: foo\nversion: "2.0.0"\n---\nBody';
    expect(updateChecker.__testing.parseVersionFromFrontmatter(text)).toBe('2.0.0');
  });

  it('returns null when no frontmatter present', () => {
    expect(updateChecker.__testing.parseVersionFromFrontmatter('# heading\n\nbody')).toBeNull();
  });

  it('returns null when frontmatter has no version field', () => {
    const text = '---\nname: foo\ndescription: no version here\n---\nBody';
    expect(updateChecker.__testing.parseVersionFromFrontmatter(text)).toBeNull();
  });

  it('builds raw GitHub URL from manifest.references[0].url when present', () => {
    const url = updateChecker.__testing.buildRawUrl('github:owner/repo/skills/foo', {
      references: [
        {
          type: 'manifest',
          url: 'https://raw.githubusercontent.com/owner/repo/abc123/skills/foo/SKILL.md',
        },
      ],
    });
    expect(url).toBe('https://raw.githubusercontent.com/owner/repo/abc123/skills/foo/SKILL.md');
  });

  it('synthesizes raw URL from skill_id when manifest has no usable reference', () => {
    const url = updateChecker.__testing.buildRawUrl(
      'github:anthropics/skills/skills/canvas-design',
      {},
    );
    expect(url).toBe(
      'https://raw.githubusercontent.com/anthropics/skills/main/skills/canvas-design/SKILL.md',
    );
  });

  it('returns null for non-GitHub skill IDs', () => {
    expect(updateChecker.__testing.buildRawUrl('builtin/foo', {})).toBeNull();
    expect(updateChecker.__testing.buildRawUrl('local-system:/path', {})).toBeNull();
  });
});

describe('skill-update-checker / checkInstalledSkillUpdates', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('writes latest_version_check_json with the parsed remote version', async () => {
    seedInstalled({
      skillId: 'github:owner/repo/skills/foo',
      sourceId: 'github:owner/repo',
      manifest: { id: 'foo', name: 'foo', version: '1.0.0' },
    });

    globalThis.fetch = vi.fn(async () => {
      return new Response('---\nname: foo\nversion: 1.2.3\n---\nBody', { status: 200 });
    }) as unknown as typeof fetch;

    const summary = await updateChecker.checkInstalledSkillUpdates();
    expect(summary.scanned).toBe(1);
    expect(summary.fetched).toBe(1);
    expect(summary.updatesFound).toBe(1);
    expect(summary.errors).toBe(0);

    const stored = readCheck('github:owner/repo/skills/foo');
    expect(stored?.latestVersion).toBe('1.2.3');
    expect(stored?.error).toBeNull();
  });

  it('skips rows whose latest_version_check_json is younger than the TTL', async () => {
    const recent = Date.now() - 1000; // 1 second ago — well inside 12h TTL
    seedInstalled({
      skillId: 'github:owner/repo/skills/foo',
      sourceId: 'github:owner/repo',
      manifest: { id: 'foo', name: 'foo', version: '1.0.0' },
      latestCheck: { latestVersion: '1.1.0', checkedAt: recent, error: null },
    });

    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const summary = await updateChecker.checkInstalledSkillUpdates();
    expect(summary.skipped).toBe(1);
    expect(summary.fetched).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();

    // Stored value untouched.
    const stored = readCheck('github:owner/repo/skills/foo');
    expect(stored?.latestVersion).toBe('1.1.0');
  });

  it('records an error when fetch fails', async () => {
    seedInstalled({
      skillId: 'github:owner/repo/skills/foo',
      sourceId: 'github:owner/repo',
      manifest: { id: 'foo', name: 'foo', version: '1.0.0' },
    });

    globalThis.fetch = vi.fn(async () => {
      return new Response('not found', { status: 404 });
    }) as unknown as typeof fetch;

    const summary = await updateChecker.checkInstalledSkillUpdates();
    expect(summary.errors).toBe(1);
    expect(summary.updatesFound).toBe(0);

    const stored = readCheck('github:owner/repo/skills/foo');
    expect(stored?.latestVersion).toBeNull();
    expect(stored?.error).not.toBeNull();
  });

  it('ignores non-GitHub-sourced rows', async () => {
    seedInstalled({
      skillId: 'local-system:/home/foo/.claude/skills/bar',
      sourceId: 'local-system:/home/foo/.claude/skills',
      manifest: { id: 'bar', name: 'bar', version: '1.0.0' },
    });

    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const summary = await updateChecker.checkInstalledSkillUpdates();
    expect(summary.scanned).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
