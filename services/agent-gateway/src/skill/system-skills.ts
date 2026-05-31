/**
 * System-installed skills (SKILL.md from OS default locations).
 *
 * Boots scan-on-startup: discovers SKILL.md files inside well-known
 * system directories (`~/.claude/skills`, `~/.config/openAwork/skills`,
 * `~/.agents/skills`, the `CRUSH_SKILLS_DIR` override, …) and mirrors
 * them into the per-user `installed_skills` table so they appear in
 * "管理已安装" and can be enabled/disabled by the user.
 *
 * Reconciliation invariants:
 *   1. **Add** any SKILL.md not yet present (INSERT … ON CONFLICT DO
 *      UPDATE only updates manifest_json/source_id/updated_at — never
 *      `enabled`, so user-disabled rows survive restart).
 *   2. **Remove** rows whose underlying directory was deleted from disk.
 *   3. Rows with `source_id LIKE 'local-system:%'` are the namespace
 *      managed here; anything else is left alone.
 *   4. The SKILL.md *body* (everything after the YAML frontmatter) is
 *      copied into `manifest.descriptionForModel` so the same content
 *      Claude Code injects into its system prompt is also available to
 *      the OpenAWork agent runtime via `pinned-skills-prompt.ts`.
 */

import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { createPlatformAdapter, resolveSkillsPaths } from '@openAwork/platform-adapter';
import type { SkillManifest } from '@openAwork/skill-types';
import { sqliteAll, sqliteRun } from '../infra/db.js';

export const SYSTEM_SOURCE_ID_PREFIX = 'local-system:';

const SKILL_MARKDOWN_NAMES = new Set(['SKILL.md', 'skill.md']);
const MAX_SCAN_DEPTH = 4;
const MAX_DISCOVERED_PER_ROOT = 500;
const IGNORED_DIRECTORY_NAMES = new Set([
  '.cache',
  '.git',
  '.next',
  '.turbo',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
]);

interface DiscoveredSystemSkill {
  skillId: string;
  sourceId: string;
  manifest: SkillManifest;
  dirPath: string;
  manifestPath: string;
}

interface InstalledSkillIdRow {
  skill_id: string;
}

interface UserRow {
  id: string;
}

interface SystemSkillFrontmatter {
  name?: string;
  description?: string;
  license?: string;
  author?: string;
  version?: string;
}

