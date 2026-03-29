import { isAbsolute, join, resolve } from 'node:path';
import { WORKSPACE_ACCESS_RESTRICTED, WORKSPACE_ROOTS } from './db.js';

export const WORKSPACE_ROOT_PATHS = WORKSPACE_ROOTS.map((root) => resolve(root));

export function isPathWithinRoot(path: string, rootPath: string): boolean {
  const normalizedRootPath = resolve(rootPath);

  if (normalizedRootPath === '/') {
    return path.startsWith('/');
  }

  return path === normalizedRootPath || path.startsWith(`${normalizedRootPath}/`);
}

export function validateWorkspacePath(path: string): string | null {
  if (!isAbsolute(path)) {
    return null;
  }

  const resolvedPath = resolve(path);

  if (!WORKSPACE_ACCESS_RESTRICTED) {
    return resolvedPath;
  }

  const matchedRootPath = WORKSPACE_ROOT_PATHS.find((rootPath) =>
    isPathWithinRoot(resolvedPath, rootPath),
  );

  if (!matchedRootPath) {
    return null;
  }

  return resolvedPath;
}

export function validateWorkspaceRelativePath(rootPath: string, filePath: string): string | null {
  const normalizedRootPath = resolve(rootPath);
  const resolvedPath = resolve(join(normalizedRootPath, filePath));
  if (!isPathWithinRoot(resolvedPath, normalizedRootPath)) {
    return null;
  }

  return resolvedPath.slice(normalizedRootPath.length).replace(/^\//, '');
}
