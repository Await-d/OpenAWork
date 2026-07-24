import { existsSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function parseConfiguredWorkspaceRoots(rawValue: string | undefined): string[] {
  const normalizedValue = rawValue?.trim();
  if (!normalizedValue) {
    return [];
  }

  if (normalizedValue.startsWith('[')) {
    try {
      const parsed = JSON.parse(normalizedValue) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.filter((entry): entry is string => typeof entry === 'string');
      }
    } catch {
      return [];
    }
  }

  return normalizedValue
    .split(new RegExp(`[${escapeRegExp(delimiter)}\r\n]+`, 'g'))
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export function dedupeWorkspaceRoots(roots: string[]): string[] {
  const uniqueRoots = new Set<string>();
  const result: string[] = [];

  for (const root of roots) {
    const resolvedRoot = resolve(root);
    if (uniqueRoots.has(resolvedRoot)) {
      continue;
    }

    uniqueRoots.add(resolvedRoot);
    result.push(resolvedRoot);
  }

  return result;
}

export function parseWorkspaceAccessMode(
  rawValue: string | undefined,
  hasExplicitWorkspaceRoots: boolean,
): 'restricted' | 'unrestricted' {
  const normalizedValue = rawValue?.trim().toLowerCase();
  if (normalizedValue === 'restricted' || normalizedValue === 'unrestricted') {
    return normalizedValue;
  }

  return hasExplicitWorkspaceRoots ? 'restricted' : 'unrestricted';
}

/**
 * Paths that must never become the gateway's default WORKSPACE_ROOT.
 * On Windows, GUI-launched processes often inherit `C:\WINDOWS\system32` as
 * cwd; treating that as the workspace makes bash truncation try to write
 * under a protected system directory and surface ENOENT / EPERM.
 */
export function isUnsafeWorkspaceRootFallback(rootPath: string): boolean {
  const resolved = resolve(rootPath);
  const normalized = resolved.replace(/\\/g, '/').toLowerCase();
  const base = normalized.split('/').filter(Boolean).pop() ?? '';

  if (base === 'system32' || base === 'syswow64' || base === 'sysnative') {
    return true;
  }

  // Drive root (C:\ / /) is never a useful project workspace.
  if (dirname(resolved) === resolved) {
    return true;
  }

  // Windows / Windows\System* trees.
  if (
    /(^|\/)windows(\/|$)/.test(normalized) &&
    /\/(system32|syswow64|sysnative)(\/|$)/.test(normalized)
  ) {
    return true;
  }

  return false;
}

export function discoverWorkspaceRoot(startPath: string): string {
  let currentPath = resolve(startPath);

  while (true) {
    if (
      existsSync(join(currentPath, 'pnpm-workspace.yaml')) ||
      existsSync(join(currentPath, '.git'))
    ) {
      return currentPath;
    }

    const parentPath = dirname(currentPath);
    if (parentPath === currentPath) {
      // No repo markers found. Callers that refuse system-directory fallbacks
      // (e.g. db.ts WORKSPACE_ROOT bootstrap) should check
      // isUnsafeWorkspaceRootFallback on this result.
      return resolve(startPath);
    }

    currentPath = parentPath;
  }
}