function parseSystemSkillFrontmatter(text: string): {
  frontmatter: SystemSkillFrontmatter;
  body: string;
} {
  const fmMatch = text.match(/^---\n([\s\S]*?)\n---\n?/);
  const fmRaw = fmMatch?.[1] ?? '';
  const body = fmMatch ? text.slice(fmMatch[0].length).trim() : text.trim();
  const frontmatter: SystemSkillFrontmatter = {};

  for (const rawLine of fmRaw.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const valueRaw = line
      .slice(colonIdx + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
    if (!valueRaw) continue;
    if (key === 'name') frontmatter.name = valueRaw;
    else if (key === 'description') frontmatter.description = valueRaw;
    else if (key === 'license') frontmatter.license = valueRaw;
    else if (key === 'author') frontmatter.author = valueRaw;
    else if (key === 'version') frontmatter.version = valueRaw;
  }

  if (!frontmatter.description) {
    const summary = body
      .split('\n\n')
      .map((chunk) => chunk.replace(/^#+\s*/gm, '').trim())
      .find((chunk) => chunk.length > 0);
    if (summary) {
      frontmatter.description = summary.slice(0, 240);
    }
  }

  return { frontmatter, body };
}

function buildSkillIdForDir(dirPath: string): string {
  return `${SYSTEM_SOURCE_ID_PREFIX}${dirPath}`;
}

function buildSkillName(dirPath: string, frontmatterName: string | undefined): string {
  const fromFm = frontmatterName?.trim();
  if (fromFm) return fromFm;
  return basename(dirPath) || 'system-skill';
}

function buildManifest(dirPath: string, manifestPath: string, text: string): SkillManifest | null {
  const { frontmatter, body } = parseSystemSkillFrontmatter(text);
  const name = buildSkillName(dirPath, frontmatter.name);
  if (!name) return null;

  return {
    apiVersion: 'agent-skill/v1',
    id: buildSkillIdForDir(dirPath),
    name,
    displayName: name,
    version: frontmatter.version?.trim() || '1.0.0',
    description: frontmatter.description?.trim() || `System skill at ${dirPath}`,
    descriptionForModel: body || undefined,
    author: frontmatter.author?.trim() || undefined,
    license: frontmatter.license?.trim() || undefined,
    capabilities: ['system-installed'],
    permissions: [],
    references: [{ path: manifestPath, loadAt: 'activation' }],
  };
}

async function scanSystemSkillsDir(rootDir: string): Promise<DiscoveredSystemSkill[]> {
  const discovered: DiscoveredSystemSkill[] = [];
  const queue: Array<{ dirPath: string; depth: number }> = [{ dirPath: rootDir, depth: 0 }];

  while (queue.length > 0 && discovered.length < MAX_DISCOVERED_PER_ROOT) {
    const current = queue.shift();
    if (!current) continue;

    const entries = await readdir(current.dirPath, { withFileTypes: true }).catch(() => []);
    const manifestEntry = entries.find(
      (entry) => entry.isFile() && SKILL_MARKDOWN_NAMES.has(entry.name),
    );

    if (manifestEntry) {
      const manifestPath = join(current.dirPath, manifestEntry.name);
      const text = await readFile(manifestPath, 'utf8').catch(() => null);
      if (text) {
        const manifest = buildManifest(current.dirPath, manifestPath, text);
        if (manifest) {
          discovered.push({
            skillId: manifest.id,
            sourceId: `${SYSTEM_SOURCE_ID_PREFIX}${rootDir}`,
            manifest,
            dirPath: current.dirPath,
            manifestPath,
          });
        }
      }
      // Once we found a SKILL.md, treat this directory as a skill leaf:
      // don't descend further (avoids duplicate nested SKILL.md hits).
      continue;
    }

    if (current.depth >= MAX_SCAN_DEPTH) continue;
    for (const entry of entries) {
      if (
        !entry.isDirectory() ||
        entry.isSymbolicLink() ||
        IGNORED_DIRECTORY_NAMES.has(entry.name) ||
        entry.name.startsWith('.')
      ) {
        // Note: dot-directories are skipped because GitHub-style hidden
        // dirs (`.claude-plugin`, `.codex-plugin`) shouldn't be treated
        // as skill roots. The well-known *parent* dirs themselves
        // (e.g. `~/.claude/skills`) come in as `rootDir` and are not
        // affected by this filter — only their *children* are.
        continue;
      }
      queue.push({
        dirPath: join(current.dirPath, entry.name),
        depth: current.depth + 1,
      });
    }
  }

  return discovered;
}

async function resolveExistingDir(path: string): Promise<string | null> {
  const realPath = await realpath(path).catch(() => null);
  if (!realPath) return null;
  const stat = await lstat(realPath).catch(() => null);
  return stat?.isDirectory() ? realPath : null;
}

/**
 * Scan all well-known system skill directories and return every
 * SKILL.md found, deduplicated by absolute skill directory path.
 *
 * Order of scanning roots: CRUSH_SKILLS_DIR/OPENWORK_SKILLS_DIR env
 * override → OS-specific config dirs (~/.config/openAwork/skills,
 * ~/.config/crush/skills, ~/.claude/skills, ~/.agents/skills, …).
 *
 * The `pathsOverride` argument fully replaces the platform-default
 * path list. It exists so unit tests can scope discovery to a temp
 * dir without picking up the developer's real `~/.claude/skills`.
 */
export async function discoverSystemSkills(
  pathsOverride?: ReadonlyArray<string>,
): Promise<DiscoveredSystemSkill[]> {
  const skillsPaths: ReadonlyArray<string> =
    pathsOverride && pathsOverride.length > 0
      ? pathsOverride
      : resolveSkillsPaths(createPlatformAdapter().getPlatform()).skillsPaths;

  const seenRoot = new Set<string>();
  const byId = new Map<string, DiscoveredSystemSkill>();

  for (const rawPath of skillsPaths) {
    const root = await resolveExistingDir(rawPath);
    if (!root || seenRoot.has(root)) continue;
    seenRoot.add(root);

    const skills = await scanSystemSkillsDir(root).catch(() => [] as DiscoveredSystemSkill[]);
    for (const skill of skills) {
      if (!byId.has(skill.skillId)) {
        byId.set(skill.skillId, skill);
      }
    }
  }

  return Array.from(byId.values()).sort((left, right) => left.dirPath.localeCompare(right.dirPath));
}

export interface SystemSkillSyncResult {
  added: number;
  updated: number;
  removed: number;
  total: number;
}

/**
 * Reconcile system-discovered skills for a single user. Idempotent:
 *   - INSERT new rows with `enabled = 1`
 *   - UPDATE manifest_json/source_id/updated_at for rows that already
 *     exist (so a freshly-edited SKILL.md is reflected) but never
 *     touch `enabled` so the user's manual on/off survives restart
 *   - DELETE rows whose underlying directory disappeared from disk
 *
 * The `discoveredOverride` argument lets the caller pre-compute the
 * scan result once and reuse it across users (used by the for-all-
 * users variant below).
 */
const inflightUserSyncs = new Map<string, Promise<SystemSkillSyncResult>>();

/**
 * Test-only hook: returns the current in-flight sync count.
 * Production callers should never need this — it exists so the unit
 * test can assert "two concurrent syncs collapse into one entry".
 */
export function __getInflightUserSyncSize(): number {
  return inflightUserSyncs.size;
}

export async function syncSystemSkillsForUser(
  userId: string,
  options?: {
    discoveredOverride?: ReadonlyArray<DiscoveredSystemSkill>;
    pathsOverride?: ReadonlyArray<string>;
  },
): Promise<SystemSkillSyncResult> {
  // Dedup concurrent calls for the same user — only when running the
  // default code path (no overrides). Tests intentionally use
  // pathsOverride so they need a fresh scan each invocation.
  const canDedup = !options?.discoveredOverride && !options?.pathsOverride;
  if (canDedup) {
    const existing = inflightUserSyncs.get(userId);
    if (existing) return existing;
  }

  const promise = doSyncSystemSkillsForUser(userId, options);
  if (canDedup) {
    inflightUserSyncs.set(userId, promise);
    void promise.finally(() => {
      inflightUserSyncs.delete(userId);
    });
  }
  return promise;
}

async function doSyncSystemSkillsForUser(
  userId: string,
  options?: {
    discoveredOverride?: ReadonlyArray<DiscoveredSystemSkill>;
    pathsOverride?: ReadonlyArray<string>;
  },
): Promise<SystemSkillSyncResult> {
  const discovered =
    options?.discoveredOverride ?? (await discoverSystemSkills(options?.pathsOverride));
  const discoveredIds = new Set(discovered.map((s) => s.skillId));

  const existingRows = sqliteAll<InstalledSkillIdRow>(
    `SELECT skill_id FROM installed_skills WHERE user_id = ? AND source_id LIKE ?`,
    [userId, `${SYSTEM_SOURCE_ID_PREFIX}%`],
  );
  const existingIds = new Set(existingRows.map((row) => row.skill_id));

  let removed = 0;
  for (const id of existingIds) {
    if (!discoveredIds.has(id)) {
      sqliteRun(`DELETE FROM installed_skills WHERE skill_id = ? AND user_id = ?`, [id, userId]);
      removed += 1;
    }
  }

  const now = Date.now();
  let added = 0;
  let updated = 0;
  for (const skill of discovered) {
    const isNew = !existingIds.has(skill.skillId);
    sqliteRun(
      `INSERT INTO installed_skills
         (skill_id, user_id, source_id, manifest_json, granted_permissions_json, enabled, installed_at, updated_at)
       VALUES (?, ?, ?, ?, '[]', 1, ?, ?)
       ON CONFLICT(skill_id, user_id) DO UPDATE SET
         source_id = excluded.source_id,
         manifest_json = excluded.manifest_json,
         updated_at = excluded.updated_at`,
      [skill.skillId, userId, skill.sourceId, JSON.stringify(skill.manifest), now, now],
    );
    if (isNew) {
      added += 1;
    } else {
      updated += 1;
    }
  }

  return { added, updated, removed, total: discovered.length };
}

/**
 * Convenience wrapper: scan once, then sync each user. Used at boot.
 */
export async function syncSystemSkillsForAllUsers(): Promise<{
  users: number;
  added: number;
  updated: number;
  removed: number;
  total: number;
}> {
  const discovered = await discoverSystemSkills();
  const users = sqliteAll<UserRow>('SELECT id FROM users');

  let added = 0;
  let updated = 0;
  let removed = 0;

  for (const user of users) {
    // Per-user resilience: syncSystemSkillsForUser issues DELETE / INSERT /
    // UPDATE writes that can throw (DB lock, disk error, constraint). This loop
    // runs at boot AND on the background scheduler, so one user's failure must
    // not starve system-skill sync for every subsequent user. Isolate per user
    // + warn, and keep the aggregate counts honest. (§0.102 class.)
    try {
      const result = await syncSystemSkillsForUser(user.id, { discoveredOverride: discovered });
      added += result.added;
      updated += result.updated;
      removed += result.removed;
    } catch (error) {
      console.warn(
        `[system-skills] 为用户 ${user.id} 同步系统技能失败，已跳过：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  return {
    users: users.length,
    added,
    updated,
    removed,
    total: discovered.length,
  };
}
