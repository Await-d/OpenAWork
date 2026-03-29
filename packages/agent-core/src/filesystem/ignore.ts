import { promises as fs } from 'fs';
import { join, relative } from 'path';
import { createPlatformAdapter } from '@openAwork/platform-adapter';

const BUILTIN_IGNORE_PATTERNS = [
  '.env',
  '.env.*',
  '**/*.pem',
  '**/*.key',
  '**/id_rsa',
  '**/id_ed25519',
  '**/id_ecdsa',
  '**/id_dsa',
  '**/.aws/credentials',
  '**/.aws/config',
  '**/*.p12',
  '**/*.pfx',
  '**/*.crt',
  '**/*.cer',
  'node_modules/**',
  '**/__pycache__/**',
  '**/*.pyc',
  '**/*.pyo',
  '**/*.lock',
  '**/.git/**',
  '**/*.sqlite',
  '**/*.sqlite3',
  '**/*.db',
];

export interface IgnoreRuleSet {
  gitignorePatterns: string[];
  agentignorePatterns: string[];
  userGlobalPatterns: string[];
  builtinPatterns: string[];
}

export interface AgentIgnoreManager {
  loadRules(projectRoot: string): Promise<IgnoreRuleSet>;
  shouldIgnore(filePath: string): boolean;
  listIgnored(dir: string): Promise<string[]>;
  addRuntimeRule(pattern: string): void;
}

function patternToRegex(pattern: string): RegExp {
  let p = pattern.trim();
  if (!p || p.startsWith('#')) return /(?!)/;

  const negate = p.startsWith('!');
  if (negate) p = p.slice(1);

  const anchored = p.startsWith('/');
  if (anchored) p = p.slice(1);

  p = p
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '<<GLOBSTAR>>')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/<<GLOBSTAR>>/g, '.*');

  const src = anchored ? `^${p}` : `(^|/)${p}`;
  return new RegExp(`${src}($|/)`);
}

async function readIgnoreFile(filePath: string): Promise<string[]> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return content
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('#'));
  } catch {
    return [];
  }
}

export function createAgentIgnoreManager(): AgentIgnoreManager {
  let rules: IgnoreRuleSet = {
    gitignorePatterns: [],
    agentignorePatterns: [],
    userGlobalPatterns: [],
    builtinPatterns: [...BUILTIN_IGNORE_PATTERNS],
  };
  let runtimePatterns: string[] = [];
  let projectRoot = '';

  const allPatterns = (): string[] => [
    ...rules.builtinPatterns,
    ...rules.gitignorePatterns,
    ...rules.agentignorePatterns,
    ...rules.userGlobalPatterns,
    ...runtimePatterns,
  ];

  return {
    async loadRules(root: string): Promise<IgnoreRuleSet> {
      projectRoot = root;

      const [gitignorePatterns, agentignorePatterns, userGlobalPatterns] = await Promise.all([
        readIgnoreFile(join(root, '.gitignore')),
        readIgnoreFile(join(root, '.agentignore')),
        readIgnoreFile(join(createPlatformAdapter().getConfigDir(), '.agentignore')),
      ]);

      rules = {
        gitignorePatterns,
        agentignorePatterns,
        userGlobalPatterns,
        builtinPatterns: [...BUILTIN_IGNORE_PATTERNS],
      };

      return rules;
    },

    shouldIgnore(filePath: string): boolean {
      const rel = projectRoot
        ? relative(projectRoot, filePath).replace(/\\/g, '/')
        : filePath.replace(/\\/g, '/');

      const patterns = allPatterns();
      for (const pattern of patterns) {
        const rx = patternToRegex(pattern);
        if (rx.test(rel)) return true;
        const base = filePath.split('/').pop() ?? '';
        if (rx.test(base)) return true;
      }
      return false;
    },

    async listIgnored(dir: string): Promise<string[]> {
      const ignored: string[] = [];
      const shouldIgnoreFn = (fp: string) => {
        const rel = projectRoot
          ? relative(projectRoot, fp).replace(/\\/g, '/')
          : fp.replace(/\\/g, '/');
        const patterns = allPatterns();
        for (const pattern of patterns) {
          const rx = patternToRegex(pattern);
          if (rx.test(rel)) return true;
          const base = fp.split('/').pop() ?? '';
          if (rx.test(base)) return true;
        }
        return false;
      };
      async function walk(d: string) {
        let entries: { name: string; isDirectory(): boolean }[];
        try {
          entries = await fs.readdir(d, { withFileTypes: true });
        } catch {
          return;
        }
        for (const entry of entries) {
          const full = join(d, entry.name);
          if (shouldIgnoreFn(full)) {
            ignored.push(full);
          } else if (entry.isDirectory()) {
            await walk(full);
          }
        }
      }
      await walk(dir);
      return ignored;
    },

    addRuntimeRule(pattern: string): void {
      runtimePatterns.push(pattern);
    },
  };
}

export const defaultIgnoreManager = createAgentIgnoreManager();
