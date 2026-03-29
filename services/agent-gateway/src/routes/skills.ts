import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { JwtPayload } from '../auth.js';
import { requireAuth } from '../auth.js';
import { db, sqliteAll, sqliteGet, sqliteRun } from '../db.js';
import {
  SkillRegistryClientImpl,
  RegistrySourceManager,
  OFFICIAL_REGISTRY_SOURCE,
} from '@openAwork/skill-registry';
import type { RegistrySource, SkillEntry } from '@openAwork/skill-registry';
import { BUILTIN_SKILLS } from '@openAwork/skills';
import { startRequestWorkflow } from '../request-workflow.js';

interface InstalledSkillRow {
  skill_id: string;
  source_id: string;
  manifest_json: string;
  granted_permissions_json: string;
  enabled: number;
  installed_at: number;
  updated_at: number;
}

interface RegistrySourceRow {
  id: string;
  name: string;
  url: string;
  type: string;
  trust: string;
  enabled: number;
  priority: number;
  auth_json: string | null;
  last_synced_at: number | null;
  last_sync_attempt_at: number | null;
  last_sync_error: string | null;
  cached_skill_count: number | null;
}

interface RegistrySourceSkillCacheRow {
  entry_json: string;
}

interface RegistrySourceSyncResult {
  entries: SkillEntry[];
  errorMessage?: string;
  fallbackToCache: boolean;
}

function rowToInstalledSkill(row: InstalledSkillRow) {
  return {
    skillId: row.skill_id,
    sourceId: row.source_id,
    manifest: JSON.parse(row.manifest_json) as unknown,
    grantedPermissions: JSON.parse(row.granted_permissions_json) as unknown[],
    enabled: row.enabled === 1,
    installedAt: row.installed_at,
    updatedAt: row.updated_at,
  };
}

function rowToSource(row: RegistrySourceRow) {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    type: row.type,
    trust: row.trust,
    enabled: row.enabled === 1,
    priority: row.priority,
    auth: row.auth_json ? (JSON.parse(row.auth_json) as unknown) : undefined,
    lastSyncedAt: row.last_synced_at ?? undefined,
    lastSyncAttemptAt: row.last_sync_attempt_at ?? undefined,
    lastSyncError: row.last_sync_error ?? undefined,
    cachedSkillCount: row.cached_skill_count ?? 0,
  };
}

function rowToClientSource(row: RegistrySourceRow): RegistrySource {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    type: row.type as RegistrySource['type'],
    trust: row.trust as RegistrySource['trust'],
    enabled: row.enabled === 1,
    priority: row.priority,
    auth: row.auth_json ? (JSON.parse(row.auth_json) as RegistrySource['auth']) : undefined,
  };
}

function summarizeFallbackSyncResults(
  sources: ReadonlyArray<RegistrySource>,
  syncResults: ReadonlyArray<RegistrySourceSyncResult>,
): {
  fallbackSources: number;
  fallbackSourceIds?: string;
  fallbackErrors?: string;
} {
  const fallbackEntries = syncResults.flatMap((result, index) => {
    if (!result.fallbackToCache) {
      return [];
    }

    return [
      {
        sourceId: sources[index]?.id ?? 'unknown',
        errorMessage: result.errorMessage ?? 'unknown error',
      },
    ];
  });

  return {
    fallbackSources: fallbackEntries.length,
    fallbackSourceIds:
      fallbackEntries.length > 0
        ? fallbackEntries.map((entry) => entry.sourceId).join(',')
        : undefined,
    fallbackErrors:
      fallbackEntries.length > 0
        ? fallbackEntries
            .map((entry) => `${entry.sourceId}:${entry.errorMessage}`)
            .join(' | ')
            .slice(0, 500)
        : undefined,
  };
}

interface GitHubDirEntry {
  name: string;
  path: string;
  type: string;
  download_url: string | null;
}

interface SkillFrontmatter {
  name?: string;
  description?: string;
  license?: string;
  metadata?: { author?: string; version?: string };
}

interface DirectSkillFile {
  path: string;
  downloadUrl: string;
}

type GitHubRepoDiscoveryMode = 'contents' | 'code-search';
type GitHubRepoMetadataMode = 'frontmatter' | 'path';

interface GitHubRepoConfig {
  owner: string;
  repo: string;
  rootPaths: string[];
  maxDepth: number;
  ref?: string;
  discoveryMode?: GitHubRepoDiscoveryMode;
  metadataMode?: GitHubRepoMetadataMode;
  browseLimit?: number;
}

interface BuiltinGitHubSourceDefinition extends GitHubRepoConfig {
  name: string;
  priority: number;
  directSkillFiles?: DirectSkillFile[];
}

interface GitHubCodeSearchItem {
  path: string;
}

interface GitHubCodeSearchResponse {
  items?: GitHubCodeSearchItem[];
}

interface DiscoveredGitHubSkillFile extends GitHubDirEntry {
  download_url: string;
}

export interface BuiltinRegistrySource extends RegistrySource {
  readonly: true;
  directSkillFiles?: DirectSkillFile[];
  repo?: GitHubRepoConfig;
}

interface GitHubSourceCacheEntry {
  fetchedAt: number;
  items: SkillEntry[];
}

const GITHUB_SOURCE_CACHE_TTL_MS = 30 * 60 * 1000;
const GITHUB_SOURCE_STALE_IF_ERROR_MS = 6 * 60 * 60 * 1000;
const GITHUB_FETCH_TIMEOUT_MS = 8000;
const GITHUB_SOURCE_MAX_DIRECTORY_REQUESTS = 120;
const GITHUB_SOURCE_MAX_SKILL_FILES = 200;
const githubSourceCache = new Map<string, GitHubSourceCacheEntry>();
const registrySourceSyncInflight = new Map<string, Promise<RegistrySourceSyncResult>>();

function createBuiltinGitHubSource({
  name,
  owner,
  repo,
  rootPaths,
  maxDepth,
  ref,
  priority,
  directSkillFiles,
  discoveryMode,
  metadataMode,
  browseLimit,
}: BuiltinGitHubSourceDefinition): BuiltinRegistrySource {
  return {
    id: `github:${owner}/${repo}`,
    name,
    url: `https://github.com/${owner}/${repo}`,
    type: 'community',
    trust: 'verified',
    enabled: true,
    priority,
    readonly: true,
    metadata: { provider: 'github', repo: `${owner}/${repo}` },
    directSkillFiles,
    repo: {
      owner,
      repo,
      rootPaths,
      maxDepth,
      ref,
      discoveryMode,
      metadataMode,
      browseLimit,
    },
  };
}

