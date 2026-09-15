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

/**
 * Exact, case-sensitive basenames of committed env templates that the builtin
 * `.env.*` pattern must NOT hard-deny — the repo itself ships `.env.example`
 * (README: `cp .env.example .env`). Exact match only: no globs, no prefix
 * matching, so `.env.example.bak` stays denied.
 */
const SAFE_ENV_TEMPLATE_BASENAMES = new Set([
  '.env.example',
  '.env.sample',
  '.env.template',
  '.env.dist',
  '.env.defaults',
]);

const BUILTIN_ENV_TEMPLATE_PATTERN = '.env.*';

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

interface ParsedIgnorePattern {
  regex: RegExp | null;
  negate: boolean;
}

const GLOBSTAR_DIR_PLACEHOLDER = '\u0001';
const GLOBSTAR_ANY_PLACEHOLDER = '\u0002';
const CLASS_START_PLACEHOLDER = '\u0003';
const CLASS_END_PLACEHOLDER = '\u0004';

interface ExtractedCharacterClasses {
  template: string;
  classes: string[];
}

/**
 * POSIX fnmatch allows `]` as the first character of a class, but in
 * JavaScript `[]]` is an empty class plus a literal `]` and `[^]]` is "any
 * character" plus a literal `]`. A leading literal `]` is therefore emitted as
 * `\]` so the class keeps the POSIX meaning.
 */
function compileCharacterClass(raw: string): string {
  let prefix = '';
  let rest = raw;
  if (rest.startsWith('!')) {
    prefix = '^';
    rest = rest.slice(1);
  } else if (rest.startsWith('^')) {
    prefix = '^';
    rest = rest.slice(1);
  }
  if (rest.startsWith(']')) rest = `\\]${rest.slice(1)}`;
  return `[${prefix}${rest}]`;
}

/**
 * Pulls gitignore character classes (`[...]`) out of the pattern so the glob
 * expansion below cannot rewrite their contents: `[!a]` becomes `[^a]` and a
 * `[` without a matching `]` is escaped as a literal.
 */
function extractCharacterClasses(pattern: string): ExtractedCharacterClasses {
  const classes: string[] = [];
  let template = '';
  let i = 0;

  while (i < pattern.length) {
    const current = pattern.charAt(i);
    if (current !== '[') {
      template += current;
      i += 1;
      continue;
    }

    let cursor = i + 1;
    if (pattern.charAt(cursor) === '!' || pattern.charAt(cursor) === '^') cursor += 1;
    // A `]` in first position is part of the class (git/fnmatch behavior).
    if (pattern.charAt(cursor) === ']') cursor += 1;

    const close = pattern.indexOf(']', cursor);
    if (close === -1) {
      classes.push('\\[');
      template += `${CLASS_START_PLACEHOLDER}${classes.length - 1}${CLASS_END_PLACEHOLDER}`;
      i += 1;
      continue;
    }

    const raw = pattern.slice(i + 1, close);
    classes.push(compileCharacterClass(raw));
    template += `${CLASS_START_PLACEHOLDER}${classes.length - 1}${CLASS_END_PLACEHOLDER}`;
    i = close + 1;
  }

  return { template, classes };
}

function parseIgnorePattern(pattern: string): ParsedIgnorePattern {
  let p = pattern.trim();
  if (!p || p.startsWith('#')) return { regex: null, negate: false };

  let negate = false;
  if (p.startsWith('!')) {
    negate = true;
    p = p.slice(1);
  } else if (p.startsWith('\\!')) {
    p = p.slice(1);
  }

  // A `dir/` pattern applies to the directory and every path beneath it; the
  // `($|/)` suffix below already expresses both, so trailing slashes are dropped.
  p = p.replace(/\/+$/, '');
  if (!p) return { regex: null, negate: false };

  const anchored = p.startsWith('/');
  if (anchored) p = p.slice(1);

  const { template, classes } = extractCharacterClasses(p);

  let body = template
    .replace(/[.+^${}()|\\]/g, '\\$&')
    .replace(/\*\*\//g, GLOBSTAR_DIR_PLACEHOLDER)
    .replace(/\*\*/g, GLOBSTAR_ANY_PLACEHOLDER)
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replaceAll(GLOBSTAR_DIR_PLACEHOLDER, '(?:.*/)?')
    .replaceAll(GLOBSTAR_ANY_PLACEHOLDER, '.*');

  for (const [index, charClass] of classes.entries()) {
    body = body.replace(`${CLASS_START_PLACEHOLDER}${index}${CLASS_END_PLACEHOLDER}`, charClass);
  }

  const src = anchored ? `^${body}` : `(^|/)${body}`;
  try {
    return { regex: new RegExp(`${src}($|/)`), negate };
  } catch {
    // Malformed user-controlled patterns (e.g. `[z-a]`) never match instead of
    // throwing; `negate` is preserved so last-match-wins ordering is unchanged.
    return { regex: null, negate };
  }
}

function matchesIgnorePattern(regex: RegExp, rel: string, base: string): boolean {
  return regex.test(rel) || regex.test(base);
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

  const evaluateIgnore = (filePath: string): boolean => {
    const normalized = filePath.replace(/\\/g, '/');
    const rel = projectRoot ? relative(projectRoot, filePath).replace(/\\/g, '/') : normalized;
    const base = normalized.split('/').pop() ?? '';

    // Security invariant: every builtin except `.env.*` hard-denies on match
    // and can never be re-included by any user rule. `.env.*` is only a
    // baseline deny (exact safe templates exempt) and may be lifted by explicit
    // agent policy (.agentignore / user-global / runtime) — never by .gitignore.
    let envStarBaseline = false;
    for (const pattern of rules.builtinPatterns) {
      const { regex } = parseIgnorePattern(pattern);
      if (!regex || !matchesIgnorePattern(regex, rel, base)) continue;
      if (pattern === BUILTIN_ENV_TEMPLATE_PATTERN) {
        envStarBaseline = !SAFE_ENV_TEMPLATE_BASENAMES.has(base);
        continue;
      }
      return true;
    }

    let decision = envStarBaseline;

    // While the `.env.*` baseline holds, `.gitignore` matches — positive or
    // negated — must not change the decision, so this layer is skipped whole.
    if (!envStarBaseline) {
      for (const pattern of rules.gitignorePatterns) {
        const { regex, negate } = parseIgnorePattern(pattern);
        if (regex && matchesIgnorePattern(regex, rel, base)) decision = !negate;
      }
    }

    const agentPolicyPatterns = [
      ...rules.agentignorePatterns,
      ...rules.userGlobalPatterns,
      ...runtimePatterns,
    ];
    for (const pattern of agentPolicyPatterns) {
      const { regex, negate } = parseIgnorePattern(pattern);
      if (regex && matchesIgnorePattern(regex, rel, base)) decision = !negate;
    }
    return decision;
  };

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
      return evaluateIgnore(filePath);
    },

    async listIgnored(dir: string): Promise<string[]> {
      const ignored: string[] = [];
      async function walk(d: string) {
        let entries: { name: string; isDirectory(): boolean }[];
        try {
          entries = await fs.readdir(d, { withFileTypes: true });
        } catch {
          return;
        }
        for (const entry of entries) {
          const full = join(d, entry.name);
          if (evaluateIgnore(full)) {
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
