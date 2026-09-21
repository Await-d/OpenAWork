import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { WORKSPACE_ROOT, WORKSPACE_ROOTS } from '../infra/db.js';
import {
  assertWorkspacePathSupportedByCurrentHost,
  isPathWithinRoot,
} from '../workspace/workspace-paths.js';
import {
  ensureUnboundSessionWorkspaceDirectory,
  getSessionWorkingDirectory,
} from '../workspace/workspace-safety.js';

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
    // 已绑定工作区：只用会话自身路径，主机不兼容时直接抛错，不允许回退。
    assertWorkspacePathSupportedByCurrentHost(sessionWorkingDirectory);
    return resolveWorkspaceRootForWorkingDirectory(sessionWorkingDirectory);
  }

  // 未绑定工作区：回退到当前主机系统文档目录（或看起来像仓库的全局根）。
  if (isRepositoryWorkspaceRoot(WORKSPACE_ROOT)) {
    return WORKSPACE_ROOT;
  }

  return ensureUnboundSessionWorkspaceDirectory();
}
