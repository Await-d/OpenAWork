import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type * as WorkspaceToolsModule from '../../tools/workspace-tools.js';

const state = vi.hoisted(() => ({ workspaceRoot: '' }));

const mocks = vi.hoisted(() => ({
  sqliteAll: vi.fn(() => []),
  sqliteGet: vi.fn(() => undefined),
  sqliteRun: vi.fn(),
}));

vi.mock('../../infra/db.js', () => ({
  WORKSPACE_ACCESS_RESTRICTED: false,
  get WORKSPACE_ROOT() {
    return state.workspaceRoot;
  },
  get WORKSPACE_ROOTS() {
    return [state.workspaceRoot];
  },
  sqliteAll: mocks.sqliteAll,
  sqliteGet: mocks.sqliteGet,
  sqliteRun: mocks.sqliteRun,
  sqliteRunWithRowId: vi.fn(() => 1),
}));

const TIME_BUDGET_TRUNCATION_NOTICE = '...[truncated: 已达时间预算，结果可能不完整]';
const PRUNED_DIRECTORIES = ['.vs', '.idea', '.omo', '.venv', 'target', 'coverage'] as const;

let fixtureRoot: string;
let executeGlobTool: (typeof WorkspaceToolsModule)['executeGlobTool'];
let executeGrepTool: (typeof WorkspaceToolsModule)['executeGrepTool'];
let globTool: (typeof WorkspaceToolsModule)['globTool'];
let grepTool: (typeof WorkspaceToolsModule)['grepTool'];
let GLOB_TIME_BUDGET_MS: (typeof WorkspaceToolsModule)['GLOB_TIME_BUDGET_MS'];
let GREP_TIME_BUDGET_MS: (typeof WorkspaceToolsModule)['GREP_TIME_BUDGET_MS'];
let restoreDateNow: (() => void) | null = null;

function writeFixtureFile(relativePath: string, content: string): string {
  const filePath = join(fixtureRoot, relativePath);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, 'utf8');
  return filePath;
}

/**
 * Every Date.now() call jumps one full budget further than the previous call,
 * so whichever call produces the deadline, the next budget check is already
 * exhausted — deterministic truncation without waiting real milliseconds.
 */
function installExhaustedClock(budgetMs: number): void {
  let clock = 1_000_000;
  const spy = vi.spyOn(Date, 'now').mockImplementation(() => {
    clock += budgetMs + 1;
    return clock;
  });
  restoreDateNow = () => {
    spy.mockRestore();
  };
}

beforeAll(async () => {
  fixtureRoot = mkdtempSync(join(tmpdir(), 'openawork-wt-search-budget-'));
  state.workspaceRoot = fixtureRoot;

  mkdirSync(join(fixtureRoot, 'empty-dir'));

  writeFixtureFile(join('normal-glob', 'only.txt'), 'hello globe\n');
  writeFixtureFile(join('normal-grep', 'sample.txt'), 'hello grep\nsecond line\n');

  for (const directory of PRUNED_DIRECTORIES) {
    writeFixtureFile(join('prune', directory, 'artifact.txt'), 'PRUNED_MARKER\n');
  }
  writeFixtureFile(join('prune', 'kept', 'visible.txt'), 'KEPT_MARKER\n');

  writeFixtureFile(join('bin-committed', 'bin', 'hello.js'), "console.log('hi');\n");
  writeFixtureFile(join('bin-committed', 'src', 'app.ts'), 'export const value = 1;\n');

  writeFixtureFile(join('budget-glob', 'aaa-match.txt'), 'match\n');
  for (let layer = 0; layer < 30; layer += 1) {
    const name = `layer-${String(layer).padStart(2, '0')}`;
    writeFixtureFile(join('budget-glob', name, `part-${name}.txt`), 'match\n');
    writeFixtureFile(join('budget-grep', name, `part-${name}.txt`), `needle-${layer}\n`);
  }

  const tools = await import('../../tools/workspace-tools.js');
  executeGlobTool = tools.executeGlobTool;
  executeGrepTool = tools.executeGrepTool;
  globTool = tools.globTool;
  grepTool = tools.grepTool;
  GLOB_TIME_BUDGET_MS = tools.GLOB_TIME_BUDGET_MS;
  GREP_TIME_BUDGET_MS = tools.GREP_TIME_BUDGET_MS;
});

afterEach(() => {
  restoreDateNow?.();
  restoreDateNow = null;
});

afterAll(() => {
  rmSync(fixtureRoot, { recursive: true, force: true });
});

