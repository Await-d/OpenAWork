import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { SkillInstaller } from '@openAwork/skill-registry';
import type { InstalledSkillRecord } from '@openAwork/skill-registry';
import { WORKSPACE_ROOTS } from './db.js';
import { validateWorkspacePath } from './workspace-paths.js';

export const LOCAL_WORKSPACE_SOURCE_ID = 'local-workspace';

const SKILL_MANIFEST_NAME = 'skill.yaml';
const MAX_SCAN_DEPTH = 6;
const MAX_DISCOVERED_SKILLS = 200;
const IGNORED_DIRECTORY_NAMES = new Set([
  '.agentdocs',
  '.git',
  '.next',
  '.turbo',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
]);

export interface LocalDiscoveredSkill {
  id: string;
  name: string;
  displayName: string;
  version: string;
  description: string;
  category: 'other';
  sourceId: typeof LOCAL_WORKSPACE_SOURCE_ID;
  tags: string[];
  author?: string;
  verified: false;
  downloads: 0;
  dirPath: string;
  manifestPath: string;
  workspaceRelativePath: string;
  installed: boolean;
}

function createLocalSkillInstaller(): SkillInstaller {
  return new SkillInstaller({
    localFileReader: async (path) => readFile(path, 'utf8'),
  });
}

async function readInstalledSkillRecord(manifestPath: string): Promise<InstalledSkillRecord> {
  return createLocalSkillInstaller().installFromLocal(manifestPath, {
    sourceId: LOCAL_WORKSPACE_SOURCE_ID,
    allowUntrusted: true,
    skipSignatureVerification: true,
  });
}

async function resolveWorkspaceRealPath(path: string): Promise<string | null> {
  const validatedPath = validateWorkspacePath(path);
  if (!validatedPath) {
    return null;
  }

  const realPath = await realpath(validatedPath).catch(() => validatedPath);
  return validateWorkspacePath(realPath);
}

async function scanWorkspaceRoot(
  rootPath: string,
  installedSkillIds: ReadonlySet<string>,
): Promise<LocalDiscoveredSkill[]> {
  const discovered: LocalDiscoveredSkill[] = [];
  const queue: Array<{ dirPath: string; depth: number }> = [{ dirPath: rootPath, depth: 0 }];

  while (queue.length > 0 && discovered.length < MAX_DISCOVERED_SKILLS) {
    const current = queue.shift();
    if (!current) continue;

    const entries = await readdir(current.dirPath, { withFileTypes: true }).catch(() => []);
    const manifestEntry = entries.find(
      (entry) => entry.isFile() && entry.name === SKILL_MANIFEST_NAME,
    );
    if (manifestEntry) {
      const manifestPath = join(current.dirPath, manifestEntry.name);
      const record = await readInstalledSkillRecord(manifestPath).catch(() => null);
      if (record) {
        const { manifest } = record;
        const workspaceRelativePath = relative(rootPath, current.dirPath) || '.';
        discovered.push({
          id: manifest.id,
          name: manifest.name,
          displayName: manifest.displayName,
          version: manifest.version,
          description: manifest.description,
          category: 'other',
          sourceId: LOCAL_WORKSPACE_SOURCE_ID,
          tags: manifest.capabilities,
          author: manifest.author,
          verified: false,
          downloads: 0,
          dirPath: current.dirPath,
          manifestPath,
          workspaceRelativePath,
          installed: installedSkillIds.has(manifest.id),
        });
      }
      continue;
    }

    if (current.depth >= MAX_SCAN_DEPTH) continue;
    for (const entry of entries) {
      if (
        !entry.isDirectory() ||
        entry.isSymbolicLink() ||
        IGNORED_DIRECTORY_NAMES.has(entry.name)
      ) {
        continue;
      }
      queue.push({ dirPath: join(current.dirPath, entry.name), depth: current.depth + 1 });
    }
  }

  return discovered;
}

export async function discoverLocalSkills(
  installedSkillIds: ReadonlySet<string>,
): Promise<LocalDiscoveredSkill[]> {
  const roots = Array.from(new Set(WORKSPACE_ROOTS.map((root) => resolve(root))));
  const discoveredGroups = await Promise.all(
    roots.map(async (rootPath) => scanWorkspaceRoot(rootPath, installedSkillIds)),
  );
  return discoveredGroups.flat().sort((left, right) => left.dirPath.localeCompare(right.dirPath));
}

export async function installLocalSkillFromDir(dirPath: string): Promise<InstalledSkillRecord> {
  const resolvedDirPath = await resolveWorkspaceRealPath(dirPath);
  if (!resolvedDirPath) {
    throw new Error('Local skill path must stay within the configured workspace roots');
  }

  const manifestPath = join(resolvedDirPath, SKILL_MANIFEST_NAME);
  const manifestStat = await lstat(manifestPath).catch(() => null);
  if (!manifestStat?.isFile()) {
    throw new Error(`skill.yaml not found under ${resolvedDirPath}`);
  }

  return readInstalledSkillRecord(manifestPath);
}
