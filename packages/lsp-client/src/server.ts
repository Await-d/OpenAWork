import { spawn, execSync } from 'child_process';
import { promises as fs } from 'fs';
import { join, dirname, basename } from 'path';
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

const WEB_ROOT_MARKERS = [
  'package.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'package-lock.json',
  'bun.lockb',
  'bun.lock',
  '.git',
];

const YAML_ROOT_MARKERS = [
  'package.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'package-lock.json',
  'bun.lockb',
  'bun.lock',
  '.git',
  '.yamllint',
  'docker-compose.yml',
  'docker-compose.yaml',
  'compose.yaml',
  'Chart.yaml',
];

const DOCKER_ROOT_MARKERS = [
  'Dockerfile',
  '.dockerignore',
  'docker-compose.yml',
  'docker-compose.yaml',
  'compose.yml',
  'compose.yaml',
  '.git',
];

const DOCKER_COMPOSE_FILES = [
  'compose.yaml',
  'compose.yml',
  'compose.override.yaml',
  'compose.override.yml',
  'docker-compose.yaml',
  'docker-compose.yml',
  'docker-compose.override.yaml',
  'docker-compose.override.yml',
];

const DOCKER_BAKE_FILES = ['docker-bake.hcl', 'docker-bake.override.hcl'];

const DOCKER_COMPOSE_ROOT_MARKERS = [...DOCKER_COMPOSE_FILES, '.git'];
const DOCKER_BAKE_ROOT_MARKERS = [...DOCKER_BAKE_FILES, '.git'];

const SHELL_ROOT_MARKERS = [
  'package.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'package-lock.json',
  'bun.lockb',
  'bun.lock',
  '.git',
  '.editorconfig',
  '.shellcheckrc',
  '.shellcheck.json',
];

export const TypescriptServer: LSPServerInfo = {
  id: 'typescript',
  extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'],
  binary: 'typescript-language-server',
  installCommand: 'npm install -g typescript-language-server typescript',
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
  binary: 'gopls',
  installCommand: 'go install golang.org/x/tools/gopls@latest',
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
  binary: ['pyright-langserver', 'pylsp'],
  installCommand: 'npm install -g pyright',
  root: NearestRoot(['pyproject.toml', 'setup.py', 'requirements.txt', 'Pipfile', 'setup.cfg']),
  async spawn(root: string): Promise<LSPServerHandle | undefined> {
    const bin = whichSync('pyright-langserver') ?? whichSync('pylsp');
    if (!bin) return undefined;
    return { process: spawn(bin, ['--stdio'], { cwd: root }) };
  },
};

export const JsonServer: LSPServerInfo = {
  id: 'json',
  extensions: ['.json', '.jsonc', '.json5'],
  binary: 'vscode-json-language-server',
  installCommand: 'npm install -g vscode-json-languageserver',
  root: NearestRoot(WEB_ROOT_MARKERS),
  async spawn(root: string): Promise<LSPServerHandle | undefined> {
    const bin = whichSync('vscode-json-language-server');
    if (!bin) return undefined;
    return { process: spawn(bin, ['--stdio'], { cwd: root }) };
  },
};

export const HtmlServer: LSPServerInfo = {
  id: 'html',
  extensions: ['.html', '.htm'],
  binary: 'vscode-html-language-server',
  installCommand: 'npm install -g vscode-html-languageserver-bin',
  root: NearestRoot(WEB_ROOT_MARKERS),
  async spawn(root: string): Promise<LSPServerHandle | undefined> {
    const bin = whichSync('vscode-html-language-server');
    if (!bin) return undefined;
    return { process: spawn(bin, ['--stdio'], { cwd: root }) };
  },
};

export const CssServer: LSPServerInfo = {
  id: 'css',
  extensions: ['.css', '.scss', '.sass', '.less'],
  binary: 'vscode-css-language-server',
  installCommand: 'npm install -g vscode-css-languageserver-bin',
  root: NearestRoot(WEB_ROOT_MARKERS),
  async spawn(root: string): Promise<LSPServerHandle | undefined> {
    const bin = whichSync('vscode-css-language-server');
    if (!bin) return undefined;
    return { process: spawn(bin, ['--stdio'], { cwd: root }) };
  },
};

export const YamlServer: LSPServerInfo = {
  id: 'yaml',
  extensions: ['.yaml', '.yml'],
  binary: 'yaml-language-server',
  installCommand: 'npm install -g yaml-language-server',
  root: NearestRoot(YAML_ROOT_MARKERS),
  async spawn(root: string): Promise<LSPServerHandle | undefined> {
    const bin = whichSync('yaml-language-server');
    if (!bin) return undefined;
    return { process: spawn(bin, ['--stdio'], { cwd: root }) };
  },
};

export const DockerfileServer: LSPServerInfo = {
  id: 'dockerfile',
  extensions: ['dockerfile'],
  binary: 'docker-language-server',
  installCommand: 'npm install -g docker-language-server',
  root: NearestRoot(DOCKER_ROOT_MARKERS),
  async spawn(root: string): Promise<LSPServerHandle | undefined> {
    const bin = whichSync('docker-language-server');
    if (!bin) return undefined;
    return { process: spawn(bin, ['start', '--stdio'], { cwd: root }) };
  },
};

