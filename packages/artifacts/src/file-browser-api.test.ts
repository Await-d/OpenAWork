import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { FileBrowserAPIImpl } from './manager.js';

/**
 * Regression: the artifacts file-browser search previously built shell command
 * strings and ran them through `exec`, escaping args with `JSON.stringify` —
 * which does NOT escape shell metacharacters, so a `query`/`pattern` containing
 * `$(...)`, backticks, or quotes could break out and execute arbitrary
 * commands. The hardened version uses `execFile` with an argv array (no shell)
 * plus a wall-clock timeout. These tests pin injection-safety: a query full of
 * shell metacharacters is matched literally and never executes.
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
let prevCwd: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'artifacts-fb-'));
  prevCwd = process.cwd();
  process.chdir(dir);
});

afterEach(() => {
  process.chdir(prevCwd);
  rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(!grepAvailable)('artifacts FileBrowserAPIImpl injection safety', () => {
  it('searchText 把含 shell 元字符的 query 当字面量匹配，绝不执行注入', async () => {
    const marker = join(dir, 'INJECTED');
    const payload = `$(touch ${marker})`;
    writeFileSync(join(dir, 'hit.txt'), `harmless ${payload} text\n`, 'utf8');

    const api = new FileBrowserAPIImpl();
    const results = await api.searchText(payload);

    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.path.includes('hit.txt'))).toBe(true);
    expect(existsSync(marker)).toBe(false);
  });

  it('searchText 的 maxResults 在 JS 侧生效（不再依赖 shell head 管道）', async () => {
    for (let i = 0; i < 10; i++) {
      writeFileSync(join(dir, `f${i}.txt`), 'needle here\n', 'utf8');
    }
    const api = new FileBrowserAPIImpl();
    const results = await api.searchText('needle', { maxResults: 3 });
    expect(results.length).toBe(3);
  });

  it('searchFiles 把含元字符的 pattern 当字面 glob 处理而非执行', async () => {
    const marker = join(dir, 'INJECTED2');
    const api = new FileBrowserAPIImpl();
    const results = await api.searchFiles(`*.txt$(touch ${marker})`);
    expect(Array.isArray(results)).toBe(true);
    expect(existsSync(marker)).toBe(false);
  });
});