describe('ignored-name traversal pruning', () => {
  it('prunes .vs/.idea/.omo/.venv/target/coverage and keeps real source', async () => {
    const pruneRoot = join(fixtureRoot, 'prune');
    const result = await executeGlobTool({ path: pruneRoot, pattern: '**/*' });

    expect(result).toContain(join(pruneRoot, 'kept', 'visible.txt'));
    for (const directory of PRUNED_DIRECTORIES) {
      expect(result).not.toContain(join(pruneRoot, directory));
    }
    expect(result).not.toContain(TIME_BUDGET_TRUNCATION_NOTICE);
  });

  it('prunes the same directories from grep', async () => {
    const pruneRoot = join(fixtureRoot, 'prune');

    expect(
      await executeGrepTool({
        path: pruneRoot,
        pattern: 'PRUNED_MARKER',
        output_mode: 'files_with_matches',
        head_limit: 10,
      }),
    ).toBe('No files found');
    expect(
      await executeGrepTool({
        path: pruneRoot,
        pattern: 'KEPT_MARKER',
        output_mode: 'files_with_matches',
        head_limit: 10,
      }),
    ).toBe(join(pruneRoot, 'kept', 'visible.txt'));
  });

  it('does not prune a committed bin/ directory', async () => {
    const binRoot = join(fixtureRoot, 'bin-committed');

    expect(await executeGlobTool({ path: binRoot, pattern: '**/*.js' })).toBe(
      join(binRoot, 'bin', 'hello.js'),
    );
    expect(
      await executeGrepTool({
        path: binRoot,
        pattern: 'console\\.log',
        output_mode: 'content',
        head_limit: 10,
      }),
    ).toBe(`${join(binRoot, 'bin', 'hello.js')}:1: console.log('hi');`);
  });
});

describe('partial results on time-budget exhaustion', () => {
  it('returns partial glob matches plus the truncation notice instead of empty output', async () => {
    installExhaustedClock(GLOB_TIME_BUDGET_MS);
    const budgetRoot = join(fixtureRoot, 'budget-glob');

    const result = await executeGlobTool({ path: budgetRoot, pattern: '**/*.txt' });

    expect(result).not.toBe('No files found');
    expect(result).toContain(join(budgetRoot, 'aaa-match.txt'));
    expect(result.endsWith(TIME_BUDGET_TRUNCATION_NOTICE)).toBe(true);
    // The nested layers were never reached — the walk stopped on budget.
    expect(result).not.toContain('layer-');
  });

  it('returns partial grep matches plus the truncation notice instead of empty output', async () => {
    installExhaustedClock(GREP_TIME_BUDGET_MS);
    const budgetRoot = join(fixtureRoot, 'budget-grep');

    const result = await executeGrepTool({
      path: budgetRoot,
      pattern: 'needle',
      output_mode: 'content',
      head_limit: 10,
    });

    expect(result).not.toBe('No files found');
    expect(result).toMatch(/:1: needle-\d+\n/u);
    expect(result.endsWith(TIME_BUDGET_TRUNCATION_NOTICE)).toBe(true);
    // A single partial match was collected before the walk stopped.
    expect(result.split('\n')).toHaveLength(2);
  });

  it('appends the truncation notice when the budget expires before any match', async () => {
    installExhaustedClock(GLOB_TIME_BUDGET_MS);
    const budgetRoot = join(fixtureRoot, 'budget-glob');

    const result = await executeGlobTool({ path: budgetRoot, pattern: '*.cs' });

    expect(result).toBe(`No files found\n${TIME_BUDGET_TRUNCATION_NOTICE}`);
  });
});

describe('normal completion output is unchanged', () => {
  it('returns the legacy exact outputs when no budget is exceeded', async () => {
    const emptyDir = join(fixtureRoot, 'empty-dir');
    const globRoot = join(fixtureRoot, 'normal-glob');
    const globOnly = join(globRoot, 'only.txt');
    const grepRoot = join(fixtureRoot, 'normal-grep');
    const grepFile = join(grepRoot, 'sample.txt');

    expect(await executeGlobTool({ path: emptyDir, pattern: '**/*' })).toBe('No files found');
    expect(
      await executeGrepTool({
        path: emptyDir,
        pattern: 'anything',
        output_mode: 'files_with_matches',
        head_limit: 10,
      }),
    ).toBe('No files found');
    expect(await executeGlobTool({ path: globRoot, pattern: '*.txt' })).toBe(globOnly);
    expect(
      await executeGrepTool({
        path: grepRoot,
        pattern: 'hello',
        output_mode: 'content',
        head_limit: 10,
      }),
    ).toBe(`${grepFile}:1: hello grep`);
    expect(
      await executeGrepTool({
        path: grepRoot,
        pattern: 'hello',
        output_mode: 'files_with_matches',
        head_limit: 10,
      }),
    ).toBe(grepFile);
    expect(
      await executeGrepTool({
        path: grepRoot,
        pattern: 'line',
        output_mode: 'count',
        head_limit: 10,
      }),
    ).toBe(`${grepFile}: 1`);
  });
});

describe('internal time budgets', () => {
  it('stay below the externally enforced tool timeouts', () => {
    expect(GLOB_TIME_BUDGET_MS).toBeGreaterThan(0);
    expect(globTool.timeout ?? 0).toBeGreaterThan(GLOB_TIME_BUDGET_MS);
    expect(GREP_TIME_BUDGET_MS).toBeGreaterThan(0);
    expect(grepTool.timeout ?? 0).toBeGreaterThan(GREP_TIME_BUDGET_MS);
  });
});