export const BUILTIN_REGISTRY_SOURCES: BuiltinRegistrySource[] = [
  {
    ...OFFICIAL_REGISTRY_SOURCE,
    readonly: true,
  },
  createBuiltinGitHubSource({
    name: 'Anthropic Skills',
    owner: 'anthropics',
    repo: 'skills',
    rootPaths: ['skills'],
    maxDepth: 1,
    ref: '887114fd09f8f24a7e6c907f9ee505348498ab6a',
    priority: 2,
  }),
  createBuiltinGitHubSource({
    name: 'OpenAI Skills',
    owner: 'openai',
    repo: 'skills',
    rootPaths: ['skills'],
    maxDepth: 2,
    ref: '82d2c5b44ac234ec0f204f647562a4349d90ef43',
    priority: 3,
  }),
  createBuiltinGitHubSource({
    name: 'Vercel Skills',
    owner: 'vercel-labs',
    repo: 'skills',
    rootPaths: ['skills'],
    maxDepth: 1,
    ref: 'fc3b8b8d68bd640028d2ceedaa5fe2fdf129d05a',
    priority: 4,
  }),
  createBuiltinGitHubSource({
    name: 'Matt Pocock Skills',
    owner: 'mattpocock',
    repo: 'skills',
    rootPaths: [''],
    maxDepth: 1,
    ref: 'fb3629d3a2ba638a65ef336061204995be7f5d5e',
    priority: 5,
  }),
  createBuiltinGitHubSource({
    name: 'Hugging Face Skills',
    owner: 'huggingface',
    repo: 'skills',
    rootPaths: ['skills', 'hf-mcp/skills'],
    maxDepth: 1,
    ref: 'f4ea9f5008150ef5524ac9f5577e02807ef7b00e',
    priority: 6,
  }),
  createBuiltinGitHubSource({
    name: 'Obra Superpowers',
    owner: 'obra',
    repo: 'superpowers',
    rootPaths: ['skills'],
    maxDepth: 1,
    ref: '8ea39819eed74fe2a0338e71789f06b30e953041',
    priority: 7,
  }),
  createBuiltinGitHubSource({
    name: 'Everything Claude Code',
    owner: 'affaan-m',
    repo: 'everything-claude-code',
    rootPaths: ['skills'],
    maxDepth: 4,
    ref: 'df4f2df297847687bd8835c440803de36966b2c9',
    discoveryMode: 'code-search',
    metadataMode: 'path',
    browseLimit: 80,
    priority: 8,
  }),
  createBuiltinGitHubSource({
    name: 'OpenClaw Skills',
    owner: 'openclaw',
    repo: 'skills',
    rootPaths: ['skills'],
    maxDepth: 4,
    ref: '8a697172559d73608fb16eae017a82f26beb4c5c',
    discoveryMode: 'code-search',
    metadataMode: 'path',
    browseLimit: 80,
    priority: 9,
  }),
  createBuiltinGitHubSource({
    name: 'Vercel Agent Skills',
    owner: 'vercel-labs',
    repo: 'agent-skills',
    rootPaths: ['skills'],
    maxDepth: 2,
    priority: 10,
  }),
  createBuiltinGitHubSource({
    name: 'Vercel Deploy Claude Plugin',
    owner: 'vercel',
    repo: 'vercel-deploy-claude-code-plugin',
    rootPaths: ['skills'],
    maxDepth: 2,
    ref: 'ae067751b4f42c97d13054211657275029ca8b6d',
    priority: 11,
  }),
  createBuiltinGitHubSource({
    name: 'Daymade Claude Code Skills',
    owner: 'daymade',
    repo: 'claude-code-skills',
    rootPaths: [''],
    maxDepth: 1,
    ref: '392d34c161043ab7029b3db8204521cd71b983d3',
    priority: 12,
  }),
  createBuiltinGitHubSource({
    name: 'Block Agent Skills',
    owner: 'block',
    repo: 'agent-skills',
    rootPaths: [''],
    maxDepth: 1,
    ref: '60bfdadb7a35cdb71bc34a2c3b91c560e69c4044',
    priority: 13,
  }),
  createBuiltinGitHubSource({
    name: 'Binance Skills Hub',
    owner: 'binance',
    repo: 'binance-skills-hub',
    rootPaths: ['skills'],
    maxDepth: 4,
    ref: '79c4cb4ab9af64cd03e579206bad5f9864fcb1d1',
    priority: 14,
  }),
  createBuiltinGitHubSource({
    name: 'Trail of Bits Skills Curated',
    owner: 'trailofbits',
    repo: 'skills-curated',
    rootPaths: ['plugins'],
    maxDepth: 4,
    ref: '022fa0948818c9f2f738a428f4546cc65c427767',
    priority: 15,
  }),
  createBuiltinGitHubSource({
    name: 'Claude Skills Marketplace',
    owner: 'mhattingpete',
    repo: 'claude-skills-marketplace',
    rootPaths: [''],
    maxDepth: 3,
    ref: '3fa16a94e0aba3509e4d4b318ca175d3191b5b7d',
    priority: 16,
  }),
  createBuiltinGitHubSource({
    name: 'Await Agentdocs Orchestrator',
    owner: 'Await-d',
    repo: 'agentdocs-orchestrator',
    rootPaths: [''],
    maxDepth: 1,
    ref: '229dec2616341c68382ebfee8f462add420c3483',
    priority: 17,
    directSkillFiles: [
      {
        path: 'agentdocs-orchestrator/SKILL.md',
        downloadUrl:
          'https://raw.githubusercontent.com/Await-d/agentdocs-orchestrator/229dec2616341c68382ebfee8f462add420c3483/agentdocs-orchestrator/SKILL.md',
      },
      {
        path: 'schema-architect/SKILL.md',
        downloadUrl:
          'https://raw.githubusercontent.com/Await-d/agentdocs-orchestrator/229dec2616341c68382ebfee8f462add420c3483/schema-architect/SKILL.md',
      },
    ],
  }),
  {
    id: 'builtin',
    name: 'OpenAWork Built-in Skills',
    url: 'builtin://local-skills',
    type: 'local',
    trust: 'full',
    enabled: true,
    priority: 1,
    readonly: true,
    metadata: { provider: 'builtin' },
  },
];

