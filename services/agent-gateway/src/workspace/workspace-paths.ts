import { posix, win32 } from 'node:path';
import { WORKSPACE_ACCESS_RESTRICTED, WORKSPACE_ROOTS } from '../infra/db.js';

type PathFlavor = typeof posix;

const WINDOWS_ABSOLUTE_PATH_PATTERN = /^(?:[A-Za-z]:[\\/]|\\\\)/;

function pathFlavorFor(...paths: string[]): PathFlavor {
  return paths.some((path) => WINDOWS_ABSOLUTE_PATH_PATTERN.test(path)) ? win32 : posix;
}

function normalizeForComparison(path: string, flavor: PathFlavor): string {
  const resolvedPath = flavor.resolve(path);
  return flavor === win32 ? resolvedPath.toLowerCase() : resolvedPath;
}

function resolveWorkspacePath(path: string): string {
  return pathFlavorFor(path).resolve(path);
}

export const WORKSPACE_ROOT_PATHS = WORKSPACE_ROOTS.map((root) => resolveWorkspacePath(root));

export function isPathWithinRoot(path: string, rootPath: string): boolean {
  const flavor = pathFlavorFor(path, rootPath);
  const normalizedPath = normalizeForComparison(path, flavor);
  const normalizedRootPath = normalizeForComparison(rootPath, flavor);
  const rootAnchor = normalizeForComparison(flavor.parse(normalizedRootPath).root, flavor);

  if (normalizedRootPath === rootAnchor) {
    return normalizedPath.startsWith(rootAnchor);
  }

  return (
    normalizedPath === normalizedRootPath ||
    normalizedPath.startsWith(`${normalizedRootPath}${flavor.sep}`)
  );
}

export function validateWorkspacePath(path: string): string | null {
  const flavor = pathFlavorFor(path);
  if (!flavor.isAbsolute(path)) {
    return null;
  }

  const resolvedPath = flavor.resolve(path);

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
  const flavor = pathFlavorFor(rootPath);
  const normalizedRootPath = flavor.resolve(rootPath);
  const resolvedPath = flavor.resolve(flavor.join(normalizedRootPath, filePath));
  if (!isPathWithinRoot(resolvedPath, normalizedRootPath)) {
    return null;
  }

  return flavor.relative(normalizedRootPath, resolvedPath).replaceAll(flavor.sep, '/');
}
