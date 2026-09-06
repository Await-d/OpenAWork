import { open, readdir, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';

/** Bounded, read-only project evidence. Never traverse dependencies or symlinks. */
export async function collectPlanningProjectContext(directory: string): Promise<string> {
  const root = await realpath(directory);
  const evidence = [`项目根目录：${root}`];
  const ignored = new Set(['node_modules', '.git', '.env', 'dist', 'build', '.evidence']);
  const queue = [{ path: root, depth: 0 }];
  let count = 0;
  while (queue.length && count < 160) {
    const current = queue.shift()!;
    const entries = await readdir(current.path, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isSymbolicLink() || ignored.has(entry.name) || entry.name.startsWith('.')) continue;
      const path = join(current.path, entry.name);
      evidence.push(`${relative(root, path)}${entry.isDirectory() ? '/' : ''}`);
      count += 1;
      if (entry.isDirectory() && current.depth < 2) queue.push({ path, depth: current.depth + 1 });
      if (count >= 160) break;
    }
  }
  for (const name of [
    'AGENTS.md',
    'package.json',
    'README.md',
    'tsconfig.json',
    'pnpm-workspace.yaml',
  ]) {
    try {
      const path = await realpath(join(root, name));
      const rel = relative(root, path);
      if (rel.startsWith('..') || isAbsolute(rel) || !(await stat(path)).isFile()) continue;
      const file = await open(path, 'r');
      try {
        const buffer = Buffer.alloc(12_000);
        const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
        evidence.push(
          `\n--- ${name}（最多 12000 字节）---\n${buffer.subarray(0, bytesRead).toString('utf8')}`,
        );
      } finally {
        await file.close();
      }
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') continue;
      evidence.push(`${name} 读取失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return evidence.join('\n');
}