function isReadonlySourceId(sourceId: string): boolean {
  return BUILTIN_REGISTRY_SOURCES.some((source) => source.id === sourceId && source.readonly);
}

function buildRegistrySources(userRows: RegistrySourceRow[]) {
  const userSources = userRows.map(rowToSource).filter((source) => !isReadonlySourceId(source.id));
  return [...BUILTIN_REGISTRY_SOURCES, ...userSources].sort((a, b) => a.priority - b.priority);
}

function normalizeSkillEntry(entry: SkillEntry, sourceId: string): SkillEntry {
  return {
    ...entry,
    sourceId: entry.sourceId || sourceId,
    category: entry.category ?? 'other',
    tags: entry.tags ?? [],
  };
}

function buildSkillSearchText(entry: SkillEntry): string {
  return [
    entry.id,
    entry.name,
    entry.displayName,
    entry.description,
    ...(entry.tags ?? []),
    entry.author,
  ]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join(' ')
    .toLowerCase();
}

function parseCachedSkillEntry(row: RegistrySourceSkillCacheRow): SkillEntry {
  return JSON.parse(row.entry_json) as SkillEntry;
}

export function filterSkillEntries(
  entries: ReadonlyArray<SkillEntry>,
  query?: string,
  category?: string,
): SkillEntry[] {
  const normalizedQuery = query?.trim().toLowerCase() ?? '';
  return entries.filter((entry) => {
    if (category && entry.category !== category) {
      return false;
    }
    if (!normalizedQuery) {
      return true;
    }
    return buildSkillSearchText(entry).includes(normalizedQuery);
  });
}

function dedupeSkillEntries(entries: ReadonlyArray<SkillEntry>): SkillEntry[] {
  const deduped = new Map<string, SkillEntry>();
  for (const entry of entries) {
    if (!deduped.has(entry.id)) {
      deduped.set(entry.id, entry);
    }
  }
  return [...deduped.values()];
}

function buildRegistrySourceSyncKey(userId: string, sourceId: string): string {
  return `${userId}:${sourceId}`;
}

function getUserRegistrySourceRows(userId: string, enabledOnly = false): RegistrySourceRow[] {
  const enabledSql = enabledOnly ? ' AND enabled = 1' : '';
  return sqliteAll<RegistrySourceRow>(
    `SELECT * FROM registry_sources WHERE user_id = ?${enabledSql} ORDER BY priority ASC`,
    [userId],
  );
}

function listCachedRegistrySourceSkills(
  userId: string,
  query?: string,
  category?: string,
  sourceId?: string,
): SkillEntry[] {
  const clauses = ['cache.user_id = ?', 'src.enabled = 1'];
  const params: Array<string | number> = [userId];
  if (sourceId) {
    clauses.push('cache.source_id = ?');
    params.push(sourceId);
  }
  const normalizedQuery = query?.trim().toLowerCase();
  if (normalizedQuery) {
    clauses.push('cache.search_text LIKE ?');
    params.push(`%${normalizedQuery}%`);
  }
  if (category) {
    clauses.push('cache.category = ?');
    params.push(category);
  }

  const rows = sqliteAll<RegistrySourceSkillCacheRow>(
    `SELECT cache.entry_json
       FROM registry_source_skill_cache cache
       JOIN registry_sources src
         ON src.id = cache.source_id
        AND src.user_id = cache.user_id
      WHERE ${clauses.join(' AND ')}
      ORDER BY src.priority ASC, cache.skill_id ASC`,
    params,
  );
  return rows.map(parseCachedSkillEntry);
}

