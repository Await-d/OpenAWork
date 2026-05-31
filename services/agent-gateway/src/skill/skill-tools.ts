import type { ToolDefinition } from '@openAwork/agent-core';
import type { SkillManifest } from '@openAwork/skill-types';
import { BUILTIN_SKILLS } from '@openAwork/skills';
import { z } from 'zod';
import { sqliteAll, sqliteGet } from '../infra/db.js';
import {
  readResponseTextWithLimit,
  resolveHttpBodyLimitBytes,
} from '../infra/http-body-limit.js';
import type { EffectiveSkill } from './skill-selection.js';

const skillInputSchema = z
  .object({
    name: z.string().optional(),
    skill: z.string().optional(),
  })
  .transform((value, context) => {
    const rawName =
      typeof value.name === 'string' && value.name.trim().length > 0 ? value.name : value.skill;
    const name = typeof rawName === 'string' ? rawName.trim() : '';

    if (name.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Skill tool requires a non-empty `skill` or `name` field.',
        path: ['skill'],
      });
    }

    return { name };
  });

const skillOutputSchema = z.string();

interface InstalledSkillRow {
  skill_id: string;
  source_id: string;
  manifest_json: string;
}

interface RegistrySourceSkillCacheRow {
  entry_json: string;
}

interface SkillEntryLike {
  id?: string;
  name?: string;
  displayName?: string;
  manifestUrl?: string;
}

type SkillManifestLike = Partial<SkillManifest>;

