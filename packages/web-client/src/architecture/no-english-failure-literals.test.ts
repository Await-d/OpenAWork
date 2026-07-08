import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const DISALLOWED_PATTERNS: RegExp[] = [
  /Failed to (?!fetch\b)/,
  /\bLogin failed\b/,
  /\bRefresh failed\b/,
  /\bNo access token\b/,
  /\bSession expired\b/,
];

const FILE_ALLOWLIST = new Set<string>(['gateway/http.ts']);

function collectFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      files.push(...collectFiles(fullPath));
      continue;
    }
    if (
      (fullPath.endsWith('.ts') || fullPath.endsWith('.tsx')) &&
      !fullPath.endsWith('.test.ts') &&
      !fullPath.endsWith('.test.tsx')
    ) {
      files.push(fullPath);
    }
  }

  return files;
}

describe('web-client failure literal guard', () => {
  it('源码里不应回流明显的英文失败文案', () => {
    const offenders: Array<{ file: string; pattern: string }> = [];

    for (const file of collectFiles(ROOT)) {
      const relativePath = relative(ROOT, file);
      if (FILE_ALLOWLIST.has(relativePath)) {
        continue;
      }
      const source = readFileSync(file, 'utf8');
      for (const pattern of DISALLOWED_PATTERNS) {
        if (pattern.test(source)) {
          offenders.push({ file: relativePath, pattern: pattern.source });
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
