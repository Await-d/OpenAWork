import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileBrowserAPIImpl } from './file-browser-api.js';

/**
 * Regression: the file-browser search API previously built shell command
 * strings and ran them through `exec`, where `JSON.stringify` does NOT escape
 * shell metacharacters — a `query`/`rootPath`/`filePattern` containing
 * `$(...)`, backticks, or quotes could break out and execute arbitrary
 * commands. It also had no timeout. The hardened version uses `execFile` with
 * an argument array (no shell parsing) plus a wall-clock timeout. These tests
 * pin the injection-safety: a query full of shell metacharacters must be
 * matched literally and must never execute.
 */

const grepAvailable = (() => {
  try {
    execFileSync('grep', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'file-browser-api-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true }).catch(() => {});
});

describe.skipIf(!grepAvailable)('FileBrowserAPIImpl injection safety', () => {
  it('searchText 把含 shell 元字符的 query 当字面量匹配，绝不执行注入', async () => {
    // A literal payload that, under a shell, would spawn a marker file.
    const marker = join(dir, 'INJECTED');
    const payload = `$(touch ${marker})`;
    await writeFile(join(dir, 'hit.txt'), `harmless ${payload} text\n`, 'utf8');

    const api = new FileBrowserAPIImpl();
    const results = await api.searchText(payload, dir);

    // The literal string is found in the file...
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.filePath).toContain('hit.txt');
    // ...and the injection never ran: no marker file was created.
    const { existsSync } = await import('node:fs');
    expect(existsSync(marker)).toBe(false);
  });

  it('searchFiles 把含元字符的 rootPath 当字面路径处理而非执行', async () => {
    const marker = join(dir, 'INJECTED2');
    const api = new FileBrowserAPIImpl();
    // A bogus path containing an injection attempt; find just finds nothing.
    const results = await api.searchFiles('*.txt', `${dir}/$(touch ${marker})`);
    expect(Array.isArray(results)).toBe(true);
    const { existsSync } = await import('node:fs');
    expect(existsSync(marker)).toBe(false);
  });

  it('searchText 在普通文件树上返回正确的行号与路径', async () => {
    await writeFile(join(dir, 'a.ts'), 'const needle = 1;\nconst other = 2;\n', 'utf8');
    const api = new FileBrowserAPIImpl();
    const results = await api.searchText('needle', dir);
    expect(results.length).toBe(1);
    expect(results[0]?.line).toBe(1);
    expect(results[0]?.filePath).toContain('a.ts');
  });
});