function replaceRegistrySourceCache(
  userId: string,
  sourceId: string,
  entries: ReadonlyArray<SkillEntry>,
): void {
  const now = Date.now();
  const insert = db.prepare(
    `INSERT INTO registry_source_skill_cache
      (source_id, user_id, skill_id, category, search_text, entry_json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  try {
    db.exec('BEGIN');
    db.prepare('DELETE FROM registry_source_skill_cache WHERE source_id = ? AND user_id = ?').run(
      sourceId,
      userId,
    );
    for (const entry of entries) {
      const normalizedEntry = normalizeSkillEntry(entry, sourceId);
      insert.run(
        sourceId,
        userId,
        normalizedEntry.id,
        normalizedEntry.category,
        buildSkillSearchText(normalizedEntry),
        JSON.stringify(normalizedEntry),
        now,
      );
    }
    db.prepare(
      `UPDATE registry_sources
          SET last_sync_attempt_at = ?,
              last_synced_at = ?,
              last_sync_error = NULL,
              cached_skill_count = ?
        WHERE id = ? AND user_id = ?`,
    ).run(now, now, entries.length, sourceId, userId);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function markRegistrySourceSyncError(userId: string, sourceId: string, error: string): void {
  sqliteRun(
    'UPDATE registry_sources SET last_sync_attempt_at = ?, last_sync_error = ? WHERE id = ? AND user_id = ?',
    [Date.now(), error.slice(0, 500), sourceId, userId],
  );
}

function buildRegistrySourceHeaders(source: RegistrySource): HeadersInit {
  if (!source.auth || source.auth.type === 'none') {
    return {};
  }

  if (source.auth.type === 'bearer') {
    return {
      Authorization: `Bearer ${source.auth.token}`,
    };
  }

  return {
    [source.auth.header]: source.auth.value,
  };
}

async function fetchRegistrySourceSnapshot(source: RegistrySource): Promise<SkillEntry[]> {
  const url = new URL(`${source.url.replace(/\/$/, '')}/skills/search.json`);
  const response = await fetchWithTimeout(url.toString(), {
    method: 'GET',
    headers: buildRegistrySourceHeaders(source),
  });
  if (!response.ok) {
    throw new Error(`Search failed for source '${source.id}', HTTP ${response.status}`);
  }

  const body = (await response.json()) as { items?: SkillEntry[] } | SkillEntry[];
  const items = Array.isArray(body) ? body : (body.items ?? []);
  return items.map((item) => normalizeSkillEntry(item, source.id));
}

async function syncRegistrySourceCacheForUser(
  userId: string,
  source: RegistrySource,
): Promise<RegistrySourceSyncResult> {
  const syncKey = buildRegistrySourceSyncKey(userId, source.id);
  const inflight = registrySourceSyncInflight.get(syncKey);
  if (inflight) {
    return inflight;
  }

  const syncPromise = (async () => {
    try {
      const entries = await fetchRegistrySourceSnapshot(source);
      replaceRegistrySourceCache(userId, source.id, entries);
      return {
        entries,
        fallbackToCache: false,
      } satisfies RegistrySourceSyncResult;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      markRegistrySourceSyncError(userId, source.id, message);
      return {
        entries: listCachedRegistrySourceSkills(userId, undefined, undefined, source.id),
        errorMessage: message,
        fallbackToCache: true,
      } satisfies RegistrySourceSyncResult;
    } finally {
      registrySourceSyncInflight.delete(syncKey);
    }
  })();
  registrySourceSyncInflight.set(syncKey, syncPromise);
  return syncPromise;
}

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GITHUB_FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function parseSkillFrontmatter(text: string): SkillFrontmatter {
  const fmMatch = text.match(/^---\n([\s\S]*?)\n---/);
  const fmRaw = fmMatch?.[1] ?? '';
  const fm: SkillFrontmatter = {};
  for (const line of fmRaw.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const val = line
      .slice(colonIdx + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
    if (key === 'name') fm.name = val;
    if (key === 'description') fm.description = val;
    if (key === 'license') fm.license = val;
  }

  if (!fm.description) {
    const body = text.replace(/^---\n[\s\S]*?\n---\n?/, '').trim();
    const summary = body
      .split('\n\n')
      .map((chunk) => chunk.replace(/^#+\s*/gm, '').trim())
      .find((chunk) => chunk.length > 0);
    if (summary) {
      fm.description = summary.slice(0, 240);
    }
  }

  return fm;
}

function normalizeGitHubRepoPath(path: string): string {
  return path.replace(/^\/+|\/+$/g, '');
}

function encodeGitHubPath(path: string): string {
  return path
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function isSkillMarkdownFileName(fileName: string): boolean {
  return fileName.toLowerCase() === 'skill.md';
}

function isSkillMarkdownPath(filePath: string): boolean {
  const segments = filePath.split('/');
  const fileName = segments[segments.length - 1] ?? '';
  return isSkillMarkdownFileName(fileName);
}

function stripSkillMarkdownSuffix(filePath: string): string {
  return filePath.replace(/\/skill\.md$/i, '');
}

function buildGitHubSkillDisplayName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return trimmed;
  }
  if (!/[-_]/.test(trimmed)) {
    return trimmed;
  }

  return trimmed
    .replace(/[-_]+/g, ' ')
    .split(/\s+/)
    .filter((segment) => segment.length > 0)
    .map((segment) => {
      if (/[A-Z]/.test(segment) || /\d/.test(segment)) {
        return segment;
      }
      return segment.charAt(0).toUpperCase() + segment.slice(1);
    })
    .join(' ');
}

function buildGitHubSkillName(filePath: string): string {
  const relativeId = stripSkillMarkdownSuffix(filePath);
  const segments = relativeId.split('/').filter((segment) => segment.length > 0);
  return segments[segments.length - 1] ?? relativeId;
}

function buildGitHubRawUrl(source: BuiltinRegistrySource, filePath: string): string | undefined {
  if (!source.repo?.ref) {
    return undefined;
  }
  return `https://raw.githubusercontent.com/${source.repo.owner}/${source.repo.repo}/${source.repo.ref}/${encodeGitHubPath(filePath)}`;
}

function isGitHubSkillPathWithinBounds(filePath: string, repo: GitHubRepoConfig): boolean {
  if (!isSkillMarkdownPath(filePath)) {
    return false;
  }

  const normalizedPath = filePath.replace(/^\/+/, '');
  return repo.rootPaths.some((rootPath) => {
    const normalizedRoot = normalizeGitHubRepoPath(rootPath);
    const prefix = normalizedRoot ? `${normalizedRoot}/` : '';
    const relativePath = normalizedRoot
      ? normalizedPath.startsWith(prefix)
        ? normalizedPath.slice(prefix.length)
        : normalizedPath === `${normalizedRoot}/SKILL.md`
          ? 'SKILL.md'
          : normalizedPath === `${normalizedRoot}/skill.md`
            ? 'skill.md'
            : undefined
      : normalizedPath;

    if (!relativePath) {
      return false;
    }

    const relativeId = stripSkillMarkdownSuffix(relativePath);
    const depth = relativeId.length === 0 ? 0 : relativeId.split('/').length;
    return depth <= repo.maxDepth;
  });
}

function buildGitHubSkillDescription(
  source: BuiltinRegistrySource,
  file: DiscoveredGitHubSkillFile,
): string {
  return `Discovered from ${source.name} · ${stripSkillMarkdownSuffix(file.path)}`;
}

function dedupeGitHubSkillFiles(files: DiscoveredGitHubSkillFile[]): DiscoveredGitHubSkillFile[] {
  return [...new Map(files.map((file) => [file.path, file])).values()];
}

function buildGitHubSourceCacheKey(source: BuiltinRegistrySource, query: string): string {
  return source.repo?.discoveryMode === 'code-search' ? `${source.id}::${query}` : source.id;
}

function isGitHubCacheFresh(entry: GitHubSourceCacheEntry): boolean {
  return Date.now() - entry.fetchedAt < GITHUB_SOURCE_CACHE_TTL_MS;
}

function isGitHubCacheUsableOnError(entry: GitHubSourceCacheEntry): boolean {
  return Date.now() - entry.fetchedAt < GITHUB_SOURCE_STALE_IF_ERROR_MS;
}

function matchesGitHubSkillQuery(item: SkillEntry, query: string): boolean {
  if (!query) {
    return true;
  }
  return (
    item.name.toLowerCase().includes(query) ||
    item.displayName.toLowerCase().includes(query) ||
    item.description.toLowerCase().includes(query)
  );
}

function applyGitHubBrowseLimit(
  files: DiscoveredGitHubSkillFile[],
  source: BuiltinRegistrySource,
  query: string,
): DiscoveredGitHubSkillFile[] {
  const deduped = dedupeGitHubSkillFiles(files);
  if (query) {
    return deduped;
  }

  const sorted = [...deduped].sort((a, b) => a.path.localeCompare(b.path));
  const browseLimit = source.repo?.browseLimit;
  return browseLimit ? sorted.slice(0, browseLimit) : sorted;
}

function buildGitHubPathSkillEntry(
  source: BuiltinRegistrySource,
  file: DiscoveredGitHubSkillFile,
): SkillEntry | undefined {
  if (!source.repo) {
    return undefined;
  }

  const relativeId = stripSkillMarkdownSuffix(file.path);
  const name = buildGitHubSkillName(file.path);
  return {
    id: `${source.id}/${relativeId}`,
    name,
    displayName: buildGitHubSkillDisplayName(name),
    version: '1.0.0',
    description: buildGitHubSkillDescription(source, file),
    category: 'other' as const,
    sourceId: source.id,
    tags: [source.repo.owner, source.repo.repo],
    author: source.repo.owner,
    manifestUrl: file.download_url,
  };
}

async function buildGitHubFrontmatterSkillEntry(
  source: BuiltinRegistrySource,
  file: DiscoveredGitHubSkillFile,
): Promise<SkillEntry | undefined> {
  const manifestUrl = file.download_url;
  const sourceRepo = source.repo;
  if (!manifestUrl || !sourceRepo) {
    return undefined;
  }

  const mdRes = await fetchWithTimeout(manifestUrl, {}).catch(() => undefined);
  if (!mdRes?.ok) {
    return undefined;
  }

  const text = await mdRes.text();
  const fm = parseSkillFrontmatter(text);
  const name = fm.name?.trim() || buildGitHubSkillName(file.path);
  const relativeId = stripSkillMarkdownSuffix(file.path);
  return {
    id: `${source.id}/${relativeId}`,
    name,
    displayName: buildGitHubSkillDisplayName(name),
    version: '1.0.0',
    description: fm.description ?? buildGitHubSkillDescription(source, file),
    category: 'other' as const,
    sourceId: source.id,
    tags: [sourceRepo.owner, sourceRepo.repo],
    author: sourceRepo.owner,
    manifestUrl,
  };
}

async function listGitHubSkillFiles(
  source: BuiltinRegistrySource,
  query: string,
): Promise<DiscoveredGitHubSkillFile[]> {
  if (source.directSkillFiles) {
    return source.directSkillFiles.map((file) => ({
      name: file.path.split('/').pop() ?? 'SKILL.md',
      path: file.path,
      type: 'file',
      download_url: file.downloadUrl,
    }));
  }

  if (!source.repo) {
    return [];
  }

  if (source.repo.discoveryMode === 'code-search') {
    const perPage = Math.min(source.repo.browseLimit ?? 100, 100);
    const rootPaths = source.repo.rootPaths.map(normalizeGitHubRepoPath);
    const searchSets = rootPaths.length > 0 ? rootPaths : [''];
    const responses = await Promise.all(
      searchSets.map(async (rootPath) => {
        const searchTerms = [
          `repo:${source.repo?.owner}/${source.repo?.repo}`,
          'filename:SKILL.md',
          ...(rootPath ? [`path:${rootPath}`] : []),
          ...(query ? [query] : []),
        ];
        const searchUrl = `https://api.github.com/search/code?q=${encodeURIComponent(searchTerms.join(' '))}&per_page=${perPage}`;
        const res = await fetchWithTimeout(searchUrl, {
          headers: { Accept: 'application/vnd.github+json' },
        }).catch(() => undefined);
        if (!res?.ok) {
          return [];
        }

        const payload = (await res.json()) as GitHubCodeSearchResponse;
        return (payload.items ?? []).flatMap((item) => {
          if (!source.repo || !isGitHubSkillPathWithinBounds(item.path, source.repo)) {
            return [];
          }
          const downloadUrl = buildGitHubRawUrl(source, item.path);
          if (!downloadUrl) {
            return [];
          }
          return [
            {
              name: item.path.split('/').pop() ?? 'SKILL.md',
              path: item.path,
              type: 'file',
              download_url: downloadUrl,
            },
          ];
        });
      }),
    );

    return dedupeGitHubSkillFiles(responses.flat());
  }

  const queue = source.repo.rootPaths.map((path) => ({ path, depth: 0 }));
  const files: DiscoveredGitHubSkillFile[] = [];
  let directoryRequests = 0;

  while (
    queue.length > 0 &&
    directoryRequests < GITHUB_SOURCE_MAX_DIRECTORY_REQUESTS &&
    files.length < GITHUB_SOURCE_MAX_SKILL_FILES
  ) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    directoryRequests += 1;
    const normalizedPath = current.path.replace(/^\/+/, '');
    const pathSegment = normalizedPath ? `/${normalizedPath}` : '';
    const refQuery = source.repo.ref ? `?ref=${encodeURIComponent(source.repo.ref)}` : '';
    const apiUrl = `https://api.github.com/repos/${source.repo.owner}/${source.repo.repo}/contents${pathSegment}${refQuery}`;
    const res = await fetchWithTimeout(apiUrl, {
      headers: { Accept: 'application/vnd.github+json' },
    }).catch(() => undefined);
    if (!res?.ok) {
      continue;
    }

    const payload = (await res.json()) as GitHubDirEntry | GitHubDirEntry[];
    const entries = Array.isArray(payload) ? payload : [payload];
    for (const entry of entries) {
      if (entry.type === 'file' && isSkillMarkdownFileName(entry.name) && entry.download_url) {
        files.push({ ...entry, download_url: entry.download_url });
        if (files.length >= GITHUB_SOURCE_MAX_SKILL_FILES) {
          break;
        }
        continue;
      }
      if (entry.type === 'dir' && current.depth < source.repo.maxDepth) {
        queue.push({ path: entry.path, depth: current.depth + 1 });
      }
    }
  }

  return files;
}

