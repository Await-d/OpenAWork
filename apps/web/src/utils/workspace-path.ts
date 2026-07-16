const WINDOWS_ABSOLUTE_PATH_PATTERN = /^(?:[A-Za-z]:[\\/]|\\\\)/;

function isWindowsPath(path: string): boolean {
  return WINDOWS_ABSOLUTE_PATH_PATTERN.test(path);
}

function normalizeSeparators(path: string, windows: boolean): string {
  return windows ? path.replaceAll('/', '\\') : path;
}

function collapseRepeatedSeparators(path: string, windows: boolean): string {
  if (!windows) {
    return path.replace(/\/{2,}/g, '/');
  }

  if (path.startsWith('\\\\')) {
    return `\\\\${path.slice(2).replace(/[\\/]+/g, '\\')}`;
  }

  return path.replace(/[\\/]+/g, '\\');
}

function getRootPath(path: string, windows: boolean): string {
  if (!windows) {
    return '/';
  }

  const normalized = collapseRepeatedSeparators(normalizeSeparators(path, true), true);
  const driveMatch = normalized.match(/^([A-Za-z]:)\\/);
  if (driveMatch) {
    return `${driveMatch[1]}\\`;
  }

  const uncMatch = normalized.match(/^\\\\[^\\]+\\[^\\]+\\/);
  if (uncMatch) {
    return uncMatch[0];
  }

  return '\\\\';
}

function trimTrailingSeparators(path: string, windows: boolean): string {
  const normalized = collapseRepeatedSeparators(normalizeSeparators(path, windows), windows);
  const rootPath = getRootPath(normalized, windows);
  const trimmed = normalized.replace(windows ? /[\\/]+$/g : /\/+$/g, '');

  if (trimmed.length < rootPath.length) {
    return rootPath;
  }

  return trimmed || rootPath;
}

function normalizeForComparison(path: string): string {
  const windows = isWindowsPath(path);
  const normalized = trimTrailingSeparators(path, windows);
  return windows ? normalized.toLowerCase() : normalized;
}

export function getPathBasename(path: string | null | undefined, fallback: string = ''): string {
  const trimmed = path?.trim();
  if (!trimmed) {
    return fallback;
  }

  const windows = isWindowsPath(trimmed);
  const normalized = trimTrailingSeparators(trimmed, windows);
  const rootPath = trimTrailingSeparators(getRootPath(normalized, windows), windows);
  if (normalizeForComparison(normalized) === normalizeForComparison(rootPath)) {
    return normalized;
  }

  const separator = windows ? '\\' : '/';
  const segments = normalized.split(separator).filter((segment) => segment.length > 0);
  return segments.at(-1) ?? normalized;
}

export function isPathWithinRoot(path: string, rootPath: string): boolean {
  const windows = isWindowsPath(path) || isWindowsPath(rootPath);
  const normalizedPath = normalizeForComparison(path);
  const normalizedRootPath = normalizeForComparison(rootPath);
  const rootAnchor = normalizeForComparison(getRootPath(rootPath, windows));

  if (normalizedRootPath === rootAnchor) {
    return normalizedPath.startsWith(rootAnchor);
  }

  const separator = windows ? '\\' : '/';
  return (
    normalizedPath === normalizedRootPath ||
    normalizedPath.startsWith(`${normalizedRootPath}${separator}`)
  );
}

export function findContainingRoot(path: string, roots: readonly string[]): string | null {
  return roots.find((root) => isPathWithinRoot(path, root)) ?? null;
}

export function getParentPath(path: string): string | null {
  const trimmed = path.trim();
  if (!trimmed) {
    return null;
  }

  const windows = isWindowsPath(trimmed);
  const normalized = trimTrailingSeparators(trimmed, windows);
  const rootPath = trimTrailingSeparators(getRootPath(normalized, windows), windows);
  if (normalizeForComparison(normalized) === normalizeForComparison(rootPath)) {
    return null;
  }

  const separator = windows ? '\\' : '/';
  const lastSeparatorIndex = normalized.lastIndexOf(separator);
  if (lastSeparatorIndex < 0) {
    return null;
  }

  const parentPath = normalized.slice(0, lastSeparatorIndex);
  if (parentPath.length < rootPath.length) {
    return rootPath;
  }

  return parentPath || rootPath;
}

export function joinDirectoryPath(parentPath: string, directoryName: string): string {
  const trimmedParentPath = parentPath.trim();
  const trimmedDirectoryName = directoryName.trim();
  const windows = isWindowsPath(trimmedParentPath);
  const separator = windows ? '\\' : '/';
  const normalizedParentPath = trimTrailingSeparators(trimmedParentPath, windows);
  const rootPath = trimTrailingSeparators(getRootPath(normalizedParentPath, windows), windows);

  if (normalizeForComparison(normalizedParentPath) === normalizeForComparison(rootPath)) {
    return `${normalizedParentPath}${trimmedDirectoryName}`;
  }

  return `${normalizedParentPath}${separator}${trimmedDirectoryName}`;
}
