import { spawn, execSync } from 'child_process';
import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { createRequire } from 'module';
import type { LSPServerHandle, LSPServerInfo, RootFunction } from './types.js';

function whichSync(bin: string): string | undefined {
  try {
    const result = execSync(`which ${bin} 2>/dev/null || where ${bin} 2>/dev/null`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return result.length > 0 ? result.split('\n')[0]?.trim() : undefined;
  } catch {
    return undefined;
  }
}

export const NearestRoot =
  (includePatterns: string[], excludePatterns?: string[]): RootFunction =>
  async (filePath: string) => {
    let dir = dirname(filePath);
    const root = filePath.startsWith('/') ? '/' : filePath.split(':')[0] + ':';

    while (dir !== root && dir !== dirname(dir)) {
      if (excludePatterns) {
        for (const pattern of excludePatterns) {
          try {
            await fs.access(join(dir, pattern));
            return undefined;
          } catch (_e) {
            void _e;
          }
        }
      }

      for (const pattern of includePatterns) {
        try {
          await fs.access(join(dir, pattern));
          return dir;
        } catch (_e) {
          void _e;
        }
      }

      dir = dirname(dir);
    }

    return undefined;
  };

function resolveModule(modulePath: string, root: string): string | undefined {
  try {
    const req = createRequire(join(root, 'package.json'));
    return req.resolve(modulePath);
  } catch {
    return undefined;
  }
}

export const TypescriptServer: LSPServerInfo = {
  id: 'typescript',
  extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'],
  root: NearestRoot(
    ['package-lock.json', 'bun.lockb', 'bun.lock', 'pnpm-lock.yaml', 'yarn.lock', 'package.json'],
    ['deno.json', 'deno.jsonc'],
  ),
  async spawn(root: string): Promise<LSPServerHandle | undefined> {
    const tsserver = resolveModule('typescript/lib/tsserver.js', root);
    const bin = whichSync('typescript-language-server');
    if (!bin) return undefined;
    return {
      process: spawn(bin, ['--stdio'], { cwd: root }),
      initialization: tsserver ? { tsserver: { path: tsserver } } : undefined,
    };
  },
};

export const GoplsServer: LSPServerInfo = {
  id: 'gopls',
  extensions: ['.go'],
  root: NearestRoot(['go.mod', 'go.sum', 'go.work']),
  async spawn(root: string): Promise<LSPServerHandle | undefined> {
    const bin = whichSync('gopls');
    if (!bin) return undefined;
    return { process: spawn(bin, { cwd: root }) };
  },
};

export const PyrightServer: LSPServerInfo = {
  id: 'pyright',
  extensions: ['.py', '.pyi'],
  root: NearestRoot(['pyproject.toml', 'setup.py', 'requirements.txt', 'Pipfile', 'setup.cfg']),
  async spawn(root: string): Promise<LSPServerHandle | undefined> {
    const bin = whichSync('pyright-langserver') ?? whichSync('pylsp');
    if (!bin) return undefined;
    return { process: spawn(bin, ['--stdio'], { cwd: root }) };
  },
};

export const ALL_SERVERS: LSPServerInfo[] = [TypescriptServer, GoplsServer, PyrightServer];

export function findServerForFile(filePath: string): LSPServerInfo | undefined {
  const ext = filePath.slice(filePath.lastIndexOf('.'));
  return ALL_SERVERS.find((s) => s.extensions.includes(ext));
}