export async function fetchGitHubSkills(
  sources: ReadonlyArray<BuiltinRegistrySource>,
  query?: string,
  category?: string,
): Promise<SkillEntry[]> {
  if (category && category !== 'other') {
    return [];
  }

  const normalizedQuery = query?.trim().toLowerCase() ?? '';
  const githubSources = sources.filter((source) => source.repo && source.enabled);
  const sourceResults = await Promise.all(
    githubSources.map(async (source) => {
      const cacheKey = buildGitHubSourceCacheKey(source, normalizedQuery);
      const cached = githubSourceCache.get(cacheKey);
      const isQueryScoped = source.repo?.discoveryMode === 'code-search';
      if (cached && isGitHubCacheFresh(cached)) {
        return isQueryScoped
          ? cached.items
          : cached.items.filter((item) => matchesGitHubSkillQuery(item, normalizedQuery));
      }

      try {
        const skillFiles = applyGitHubBrowseLimit(
          await listGitHubSkillFiles(source, normalizedQuery),
          source,
          normalizedQuery,
        );
        const builtItems = (
          await Promise.all(
            skillFiles.map((file) => {
              if (source.repo?.metadataMode === 'path') {
                return Promise.resolve(buildGitHubPathSkillEntry(source, file));
              }
              return buildGitHubFrontmatterSkillEntry(source, file);
            }),
          )
        ).filter((item): item is SkillEntry => item !== undefined);

        const visibleItems = builtItems.filter((item) =>
          matchesGitHubSkillQuery(item, normalizedQuery),
        );
        githubSourceCache.set(cacheKey, {
          fetchedAt: Date.now(),
          items: isQueryScoped ? visibleItems : builtItems,
        });
        return visibleItems;
      } catch {
        if (cached && isGitHubCacheUsableOnError(cached)) {
          return isQueryScoped
            ? cached.items
            : cached.items.filter((item) => matchesGitHubSkillQuery(item, normalizedQuery));
        }
        return [];
      }
    }),
  );

  return sourceResults.flat();
}

