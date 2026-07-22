import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { WORKSPACE_ROOT, WORKSPACE_ROOTS } from '../infra/db.js';
import { resolveGatewayDataDir } from '../infra/storage-paths.js';
import {
  assertWorkspacePathSupportedByCurrentHost,
  isPathWithinRoot,
} from '../workspace/workspace-paths.js';
import { getSessionWorkingDirectory } from '../workspace/workspace-safety.js';

function isRepositoryWorkspaceRoot(rootPath: string): boolean {
  return existsSync(join(rootPath, 'pnpm-workspace.yaml')) || existsSync(join(rootPath, '.git'));
}

function resolveWorkspaceRootForWorkingDirectory(workingDirectory: string): string {
  const matchedRoot = [...WORKSPACE_ROOTS]
    .sort((left, right) => right.length - left.length)
    .find((rootPath) => isPathWithinRoot(workingDirectory, rootPath));

  return matchedRoot ?? workingDirectory;
}

export function resolveTaskGraphProjectRoot(sessionId: string): string {
  const sessionWorkingDirectory = getSessionWorkingDirectory(sessionId);
  if (sessionWorkingDirectory) {
    try {
      assertWorkspacePathSupportedByCurrentHost(sessionWorkingDirectory);
      return resolveWorkspaceRootForWorkingDirectory(sessionWorkingDirectory);
    } catch {
      return resolveGatewayDataDir();
    }
  }

  if (isRepositoryWorkspaceRoot(WORKSPACE_ROOT)) {
    return WORKSPACE_ROOT;
  }

  return resolveGatewayDataDir();
}