export const DockerComposeServer: LSPServerInfo = {
  id: 'dockercompose',
  extensions: DOCKER_COMPOSE_FILES,
  binary: 'docker-language-server',
  installCommand: 'npm install -g docker-language-server',
  root: NearestRoot(DOCKER_COMPOSE_ROOT_MARKERS),
  async spawn(root: string): Promise<LSPServerHandle | undefined> {
    const bin = whichSync('docker-language-server');
    if (!bin) return undefined;
    return { process: spawn(bin, ['start', '--stdio'], { cwd: root }) };
  },
};

export const DockerBakeServer: LSPServerInfo = {
  id: 'dockerbake',
  extensions: DOCKER_BAKE_FILES,
  binary: 'docker-language-server',
  installCommand: 'npm install -g docker-language-server',
  root: NearestRoot(DOCKER_BAKE_ROOT_MARKERS),
  async spawn(root: string): Promise<LSPServerHandle | undefined> {
    const bin = whichSync('docker-language-server');
    if (!bin) return undefined;
    return { process: spawn(bin, ['start', '--stdio'], { cwd: root }) };
  },
};

export const ESLintServer: LSPServerInfo = {
  id: 'eslint',
  extensions: ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'],
  role: 'supplemental',
  slot: 'js-lint',
  priority: 1,
  binary: 'vscode-eslint-language-server',
  installCommand: 'npm install -g vscode-eslint-language-server',
  root: NearestRoot([
    '.eslintrc',
    '.eslintrc.js',
    '.eslintrc.json',
    '.eslintrc.cjs',
    'eslint.config.js',
    'eslint.config.ts',
  ]),
  async spawn(root: string): Promise<LSPServerHandle | undefined> {
    const bin = whichSync('vscode-eslint-language-server');
    if (!bin) return undefined;
    return {
      process: spawn(bin, ['--stdio'], { cwd: root }),
      initialization: {
        validate: 'on',
        codeAction: {
          disableRuleComment: { enable: true },
          showDocumentation: { enable: true },
        },
      },
    };
  },
};

export const BiomeServer: LSPServerInfo = {
  id: 'biome',
  extensions: ['.js', '.jsx', '.ts', '.tsx', '.json', '.jsonc'],
  role: 'supplemental',
  slot: 'js-lint',
  priority: 2,
  binary: 'biome',
  installCommand: 'npm install -g @biomejs/biome',
  root: NearestRoot(['biome.json', 'biome.jsonc']),
  async spawn(root: string): Promise<LSPServerHandle | undefined> {
    const bin = whichSync('biome');
    if (!bin) return undefined;
    return { process: spawn(bin, ['lsp-proxy'], { cwd: root }) };
  },
};

export const ShellscriptServer: LSPServerInfo = {
  id: 'shellscript',
  extensions: ['.sh', '.bash', '.zsh'],
  binary: 'bash-language-server',
  installCommand: 'npm install -g bash-language-server',
  root: NearestRoot(SHELL_ROOT_MARKERS),
  async spawn(root: string): Promise<LSPServerHandle | undefined> {
    const bin = whichSync('bash-language-server');
    if (!bin) return undefined;
    return { process: spawn(bin, ['start'], { cwd: root }) };
  },
};

export const RustAnalyzerServer: LSPServerInfo = {
  id: 'rust-analyzer',
  extensions: ['.rs'],
  binary: 'rust-analyzer',
  installCommand: 'rustup component add rust-analyzer || cargo install rust-analyzer',
  root: NearestRoot(['Cargo.toml', 'Cargo.lock']),
  async spawn(root: string): Promise<LSPServerHandle | undefined> {
    const bin = whichSync('rust-analyzer');
    if (!bin) return undefined;
    return { process: spawn(bin, { cwd: root }) };
  },
};

export const ALL_SERVERS: LSPServerInfo[] = [
  TypescriptServer,
  GoplsServer,
  PyrightServer,
  JsonServer,
  HtmlServer,
  CssServer,
  YamlServer,
  DockerfileServer,
  DockerComposeServer,
  DockerBakeServer,
  ESLintServer,
  BiomeServer,
  ShellscriptServer,
  RustAnalyzerServer,
];

function splitMatches(filePath: string, servers: readonly LSPServerInfo[]) {
  const idx = filePath.lastIndexOf('.');
  const ext = idx >= 0 ? filePath.slice(idx).toLowerCase() : '';
  const name = basename(filePath).toLowerCase();
  const byName = servers.filter((s) => s.extensions.some((value) => value.toLowerCase() === name));
  const byExt = servers.filter(
    (s) => !byName.includes(s) && s.extensions.some((value) => value.toLowerCase() === ext),
  );
  return [...byName, ...byExt];
}

export function findServersForFile(
  filePath: string,
  servers: readonly LSPServerInfo[] = ALL_SERVERS,
): LSPServerInfo[] {
  return splitMatches(filePath, servers);
}

export function findServerForFile(
  filePath: string,
  servers: readonly LSPServerInfo[] = ALL_SERVERS,
): LSPServerInfo | undefined {
  const matches = findServersForFile(filePath, servers);
  return matches.find((s) => s.role !== 'supplemental') ?? matches[0];
}
