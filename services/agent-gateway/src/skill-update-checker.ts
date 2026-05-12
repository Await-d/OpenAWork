/**
 * Background task: check installed GitHub skills for newer remote versions.
 *
 * For each user-installed skill whose `source_id` starts with `github:`,
 * fetch the upstream `SKILL.md` (no auth, served from raw.githubusercontent.com),
 * parse its frontmatter `version:` field, and compare against the locally
 * stored manifest. Result is written back to the new
 * `installed_skills.latest_version_check_json` column so the UI can surface
 * an "更新可用" badge.
 *
 * Resource hygiene:
 *   - Concurrency cap: 4 simultaneous HTTPS fetches (raw.githubusercontent.com
 *     is generous but not unlimited).
 *   - Per-skill 8-second timeout via AbortController.
 *   - Stale-check window: 12h. A row whose `checked_at` is younger than that
 *     is skipped — protects against an over-eager scheduler interval blowing
 *     past the actual TTL the user expects.
 *   - Errors are recorded (not thrown) so a single broken SKILL.md doesn't
 *     poison the whole batch.
 */

import { sqliteAll, sqliteRun } from './db.js';

const SKILL_UPDATE_CHECK_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const SKILL_UPDATE_FETCH_TIMEOUT_MS = 8 * 1000;
const SKILL_UPDATE_FETCH_CONCURRENCY = 4;

interface InstalledRow {
  skill_id: string;
  user_id: string;
  source_id: string;
  manifest_json: string;
  latest_version_check_json: string | null;
}

interface ManifestLike {
  id?: string;
  name?: string;
  version?: string;
  references?: Array<{ path?: string; url?: string; type?: string }>;
}

export interface LatestVersionCheck {
  latestVersion: string | null;
  checkedAt: number;
  error: string | null;
}

export interface SkillUpdateCheckSummary {
  scanned: number;
  fetched: number;
  updatesFound: number;
  errors: number;
  skipped: number;
}

async function fetchTextWithTimeout(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SKILL_UPDATE_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Extract `version:` from YAML frontmatter at the top of a SKILL.md.
 * Returns the raw string (without quotes) or null if absent.
 */
function parseVersionFromFrontmatter(text: string): string | null {
  const fmMatch = text.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch || !fmMatch[1]) return null;
  for (const line of fmMatch[1].split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('version')) continue;
    const colon = trimmed.indexOf(':');
    if (colon === -1) continue;
    const raw = trimmed
      .slice(colon + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
    return raw.length > 0 ? raw : null;
  }
  return null;
}

/**
 * Build the raw.githubusercontent.com URL for a GitHub-sourced skill.
 *
 * Two shapes are supported:
 *   1. The manifest carries a `references[0].url` pointing at the
 *      raw SKILL.md (set by `routes/skills.ts:install` for GitHub
 *      skills) → use it as-is.
 *   2. Fallback: synthesise from skill_id which is structured as
 *      `github:owner/repo/<rel-path-without-SKILL.md>`. We append
 *      `/SKILL.md` and fetch from the default branch (`main`).
 *      This path is approximate (no ref pin) but matches what the
 *      install endpoint itself does in the same fallback shape.
 */
function buildRawUrl(skillId: string, manifest: ManifestLike): string | null {
  const explicit = manifest.references?.find((r) => r?.url && /^https?:/i.test(r.url));
  if (explicit?.url) return explicit.url;

  if (!skillId.startsWith('github:')) return null;
  const stripped = skillId.slice('github:'.length);
  const parts = stripped.split('/');
  if (parts.length < 3) return null;
  const [owner, repo, ...rest] = parts;
  if (!owner || !repo || rest.length === 0) return null;
  return `https://raw.githubusercontent.com/${owner}/${repo}/main/${rest.join('/')}/SKILL.md`;
}

async function checkOneRow(row: InstalledRow): Promise<LatestVersionCheck | null> {
  let manifest: ManifestLike;
  try {
    manifest = JSON.parse(row.manifest_json) as ManifestLike;
  } catch {
    return {
      latestVersion: null,
      checkedAt: Date.now(),
      error: 'manifest_json parse failed',
    };
  }

  const url = buildRawUrl(row.skill_id, manifest);
  if (!url) return null; // Not a GitHub-sourced skill we can probe.

  const text = await fetchTextWithTimeout(url);
  if (text === null) {
    return {
      latestVersion: null,
      checkedAt: Date.now(),
      error: 'fetch failed or non-200',
    };
  }

  const remoteVersion = parseVersionFromFrontmatter(text);
  return {
    latestVersion: remoteVersion,
    checkedAt: Date.now(),
    error: null,
  };
}

/**
 * Generic concurrency-limited map. Kept inline to avoid an import
 * cycle with `routes/skills.ts` (which owns the other copy).
 */
async function pMapConcurrent<T, R>(
  inputs: ReadonlyArray<T>,
  worker: (item: T, index: number) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  const results: R[] = new Array(inputs.length);
  let cursor = 0;
  const runners = Array.from(
    { length: Math.max(1, Math.min(concurrency, inputs.length)) },
    async () => {
      while (true) {
        const myIndex = cursor++;
        if (myIndex >= inputs.length) return;
        results[myIndex] = await worker(inputs[myIndex]!, myIndex);
      }
    },
  );
  await Promise.all(runners);
  return results;
}

function shouldSkip(row: InstalledRow): boolean {
  if (!row.latest_version_check_json) return false;
  try {
    const prev = JSON.parse(row.latest_version_check_json) as LatestVersionCheck;
    if (typeof prev.checkedAt !== 'number') return false;
    return Date.now() - prev.checkedAt < SKILL_UPDATE_CHECK_TTL_MS;
  } catch {
    return false;
  }
}

/**
 * Walk every GitHub-installed skill across all users and refresh its
 * `latest_version_check_json` if older than the TTL. Returns a
 * summary so the boot logger / background scheduler can surface
 * what changed in the run.
 */
export async function checkInstalledSkillUpdates(): Promise<SkillUpdateCheckSummary> {
  const rows = sqliteAll<InstalledRow>(
    `SELECT skill_id, user_id, source_id, manifest_json, latest_version_check_json
       FROM installed_skills
      WHERE source_id LIKE 'github:%'`,
  );

  const summary: SkillUpdateCheckSummary = {
    scanned: rows.length,
    fetched: 0,
    updatesFound: 0,
    errors: 0,
    skipped: 0,
  };

  const candidates = rows.filter((row) => {
    if (shouldSkip(row)) {
      summary.skipped += 1;
      return false;
    }
    return true;
  });

  await pMapConcurrent(
    candidates,
    async (row) => {
      const result = await checkOneRow(row);
      if (!result) return;
      summary.fetched += 1;
      if (result.error) summary.errors += 1;

      if (result.latestVersion) {
        let local: string | undefined;
        try {
          local = (JSON.parse(row.manifest_json) as ManifestLike).version;
        } catch {
          local = undefined;
        }
        if (local && local !== result.latestVersion) {
          summary.updatesFound += 1;
        }
      }

      sqliteRun(
        `UPDATE installed_skills
            SET latest_version_check_json = ?
          WHERE skill_id = ? AND user_id = ?`,
        [JSON.stringify(result), row.skill_id, row.user_id],
      );
    },
    SKILL_UPDATE_FETCH_CONCURRENCY,
  );

  return summary;
}

/** Test-only: surface the parser so other modules don't need to dup it. */
export const __testing = {
  parseVersionFromFrontmatter,
  buildRawUrl,
};