function builtinsToSkillEntries(): SkillEntry[] {
  return BUILTIN_SKILLS.map(({ manifest }) => ({
    id: manifest.id,
    name: manifest.name,
    displayName: manifest.displayName,
    version: manifest.version,
    description: manifest.description,
    category: 'other' as const,
    sourceId: 'builtin',
    tags: manifest.capabilities,
    author: 'OpenAWork',
    manifest,
  }));
}

function createRegistryClient(userId: string): SkillRegistryClientImpl {
  const userRows = getUserRegistrySourceRows(userId, true);
  const userSources: RegistrySource[] = userRows
    .filter((row) => !isReadonlySourceId(row.id))
    .map(rowToClientSource);
  const sourceManager = new RegistrySourceManager(userSources);
  return new SkillRegistryClientImpl(sourceManager);
}

export async function skillsRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/skills/installed',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'skills.installed.list');
      const user = request.user as JwtPayload;
      const rows = sqliteAll<InstalledSkillRow>(
        'SELECT * FROM installed_skills WHERE user_id = ? ORDER BY updated_at DESC',
        [user.sub],
      );
      step.succeed(undefined, { count: rows.length });
      return reply.send({ skills: rows.map(rowToInstalledSkill) });
    },
  );

  app.post(
    '/skills/install',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'skills.install');
      const user = request.user as JwtPayload;
      const body = request.body as { skillId?: string; sourceId?: string; manifestUrl?: string };

      if (!body.skillId) {
        step.fail('missing skillId');
        return reply.status(400).send({ error: 'skillId is required' });
      }

      const client = createRegistryClient(user.sub);

      try {
        const record = await client.install(body.skillId, {
          sourceId: body.sourceId,
          skipSignatureVerification: true,
        });

        const now = Date.now();
        sqliteRun(
          `INSERT INTO installed_skills (skill_id, user_id, source_id, manifest_json, granted_permissions_json, enabled, installed_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 1, ?, ?)
           ON CONFLICT(skill_id, user_id) DO UPDATE SET
             source_id = excluded.source_id,
             manifest_json = excluded.manifest_json,
             granted_permissions_json = excluded.granted_permissions_json,
             updated_at = excluded.updated_at`,
          [
            record.skillId,
            user.sub,
            record.sourceId,
            JSON.stringify(record.manifest),
            JSON.stringify(record.grantedPermissions),
            now,
            now,
          ],
        );

        step.succeed(undefined, { skillId: record.skillId });
        return reply.status(201).send(
          rowToInstalledSkill({
            skill_id: record.skillId,
            source_id: record.sourceId,
            manifest_json: JSON.stringify(record.manifest),
            granted_permissions_json: JSON.stringify(record.grantedPermissions),
            enabled: 1,
            installed_at: now,
            updated_at: now,
          }),
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        step.fail(message);
        return reply.status(422).send({ error: message });
      }
    },
  );

  app.delete(
    '/skills/installed/:skillId',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'skills.uninstall');
      const user = request.user as JwtPayload;
      const { skillId } = request.params as { skillId: string };

      const existing = sqliteGet<InstalledSkillRow>(
        'SELECT skill_id FROM installed_skills WHERE skill_id = ? AND user_id = ?',
        [skillId, user.sub],
      );

      if (!existing) {
        step.fail('not found');
        return reply.status(404).send({ error: `Skill not installed: ${skillId}` });
      }

      sqliteRun('DELETE FROM installed_skills WHERE skill_id = ? AND user_id = ?', [
        skillId,
        user.sub,
      ]);

      step.succeed(undefined, { skillId });
      return reply.send({ removed: true, skillId });
    },
  );

  app.patch(
    '/skills/installed/:skillId',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'skills.toggle');
      const user = request.user as JwtPayload;
      const { skillId } = request.params as { skillId: string };
      const body = request.body as { enabled?: boolean };

      const existing = sqliteGet<InstalledSkillRow>(
        'SELECT * FROM installed_skills WHERE skill_id = ? AND user_id = ?',
        [skillId, user.sub],
      );

      if (!existing) {
        step.fail('not found');
        return reply.status(404).send({ error: `Skill not installed: ${skillId}` });
      }

      const enabled = body.enabled ?? existing.enabled === 1;
      sqliteRun(
        'UPDATE installed_skills SET enabled = ?, updated_at = ? WHERE skill_id = ? AND user_id = ?',
        [enabled ? 1 : 0, Date.now(), skillId, user.sub],
      );

      step.succeed(undefined, { skillId, enabled });
      return reply.send({ ...rowToInstalledSkill(existing), enabled });
    },
  );

  app.get(
    '/skills/search',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'skills.search');
      const user = request.user as JwtPayload;
      const query = request.query as {
        q?: string;
        category?: string;
        limit?: string;
        offset?: string;
      };

      const client = createRegistryClient(user.sub);
      const limit = query.limit ? Number(query.limit) : 20;
      const offset = query.offset ? Number(query.offset) : 0;

      const [cachedUserSourceResults, officialResults, githubSkills] = await Promise.all([
        Promise.resolve(listCachedRegistrySourceSkills(user.sub, query.q, query.category)),
        client
          .search({
            query: query.q,
            category: query.category as never,
            sourceIds: [OFFICIAL_REGISTRY_SOURCE.id],
          })
          .catch((): SkillEntry[] => []),
        fetchGitHubSkills(
          BUILTIN_REGISTRY_SOURCES,
          (query.q ?? '').toLowerCase(),
          query.category,
        ).catch((): SkillEntry[] => []),
      ]);

      const remoteResults = dedupeSkillEntries([...officialResults, ...cachedUserSourceResults]);
      const builtins = builtinsToSkillEntries();
      const combined = dedupeSkillEntries([...remoteResults, ...githubSkills, ...builtins]);
      const filtered = filterSkillEntries(combined, query.q, query.category);
      const total = filtered.length;
      const paginated = filtered.slice(offset, offset + limit);
      const cacheMeta = {
        sources: getUserRegistrySourceRows(user.sub)
          .filter((row) => !isReadonlySourceId(row.id))
          .map((row) => rowToSource(row)),
      };

      step.succeed(undefined, {
        count: paginated.length,
        total,
        cachedSources: cacheMeta.sources.length,
      });
      return reply.send({ skills: paginated, total, cacheMeta });
    },
  );

  app.get(
    '/skills/registry-sources',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'skills.registry-source.list');
      const user = request.user as JwtPayload;
      const queryStep = child('query');
      const rows = sqliteAll<RegistrySourceRow>(
        'SELECT * FROM registry_sources WHERE user_id = ? ORDER BY priority ASC',
        [user.sub],
      );
      queryStep.succeed(undefined, { count: rows.length });
      step.succeed(undefined, { count: rows.length });
      return reply.send({ sources: buildRegistrySources(rows) });
    },
  );

  app.post(
    '/skills/registry-sources/sync',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'skills.registry-source.sync');
      const user = request.user as JwtPayload;
      const body = request.body as { sourceIds?: string[] } | undefined;
      const sourceIds = body?.sourceIds;
      const resolveStep = child('resolve-sources');
      const sources = getUserRegistrySourceRows(user.sub, true)
        .filter((row) => !isReadonlySourceId(row.id))
        .filter((row) => (sourceIds && sourceIds.length > 0 ? sourceIds.includes(row.id) : true))
        .map((row) => rowToClientSource(row));
      resolveStep.succeed(undefined, { sourceCount: sources.length });

      const syncStep = child('sync', undefined, { sourceCount: sources.length });
      const syncResults = await Promise.all(
        sources.map((source) => syncRegistrySourceCacheForUser(user.sub, source)),
      );
      const fallbackSummary = summarizeFallbackSyncResults(sources, syncResults);
      syncStep.succeed(
        fallbackSummary.fallbackSources > 0 ? 'completed with cache fallback' : undefined,
        {
          sourceCount: sources.length,
          ...fallbackSummary,
        },
      );

      const queryStep = child('query-updated');
      const refreshedRows = getUserRegistrySourceRows(user.sub)
        .filter((row) => !isReadonlySourceId(row.id))
        .filter((row) => (sourceIds && sourceIds.length > 0 ? sourceIds.includes(row.id) : true));
      queryStep.succeed(undefined, { count: refreshedRows.length });
      step.succeed(undefined, {
        sourceCount: refreshedRows.length,
        ...fallbackSummary,
      });
      return reply.send({ sources: refreshedRows.map((row) => rowToSource(row)) });
    },
  );

  app.post(
    '/skills/registry-sources',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'skills.registry-source.upsert');
      const user = request.user as JwtPayload;
      const body = request.body as {
        id?: string;
        name: string;
        url: string;
        type?: string;
        trust?: string;
        priority?: number;
      };

      if (!body.name || !body.url) {
        step.fail('name and url are required');
        return reply.status(400).send({ error: 'name and url are required' });
      }

      const id = body.id ?? `src-${Date.now()}`;
      if (isReadonlySourceId(id)) {
        step.fail('built-in registry source id is reserved');
        return reply
          .status(409)
          .send({ error: 'Registry source id is reserved by a built-in source' });
      }

      const upsertStep = child('upsert', undefined, { sourceId: id });
      sqliteRun(
        `INSERT INTO registry_sources (id, user_id, name, url, type, trust, enabled, priority, cached_skill_count)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, 0)
         ON CONFLICT(id, user_id) DO UPDATE SET
            name = excluded.name, url = excluded.url, type = excluded.type,
            trust = excluded.trust, priority = excluded.priority`,
        [
          id,
          user.sub,
          body.name,
          body.url,
          body.type ?? 'community',
          body.trust ?? 'untrusted',
          body.priority ?? 10,
        ],
      );
      upsertStep.succeed();

      const reloadStep = child('reload', undefined, { sourceId: id });
      const created = sqliteGet<RegistrySourceRow>(
        'SELECT * FROM registry_sources WHERE id = ? AND user_id = ?',
        [id, user.sub],
      );
      if (!created) {
        reloadStep.fail('created source could not be reloaded');
        step.fail('created source could not be reloaded');
        return reply
          .status(500)
          .send({ error: 'Registry source created but could not be reloaded' });
      }
      reloadStep.succeed();

      const syncStep = child('sync', undefined, { sourceId: id });
      const syncResult = await syncRegistrySourceCacheForUser(user.sub, rowToClientSource(created));
      syncStep.succeed(syncResult.fallbackToCache ? 'completed with cache fallback' : undefined, {
        fallbackToCache: syncResult.fallbackToCache,
        ...(syncResult.errorMessage ? { errorMessage: syncResult.errorMessage } : {}),
        ...(syncResult.fallbackToCache ? { fallbackSourceIds: id } : {}),
      });

      const queryStep = child('query-updated', undefined, { sourceId: id });
      const synced = sqliteGet<RegistrySourceRow>(
        'SELECT * FROM registry_sources WHERE id = ? AND user_id = ?',
        [id, user.sub],
      );
      queryStep.succeed(undefined, { found: synced !== undefined });
      step.succeed(undefined, {
        sourceId: id,
        synced: synced !== undefined,
        fallbackToCache: syncResult.fallbackToCache,
        ...(syncResult.errorMessage ? { errorMessage: syncResult.errorMessage } : {}),
        ...(syncResult.fallbackToCache ? { fallbackSourceIds: id } : {}),
      });
      return reply
        .status(201)
        .send({ source: synced ? rowToSource(synced) : rowToSource(created) });
    },
  );

  app.delete(
    '/skills/registry-sources/:sourceId',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { sourceId } = request.params as { sourceId: string };
      const { step } = startRequestWorkflow(request, 'skills.registry-source.delete', undefined, {
        sourceId,
      });
      const user = request.user as JwtPayload;
      if (isReadonlySourceId(sourceId)) {
        step.fail('built-in registry source cannot be removed');
        return reply.status(403).send({ error: 'Built-in registry source cannot be removed' });
      }
      sqliteRun('DELETE FROM registry_source_skill_cache WHERE source_id = ? AND user_id = ?', [
        sourceId,
        user.sub,
      ]);
      sqliteRun('DELETE FROM registry_sources WHERE id = ? AND user_id = ?', [sourceId, user.sub]);
      step.succeed(undefined, { sourceId });
      return reply.send({ removed: true, sourceId });
    },
  );

  app.patch(
    '/skills/registry-sources/:sourceId',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { sourceId } = request.params as { sourceId: string };
      const { step, child } = startRequestWorkflow(
        request,
        'skills.registry-source.toggle',
        undefined,
        {
          sourceId,
        },
      );
      const user = request.user as JwtPayload;
      const body = request.body as { enabled?: boolean };

      if (isReadonlySourceId(sourceId)) {
        step.fail('built-in registry source cannot be toggled');
        return reply.status(403).send({ error: 'Built-in registry source cannot be toggled' });
      }
      if (typeof body.enabled !== 'boolean') {
        step.fail('enabled is required');
        return reply.status(400).send({ error: 'enabled is required' });
      }

      const updateStep = child('update', undefined, { enabled: body.enabled });
      sqliteRun('UPDATE registry_sources SET enabled = ? WHERE id = ? AND user_id = ?', [
        body.enabled ? 1 : 0,
        sourceId,
        user.sub,
      ]);
      updateStep.succeed();

      if (body.enabled) {
        const syncStep = child('sync', undefined, { enabled: body.enabled });
        const sourceRow = sqliteGet<RegistrySourceRow>(
          'SELECT * FROM registry_sources WHERE id = ? AND user_id = ?',
          [sourceId, user.sub],
        );
        if (sourceRow) {
          const syncResult = await syncRegistrySourceCacheForUser(
            user.sub,
            rowToClientSource(sourceRow),
          );
          syncStep.succeed(
            syncResult.fallbackToCache ? 'completed with cache fallback' : undefined,
            {
              found: true,
              fallbackToCache: syncResult.fallbackToCache,
              ...(syncResult.errorMessage ? { errorMessage: syncResult.errorMessage } : {}),
              ...(syncResult.fallbackToCache ? { fallbackSourceIds: sourceId } : {}),
            },
          );
        } else {
          syncStep.succeed(undefined, { found: false, fallbackToCache: false });
        }
      }

      const queryStep = child('query-updated');
      const updated = sqliteGet<RegistrySourceRow>(
        'SELECT * FROM registry_sources WHERE id = ? AND user_id = ?',
        [sourceId, user.sub],
      );
      if (!updated) {
        queryStep.fail('registry source not found');
        step.fail('registry source not found');
        return reply.status(404).send({ error: 'Registry source not found' });
      }
      queryStep.succeed(undefined, { enabled: updated.enabled === 1 });

      step.succeed(undefined, { sourceId, enabled: updated.enabled === 1 });
      return reply.send(rowToSource(updated));
    },
  );

  app.get(
    '/skills/:skillId',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'skills.detail');
      const user = request.user as JwtPayload;
      const { skillId } = request.params as { skillId: string };

      const builtinEntry = builtinsToSkillEntries().find((e) => e.id === skillId);
      if (builtinEntry) {
        const manifest = builtinEntry.manifest as
          | { readme?: string; license?: string; permissions?: Array<{ id: string }> }
          | undefined;
        step.succeed(undefined, { source: 'builtin' });
        return reply.send({
          ...builtinEntry,
          readme: manifest?.readme ?? '',
          license: manifest?.license ?? 'MIT',
          permissions: (manifest?.permissions ?? []).map((p) => p.id),
          downloads: 0,
          verified: true,
        });
      }

      const cachedRows = sqliteAll<RegistrySourceSkillCacheRow>(
        `SELECT entry_json FROM registry_source_skill_cache
           WHERE user_id = ? AND skill_id = ? LIMIT 1`,
        [user.sub, skillId],
      );
      if (cachedRows.length > 0 && cachedRows[0]) {
        const entry = parseCachedSkillEntry(cachedRows[0]);
        if (entry.manifestUrl) {
          try {
            const mdRes = await fetchWithTimeout(entry.manifestUrl, {});
            if (mdRes.ok) {
              const text = await mdRes.text();
              const fm = parseSkillFrontmatter(text);
              step.succeed(undefined, { source: 'cache+fetch' });
              return reply.send({
                ...entry,
                readme: text,
                license: fm.license ?? '',
                permissions: [],
                downloads: 0,
                verified: false,
              });
            }
          } catch {
            step.succeed(undefined, { source: 'cache' });
          }
        }
        step.succeed(undefined, { source: 'cache' });
        return reply.send({
          ...entry,
          readme: '',
          license: '',
          permissions: [],
          downloads: 0,
          verified: false,
        });
      }

      const githubSources = BUILTIN_REGISTRY_SOURCES.filter((s) => s.repo && s.enabled);
      for (const source of githubSources) {
        if (!skillId.startsWith(source.id)) continue;
        const relPath = skillId.slice(source.id.length + 1);
        const rawUrl = source.repo?.ref
          ? `https://raw.githubusercontent.com/${source.repo.owner}/${source.repo.repo}/${source.repo.ref}/${relPath}/SKILL.md`
          : undefined;
        if (!rawUrl) continue;
        try {
          const mdRes = await fetchWithTimeout(rawUrl, {});
          if (mdRes.ok) {
            const text = await mdRes.text();
            const fm = parseSkillFrontmatter(text);
            step.succeed(undefined, { source: 'github' });
            return reply.send({
              id: skillId,
              name: fm.name ?? relPath,
              displayName: fm.name ?? relPath,
              version: '1.0.0',
              description: fm.description ?? '',
              category: 'other',
              sourceId: source.id,
              tags: [source.repo?.owner ?? '', source.repo?.repo ?? ''],
              author: source.repo?.owner ?? '',
              readme: text,
              license: fm.license ?? '',
              permissions: [],
              downloads: 0,
              verified: false,
            });
          }
        } catch {
          step.succeed(undefined, { source: 'github-fetch-error' });
        }
      }

      step.fail('not found');
      return reply.status(404).send({ error: `Skill not found: ${skillId}` });
    },
  );
}