function normalizeSkillName(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Render the `<skill_files>` block listing the manifest's declared
 * reference files, mirroring opencode's `tool/skill.ts` skill loader
 * which appends a sampled file list so the model knows what bundled
 * resources (scripts, references, templates) the skill ships with —
 * without guessing paths.
 *
 * OpenAWork-specific note: opencode reads files directly from a
 * `SKILL.md` directory via ripgrep. We don't have that ground truth —
 * BUILTIN_SKILLS are packaged in code, cached skills are fetched via
 * HTTPS, and the installed-skills manifest doesn't carry a filesystem
 * location. The semantically-equivalent source is
 * `SkillManifest.references[].path`, which the manifest author
 * declares as the skill's bundled resources at install/publish time.
 *
 * Returns an empty array when no references are declared so the
 * caller can splice without producing an empty block (which would
 * still bloat the prompt-cache prefix byte-for-byte).
 */
export function renderSkillReferenceFilesBlock(manifest: SkillManifestLike): string[] {
  const refs = Array.isArray(manifest.references) ? manifest.references : [];
  const files: string[] = [];
  for (const ref of refs) {
    // Defensive narrowing: SkillManifest typing requires `loadAt` but
    // some persisted/cached manifests written by older versions may
    // omit it. Treat any entry with a non-empty `path` as a valid
    // reference candidate so the model still sees the bundled file.
    const candidatePath =
      ref && typeof (ref as { path?: unknown }).path === 'string'
        ? ((ref as { path: string }).path.trim() ?? '')
        : '';
    if (candidatePath.length > 0) {
      files.push(`<file>${candidatePath}</file>`);
    }
  }
  if (files.length === 0) return [];
  return [
    '',
    '<skill_files>',
    'Bundled resources (relative paths declared by the skill manifest;',
    'access via `read` / `list` once you have resolved them under the',
    'workspace skill root):',
    ...files,
    '</skill_files>',
  ];
}

/**
 * Parse an installed skill's `manifest_json` for the `findInstalledSkill`
 * scan below. That loop walks EVERY enabled installed skill (ordered by
 * recency) to resolve a skill by name; an unguarded `JSON.parse` on a single
 * corrupt `manifest_json` row (crash mid-write, disk error, hand-edited DB)
 * used to throw the whole loop — and since it is recency-ordered, one bad
 * manifest made the `skill` tool unable to resolve ANY skill, not just the
 * corrupt one. Return null + warn so the scan skips the bad row and the rest
 * still resolve. (§0.94 single-point-failure-isolation class.)
 */
function tryParseManifest(raw: string): SkillManifestLike | null {
  try {
    return JSON.parse(raw) as SkillManifestLike;
  } catch (err) {
    console.warn(
      `[skill-tools] installed_skills manifest_json 解析失败，已跳过：${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return null;
  }
}

function matchesRequestedSkill(
  name: string,
  manifest: SkillManifestLike,
  skillId: string,
): boolean {
  const normalizedName = normalizeSkillName(name);
  return [skillId, manifest.id, manifest.name, manifest.displayName]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .some((value) => normalizeSkillName(value) === normalizedName);
}

function buildBuiltinSkillContent(manifest: SkillManifestLike): string {
  const title = manifest.displayName ?? manifest.name ?? manifest.id ?? 'unknown-skill';
  const description = manifest.description ?? 'No description available.';
  const descriptionForModel = manifest.descriptionForModel?.trim();
  const capabilities = Array.isArray(manifest.capabilities) ? manifest.capabilities : [];
  const permissions = Array.isArray(manifest.permissions)
    ? manifest.permissions
        .map((permission) => `${permission.type ?? 'unknown'}:${permission.scope ?? '*'}`)
        .join(', ')
    : '';

  return [
    `<skill_content name="${title}">`,
    `# ${title}`,
    '',
    description,
    ...(descriptionForModel ? ['', 'Instructions for model:', descriptionForModel] : []),
    ...(capabilities.length > 0 ? ['', `Capabilities: ${capabilities.join(', ')}`] : []),
    ...(permissions.length > 0 ? ['', `Permissions: ${permissions}`] : []),
    ...renderSkillReferenceFilesBlock(manifest),
    '</skill_content>',
  ].join('\n');
}

function findBuiltinSkillContent(name: string): string | null {
  const normalizedName = normalizeSkillName(name);
  if (normalizedName.length === 0) {
    return null;
  }

  const entry = BUILTIN_SKILLS.find(({ manifest }) =>
    [manifest.id, manifest.name, manifest.displayName]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .some((value) => normalizeSkillName(value) === normalizedName),
  );
  if (!entry) {
    return null;
  }

  return buildBuiltinSkillContent(entry.manifest);
}

/**
 * Remote skill content lives at an arbitrary `manifestUrl`. Without a
 * timeout a hung endpoint would block the `skill` tool until the agent
 * run's own 30s tool budget elapses (and on some transports never abort
 * the socket). Bound the request explicitly so a slow CDN surfaces as a
 * clean error the model can recover from.
 */
const SKILL_CONTENT_FETCH_TIMEOUT_MS = 15_000;
// Remote SKILL.md content is arbitrary registry/CDN-supplied; cap the bytes
// read into memory so a huge/hostile response can't OOM the gateway (§0.86,
// same memory-bound invariant as webfetch §0.85). <=0 disables the cap.
const DEFAULT_SKILL_CONTENT_MAX_BYTES = 5 * 1024 * 1024;

export async function fetchSkillText(manifestUrl: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SKILL_CONTENT_FETCH_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(manifestUrl, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    // Release the unused body socket promptly before surfacing the error.
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`Failed to fetch skill content: HTTP ${response.status}`);
  }

  return readResponseTextWithLimit(
    response,
    resolveHttpBodyLimitBytes('OPENAWORK_SKILL_CONTENT_MAX_BYTES', DEFAULT_SKILL_CONTENT_MAX_BYTES),
  );
}

function findInstalledSkill(
  userId: string,
  name: string,
): {
  skillId: string;
  sourceId: string;
  manifest: SkillManifestLike;
} | null {
  const rows = sqliteAll<InstalledSkillRow>(
    'SELECT skill_id, source_id, manifest_json FROM installed_skills WHERE user_id = ? AND enabled = 1 ORDER BY updated_at DESC',
    [userId],
  );

  for (const row of rows) {
    const manifest = tryParseManifest(row.manifest_json);
    if (!manifest) continue;
    if (matchesRequestedSkill(name, manifest, row.skill_id)) {
      return {
        skillId: row.skill_id,
        sourceId: row.source_id,
        manifest,
      };
    }
  }

  return null;
}

function findCachedSkillEntry(
  userId: string,
  skillId: string,
  sourceId: string,
): SkillEntryLike | null {
  const row = sqliteGet<RegistrySourceSkillCacheRow>(
    `SELECT entry_json
     FROM registry_source_skill_cache
     WHERE user_id = ? AND source_id = ? AND skill_id = ?
     LIMIT 1`,
    [userId, sourceId, skillId],
  );
  if (!row) {
    return null;
  }

  // Tolerant parse: a corrupt cache row must degrade to "no cache hit" (the
  // caller then falls back to builtin / manifest content) rather than throw
  // out of the `skill` tool's execute path.
  try {
    return JSON.parse(row.entry_json) as SkillEntryLike;
  } catch (err) {
    console.warn(
      `[skill-tools] registry_source_skill_cache entry_json 解析失败，已忽略缓存：${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return null;
  }
}

export interface CreateSkillToolOptions {
  /**
   * Effective skill set for the (session, workspace, user) tuple. When
   * supplied, the tool's `description` enumerates only enabled installed/local
   * skills and BUILTIN entries; `execute` rejects requests for installed/local
   * skills outside this set. When omitted, the tool falls back to the legacy
   * permissive behaviour — used for the static `__tool-definitions__` instance
   * that never executes user requests directly.
   */
  effective?: EffectiveSkill[];
}

const BASE_DESCRIPTION =
  'Load an installed or built-in skill and inject its instructions into the conversation context. Use the exact skill name when possible.';

function describeEffectiveSkills(effective: EffectiveSkill[] | undefined): string {
  if (!effective || effective.length === 0) return BASE_DESCRIPTION;
  const enabled = effective.filter((entry) => entry.enabled);
  if (enabled.length === 0) {
    return `${BASE_DESCRIPTION}\n\n(No skills enabled for this workspace; the tool will refuse non-builtin requests.)`;
  }
  const lines = enabled.map((entry) => {
    const name = entry.manifest?.displayName ?? entry.manifest?.name ?? entry.skillId;
    const desc = entry.manifest?.description?.trim() ?? '';
    const tag = entry.origin === 'builtin' ? '[builtin]' : entry.pinned ? '[pinned]' : '[enabled]';
    return desc.length > 0 ? `- ${name} ${tag} — ${desc}` : `- ${name} ${tag}`;
  });
  return [BASE_DESCRIPTION, '', 'Available skills (this session):', ...lines].join('\n');
}

function buildAllowedNames(effective: EffectiveSkill[] | undefined): Set<string> {
  const allowed = new Set<string>();
  if (!effective) return allowed;
  for (const entry of effective) {
    if (!entry.enabled) continue;
    const candidates = [
      entry.skillId,
      entry.manifest?.id,
      entry.manifest?.name,
      entry.manifest?.displayName,
    ];
    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim().length > 0) {
        allowed.add(normalizeSkillName(candidate));
      }
    }
  }
  return allowed;
}

export function createSkillTool(
  sessionId: string,
  userId: string,
  options: CreateSkillToolOptions = {},
): ToolDefinition<typeof skillInputSchema, typeof skillOutputSchema> {
  const { effective } = options;
  const description = describeEffectiveSkills(effective);
  const allowedNames = buildAllowedNames(effective);
  const enforce = effective !== undefined;

  return {
    name: 'skill',
    description,
    inputSchema: skillInputSchema,
    outputSchema: skillOutputSchema,
    timeout: 30000,
    execute: async (input) => {
      void sessionId;
      // BUILTIN bypass: even when an effective set is provided, BUILTIN remain
      // unconditionally available (per spec — they are not filterable).
      const builtinContentEarly = findBuiltinSkillContent(input.name);
      if (builtinContentEarly) {
        return builtinContentEarly;
      }

      // Enforce selection when caller plumbed effective. Reject installed/local
      // skills outside the enabled set with a deterministic message so the
      // model can recover instead of silently retrying.
      if (enforce && !allowedNames.has(normalizeSkillName(input.name))) {
        throw new Error(`Skill not allowed in current workspace/session: ${input.name}`);
      }

      const installed = findInstalledSkill(userId, input.name);
      if (!installed) {
        throw new Error(`Skill not found: ${input.name}`);
      }

      const cachedEntry = findCachedSkillEntry(userId, installed.skillId, installed.sourceId);
      if (cachedEntry?.manifestUrl) {
        const content = await fetchSkillText(cachedEntry.manifestUrl);
        return [
          `<skill_content name="${installed.manifest.displayName ?? installed.manifest.name ?? input.name}">`,
          content.trim(),
          ...renderSkillReferenceFilesBlock(installed.manifest),
          '</skill_content>',
        ].join('\n');
      }

      const builtinContent =
        findBuiltinSkillContent(installed.skillId) ?? findBuiltinSkillContent(input.name);
      if (builtinContent) {
        return builtinContent;
      }

      return buildBuiltinSkillContent(installed.manifest);
    },
  };
}
