import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(process.cwd(), 'src');
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

/**
 * 允许直接 `fetch` 的文件：仅限**本地数据处理**（`data:` / `blob:` URL 的解码），
 * 这类调用不经过网络、也不碰网关，不属于本测试守的边界。
 *
 * 白名单不是免死金牌：文件里只要出现一次非 `data:` / `blob:` 的 `fetch`，
 * 仍然会被判定违规——否则往这些文件里偷偷塞一个网关请求就能绕过检查。
 */
const LOCAL_DATA_FETCH_ALLOWLIST = new Set<string>([
  'components/chat/misc/browser/frame-decode.ts',
]);

const LOCAL_DATA_URL_PREFIXES = ['`data:', '`blob:', "'data:", "'blob:", '"data:', '"blob:'];

function isLocalDataUrlFetch(source: string, callStart: number): boolean {
  const argument = source.slice(callStart).trimStart();
  return LOCAL_DATA_URL_PREFIXES.some((prefix) => argument.startsWith(prefix));
}

describe('gateway client boundary', () => {
  it('components/pages 不应直接调用 fetch 访问网关', () => {
    const offenders: string[] = [];

    for (const scanDir of SCAN_DIRS) {
      const files = collectFiles(join(ROOT, scanDir));
      for (const file of files) {
        const relativePath = relative(ROOT, file);
        const source = readFileSync(file, 'utf8');
        const allowLocalDataFetch = LOCAL_DATA_FETCH_ALLOWLIST.has(relativePath);

        for (const match of source.matchAll(/\bfetch\s*\((?!\?:)/g)) {
          const callStart = (match.index ?? 0) + match[0].length;
          if (allowLocalDataFetch && isLocalDataUrlFetch(source, callStart)) {
            continue;
          }
          offenders.push(relativePath);
          break;
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
