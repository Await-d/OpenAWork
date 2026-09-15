import { realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { parse as parsePath, resolve } from 'node:path';
import { createPlatformAdapter, resolveSkillsPaths } from '@openAwork/platform-adapter';
import { resourcePath } from '@openAwork/resources/node';
import { resolveGatewayDataDir } from '../infra/storage-paths.js';
import { isPathWithinRoot, isSamePath } from './workspace-paths.js';

/**
 * App-owned skill resource roots.
 *
 * Read-only workspace tools may read bundled skill assets (for example the
 * `templates/viewer.html` referenced by a SKILL.md) even when the session
 * workspace lives elsewhere. Writes and mutations never consult this module,
 * so skill resources stay read-only.
 *
 * Roots are discovered fail-closed: every candidate must realpath to an
 * existing directory and must not collapse into a filesystem root, the user
 * home directory, or the gateway data directory (or one of its ancestors).
 */

let cachedRoots: readonly string[] | null = null;

function realDirectory(path: string): string | null {
  try {
    const realPath = realpathSync(path);
    return statSync(realPath).isDirectory() ? realPath : null;
  } catch {
    return null;
  }
}

function bestEffortRealPath(path: string): string {
  return realDirectory(path) ?? resolve(path);
}

function isForbiddenSkillRoot(candidate: string): boolean {
  if (parsePath(candidate).root === candidate) {
    return true;
  }

  if (isSamePath(candidate, bestEffortRealPath(homedir()))) {
    return true;
  }

  const dataDir = bestEffortRealPath(resolveGatewayDataDir());
  return isSamePath(candidate, dataDir) || isPathWithinRoot(dataDir, candidate);
}

function candidateSkillRoots(): readonly string[] {
  const bundledSkillsDir = resourcePath('skills');
  const platformSkillsPaths = resolveSkillsPaths(createPlatformAdapter().getPlatform()).skillsPaths;
  return [bundledSkillsDir, ...platformSkillsPaths];
}

export function getSkillResourceRoots(): readonly string[] {
  if (cachedRoots) {
    return cachedRoots;
  }

  const roots: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidateSkillRoots()) {
    const realCandidate = realDirectory(candidate);
    if (!realCandidate || isForbiddenSkillRoot(realCandidate)) {
      continue;
    }
    const dedupeKey = process.platform === 'win32' ? realCandidate.toLowerCase() : realCandidate;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    roots.push(realCandidate);
  }

  cachedRoots = roots;
  return roots;
}

export function isPathWithinSkillResources(path: string): boolean {
  let realTarget: string;
  try {
    realTarget = realpathSync(path);
  } catch {
    return false;
  }

  return getSkillResourceRoots().some((root) => isPathWithinRoot(realTarget, root));
}
