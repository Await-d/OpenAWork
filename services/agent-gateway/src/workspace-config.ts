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
      return resolve(startPath);
    }

    currentPath = parentPath;
  }
}
