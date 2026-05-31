import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = '/home/await/project/OpenAWork/apps/web/src';
const SCAN_DIRS = ['components', 'pages'];

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
    if (fullPath.endsWith('.ts') || fullPath.endsWith('.tsx')) {
      files.push(fullPath);
    }
  }

  return files;
}

describe('gateway client boundary', () => {
  it('components/pages 不应直接调用 fetch 访问网关', () => {
    const offenders: string[] = [];

    for (const scanDir of SCAN_DIRS) {
      const files = collectFiles(join(ROOT, scanDir));
      for (const file of files) {
        const source = readFileSync(file, 'utf8');
        if (/\bfetch\s*\((?!\?:)/.test(source)) {
          offenders.push(relative(ROOT, file));
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
