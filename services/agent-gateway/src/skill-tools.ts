import type { ToolDefinition } from '@openAwork/agent-core';
import { z } from 'zod';
import { BUILTIN_SKILLS } from '@openAwork/skills';
import { sqliteAll, sqliteGet } from './db.js';

const skillInputSchema = z.object({
  name: z.string().min(1),
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

interface SkillManifestLike {
  id?: string;
  name?: string;
  displayName?: string;
  description?: string;
  permissions?: Array<{ type?: string; scope?: string }>;
  capabilities?: string[];
}

function normalizeSkillName(value: string): string {
  return value.trim().toLowerCase();
}

function parseManifest(raw: string): SkillManifestLike {
  return JSON.parse(raw) as SkillManifestLike;
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
    ...(capabilities.length > 0 ? ['', `Capabilities: ${capabilities.join(', ')}`] : []),
    ...(permissions.length > 0 ? ['', `Permissions: ${permissions}`] : []),
    '</skill_content>',
  ].join('\n');
}

function findBuiltinSkillContent(name: string): string | null {
  const normalizedName = normalizeSkillName(name);
  const entry = BUILTIN_SKILLS.find(({ manifest }) =>
    [manifest.id, manifest.name, manifest.displayName].some(
      (value) => normalizeSkillName(value) === normalizedName,
    ),
  );
  if (!entry) {
    return null;
  }

  return buildBuiltinSkillContent(entry.manifest);
}

async function fetchSkillText(manifestUrl: string): Promise<string> {
  const response = await fetch(manifestUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch skill content: HTTP ${response.status}`);
  }

  return response.text();
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
    const manifest = parseManifest(row.manifest_json);
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

  return JSON.parse(row.entry_json) as SkillEntryLike;
}

export function createSkillTool(
  sessionId: string,
  userId: string,
): ToolDefinition<typeof skillInputSchema, typeof skillOutputSchema> {
  return {
    name: 'skill',
    description:
      'Load an installed skill and inject its instructions into the conversation context. Use the exact installed skill name when possible.',
    inputSchema: skillInputSchema,
    outputSchema: skillOutputSchema,
    timeout: 30000,
    execute: async (input) => {
      void sessionId;
      const installed = findInstalledSkill(userId, input.name);
      if (!installed) {
        throw new Error(`Installed skill not found: ${input.name}`);
      }

      const cachedEntry = findCachedSkillEntry(userId, installed.skillId, installed.sourceId);
      if (cachedEntry?.manifestUrl) {
        const content = await fetchSkillText(cachedEntry.manifestUrl);
        return [
          `<skill_content name="${installed.manifest.displayName ?? installed.manifest.name ?? input.name}">`,
          content.trim(),
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
