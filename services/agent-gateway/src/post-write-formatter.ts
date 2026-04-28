/**
 * Post-Write Auto-Formatter
 *
 * Ported from opencode's format/ service. After a file is written or edited,
 * this module detects available formatters by file extension and runs them
 * to keep code style consistent.
 *
 * Detection is lazy and cached per workspace root for the process lifetime.
 */

import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// which — locate an executable on $PATH
// ---------------------------------------------------------------------------

function which(name: string): string | null {
  const pathEnv = process.env['PATH'] ?? '';
  const dirs = pathEnv.split(path.delimiter);
  for (const dir of dirs) {
    const candidate = path.join(dir, name);
    try {
      if (existsSync(candidate)) return candidate;
    } catch {
      // skip inaccessible dirs
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Formatter definitions
// ---------------------------------------------------------------------------

interface FormatterInfo {
  name: string;
  extensions: string[];
  /** Returns the command argv (with $FILE placeholder) or null if unavailable. */
  detect(workspaceRoot: string): Promise<string[] | null>;
}

const FORMATTERS: FormatterInfo[] = [
  // Go
  {
    name: 'gofmt',
    extensions: ['.go'],
    async detect() {
      const bin = which('gofmt');
      return bin ? [bin, '-w', '$FILE'] : null;
    },
  },
  // Prettier (JS/TS ecosystem)
  {
    name: 'prettier',
    extensions: [
      '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts',
      '.html', '.htm', '.css', '.scss', '.sass', '.less',
      '.vue', '.svelte', '.json', '.jsonc',
      '.yaml', '.yml', '.md', '.mdx', '.graphql', '.gql',
    ],
    async detect(workspaceRoot) {
      const pkgPath = path.join(workspaceRoot, 'package.json');
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as {
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
        };
        if (pkg.dependencies?.['prettier'] || pkg.devDependencies?.['prettier']) {
          // Try npx/local node_modules
          const localBin = path.join(workspaceRoot, 'node_modules', '.bin', 'prettier');
          if (existsSync(localBin)) return [localBin, '--write', '$FILE'];
          const globalBin = which('prettier');
          if (globalBin) return [globalBin, '--write', '$FILE'];
        }
      } catch {
        // no package.json or parse error
      }
      return null;
    },
  },
  // Biome
  {
    name: 'biome',
    extensions: [
      '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts',
      '.html', '.htm', '.css', '.scss', '.sass', '.less',
      '.vue', '.svelte', '.json', '.jsonc',
      '.yaml', '.yml', '.md', '.mdx', '.graphql', '.gql',
    ],
    async detect(workspaceRoot) {
      for (const config of ['biome.json', 'biome.jsonc']) {
        if (existsSync(path.join(workspaceRoot, config))) {
          const localBin = path.join(workspaceRoot, 'node_modules', '.bin', 'biome');
          if (existsSync(localBin)) return [localBin, 'format', '--write', '$FILE'];
          const globalBin = which('biome');
          if (globalBin) return [globalBin, 'format', '--write', '$FILE'];
        }
      }
      return null;
    },
  },
  // Rust
  {
    name: 'rustfmt',
    extensions: ['.rs'],
    async detect() {
      const bin = which('rustfmt');
      return bin ? [bin, '$FILE'] : null;
    },
  },
  // Python — ruff
  {
    name: 'ruff',
    extensions: ['.py', '.pyi'],
    async detect(workspaceRoot) {
      if (!which('ruff')) return null;
      for (const config of ['pyproject.toml', 'ruff.toml', '.ruff.toml']) {
        const configPath = path.join(workspaceRoot, config);
        if (existsSync(configPath)) {
          if (config === 'pyproject.toml') {
            try {
              const content = readFileSync(configPath, 'utf-8');
              if (content.includes('[tool.ruff]')) return ['ruff', 'format', '$FILE'];
            } catch {
              // skip
            }
          } else {
            return ['ruff', 'format', '$FILE'];
          }
        }
      }
      return null;
    },
  },
  // C/C++ — clang-format
  {
    name: 'clang-format',
    extensions: ['.c', '.cc', '.cpp', '.cxx', '.h', '.hh', '.hpp', '.hxx'],
    async detect(workspaceRoot) {
      if (existsSync(path.join(workspaceRoot, '.clang-format'))) {
        const bin = which('clang-format');
        return bin ? [bin, '-i', '$FILE'] : null;
      }
      return null;
    },
  },
  // Zig
  {
    name: 'zig',
    extensions: ['.zig', '.zon'],
    async detect() {
      const bin = which('zig');
      return bin ? [bin, 'fmt', '$FILE'] : null;
    },
  },
  // Dart
  {
    name: 'dart',
    extensions: ['.dart'],
    async detect() {
      const bin = which('dart');
      return bin ? [bin, 'format', '$FILE'] : null;
    },
  },
  // Shell
  {
    name: 'shfmt',
    extensions: ['.sh', '.bash'],
    async detect() {
      const bin = which('shfmt');
      return bin ? [bin, '-w', '$FILE'] : null;
    },
  },
  // Terraform
  {
    name: 'terraform',
    extensions: ['.tf', '.tfvars'],
    async detect() {
      const bin = which('terraform');
      return bin ? [bin, 'fmt', '$FILE'] : null;
    },
  },
  // Gleam
  {
    name: 'gleam',
    extensions: ['.gleam'],
    async detect() {
      const bin = which('gleam');
      return bin ? [bin, 'format', '$FILE'] : null;
    },
  },
  // Nix
  {
    name: 'nixfmt',
    extensions: ['.nix'],
    async detect() {
      const bin = which('nixfmt');
      return bin ? [bin, '$FILE'] : null;
    },
  },
  // Elixir
  {
    name: 'mix',
    extensions: ['.ex', '.exs', '.eex', '.heex'],
    async detect() {
      const bin = which('mix');
      return bin ? [bin, 'format', '$FILE'] : null;
    },
  },
  // Kotlin
  {
    name: 'ktlint',
    extensions: ['.kt', '.kts'],
    async detect() {
      const bin = which('ktlint');
      return bin ? [bin, '-F', '$FILE'] : null;
    },
  },
  // Haskell
  {
    name: 'ormolu',
    extensions: ['.hs'],
    async detect() {
      const bin = which('ormolu');
      return bin ? [bin, '-i', '$FILE'] : null;
    },
  },
];

// ---------------------------------------------------------------------------
// Cache: workspace root → { ext → command argv }
// ---------------------------------------------------------------------------

const formatterCache = new Map<string, Map<string, string[]>>();

async function resolveFormatterForExt(
  workspaceRoot: string,
  ext: string,
): Promise<string[] | null> {
  let extMap = formatterCache.get(workspaceRoot);
  if (!extMap) {
    extMap = new Map();
    formatterCache.set(workspaceRoot, extMap);
  }

  if (extMap.has(ext)) {
    return extMap.get(ext) ?? null;
  }

  // Find the first formatter that matches this extension and is available
  for (const formatter of FORMATTERS) {
    if (!formatter.extensions.includes(ext)) continue;
    try {
      const cmd = await formatter.detect(workspaceRoot);
      if (cmd) {
        extMap.set(ext, cmd);
        return cmd;
      }
    } catch {
      // detection failed, try next
    }
  }

  // Cache the negative result too
  extMap.set(ext, []);
  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Format a file using the first available formatter for its extension.
 * Silently returns if no formatter is found or if formatting fails.
 *
 * @param filePath - Absolute path to the file to format
 * @param workspaceRoot - Workspace root for formatter detection context
 * @param timeoutMs - Maximum time to wait for the formatter (default: 10s)
 */
export async function formatFileAfterWrite(
  filePath: string,
  workspaceRoot: string,
  timeoutMs = 10_000,
): Promise<void> {
  const ext = path.extname(filePath);
  if (!ext) return;

  const cmd = await resolveFormatterForExt(workspaceRoot, ext);
  if (!cmd || cmd.length === 0) return;

  const argv = cmd.map((arg) => (arg === '$FILE' ? filePath : arg));
  const [bin, ...args] = argv;
  if (!bin) return;

  try {
    await execFileAsync(bin, args, {
      cwd: workspaceRoot,
      timeout: timeoutMs,
      maxBuffer: 2 * 1024 * 1024,
    });
  } catch {
    // Formatting is best-effort — never fail the edit/write operation
  }
}

/**
 * Clear the formatter cache (useful for testing or when workspace config changes).
 */
export function clearFormatterCache(): void {
  formatterCache.clear();
}
