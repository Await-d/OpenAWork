/**
 * Tests for `collectDeadCodeDiagnostics` + `formatDeadCodeCandidates`
 * (T-DEAD-01 / T-DEAD-02 / T-DEAD-04, workflow 260509).
 *
 * The slash command's contract with users is "we delete what the LSP
 * proves dead, nothing else". These tests pin the allowlist behaviour
 * — anything outside the curated diagnostic-code set must fall through
 * — plus the deterministic ordering / cap / failure-tolerance the
 * executor relies on.
 */

import { describe, expect, it } from 'vitest';

import {
  collectDeadCodeDiagnostics,
  DEFAULT_DEAD_CODE_CODES,
  formatDeadCodeCandidates,
  type DiagnosticLike,
} from '../dead-code-diagnostics.js';

function fixture(
  partial: Partial<DiagnosticLike> & Pick<DiagnosticLike, 'severity' | 'message'>,
): DiagnosticLike {
  return {
    line: 1,
    col: 1,
    ...partial,
  };
}

describe('collectDeadCodeDiagnostics — allowlist', () => {
  it('keeps only entries whose code is in the curated dead-code set', async () => {
    const out = await collectDeadCodeDiagnostics({
      fetchDiagnostics: async () => ({
        '/repo/a.ts': [
          fixture({
            severity: 'error',
            line: 5,
            col: 9,
            message: "'foo' is declared but never used.",
            source: 'typescript',
            code: 6133,
          }),
          fixture({
            severity: 'warning',
            line: 99,
            col: 1,
            message: 'deprecated API',
            source: 'typescript',
            // Not in the dead-code allowlist — must NOT be returned.
            code: 6385,
          }),
        ],
        '/repo/b.py': [
          fixture({
            severity: 'warning',
            line: 1,
            col: 1,
            message: "'os' imported but unused",
            source: 'pyflakes',
            code: 'F401',
          }),
        ],
      }),
    });
    expect(out.map((c) => c.code)).toEqual([6133, 'F401']);
    expect(out[0]).toMatchObject({
      file: '/repo/a.ts',
      line: 5,
      col: 9,
      source: 'typescript',
    });
  });

  it('skips entries that have no `code` field', async () => {
    const out = await collectDeadCodeDiagnostics({
      fetchDiagnostics: async () => ({
        '/repo/a.ts': [
          fixture({
            severity: 'error',
            line: 1,
            col: 1,
            message: 'untyped diagnostic',
            // code intentionally omitted
          }),
        ],
      }),
    });
    expect(out).toEqual([]);
  });

  it('skips informational / hint entries even when the code matches', async () => {
    // Some linters (notably ruff) emit hint-severity copies of dead
    // code messages for fix suggestions. We must not delete based on
    // those — only error / warning carry "definitely dead" intent.
    const out = await collectDeadCodeDiagnostics({
      fetchDiagnostics: async () => ({
        '/repo/a.ts': [
          fixture({
            severity: 'hint',
            line: 1,
            col: 1,
            message: 'consider removing unused import',
            code: 'F401',
          }),
          fixture({
            severity: 'information',
            line: 2,
            col: 1,
            message: 'unused suggestion',
            code: 6133,
          }),
        ],
      }),
    });
    expect(out).toEqual([]);
  });

  it('honours an injected custom allowlist', async () => {
    const custom = new Set<string | number>([6133]);
    const out = await collectDeadCodeDiagnostics({
      allowedCodes: custom,
      fetchDiagnostics: async () => ({
        '/repo/a.ts': [
          fixture({
            severity: 'error',
            line: 1,
            col: 1,
            message: 'TS6133',
            code: 6133,
          }),
          fixture({
            severity: 'error',
            line: 2,
            col: 1,
            message: 'F401',
            code: 'F401',
          }),
        ],
      }),
    });
    // Only TS6133 should survive when the user trims the set.
    expect(out.map((c) => c.code)).toEqual([6133]);
  });
});

describe('collectDeadCodeDiagnostics — ordering & cap', () => {
  it('returns candidates sorted by file → line → col', async () => {
    const out = await collectDeadCodeDiagnostics({
      fetchDiagnostics: async () => ({
        '/repo/zzz.ts': [
          fixture({ severity: 'error', line: 1, col: 1, message: 'z1', code: 6133 }),
        ],
        '/repo/aaa.ts': [
          fixture({ severity: 'error', line: 5, col: 1, message: 'a5', code: 6133 }),
          fixture({ severity: 'error', line: 5, col: 9, message: 'a5col9', code: 6133 }),
          fixture({ severity: 'error', line: 1, col: 1, message: 'a1', code: 6133 }),
        ],
      }),
    });
    expect(out.map((c) => `${c.file}:${c.line}:${c.col}`)).toEqual([
      '/repo/aaa.ts:1:1',
      '/repo/aaa.ts:5:1',
      '/repo/aaa.ts:5:9',
      '/repo/zzz.ts:1:1',
    ]);
  });

  it('caps the result at maxCandidates and bails early', async () => {
    const out = await collectDeadCodeDiagnostics({
      maxCandidates: 2,
      fetchDiagnostics: async () => ({
        '/repo/a.ts': Array.from({ length: 10 }, (_, i) =>
          fixture({
            severity: 'error',
            line: i + 1,
            col: 1,
            message: `m${i}`,
            code: 6133,
          }),
        ),
      }),
    });
    expect(out).toHaveLength(2);
  });
});

describe('collectDeadCodeDiagnostics — fault tolerance', () => {
  it('returns empty when the diagnostics fetcher throws', async () => {
    const out = await collectDeadCodeDiagnostics({
      fetchDiagnostics: async () => {
        throw new Error('LSP layer offline');
      },
    });
    expect(out).toEqual([]);
  });

  it('ignores files whose summary array is malformed', async () => {
    const out = await collectDeadCodeDiagnostics({
      fetchDiagnostics: async () =>
        ({
          '/repo/ok.ts': [
            fixture({ severity: 'error', line: 1, col: 1, message: 'ok', code: 6133 }),
          ],
          // The lsp-client typing guarantees array, but a buggy
          // adapter could pass through `null`/`undefined`. Helper
          // must skip without throwing.
          '/repo/broken.ts': null as unknown as DiagnosticLike[],
        }) as Record<string, DiagnosticLike[]>,
    });
    expect(out.map((c) => c.file)).toEqual(['/repo/ok.ts']);
  });
});

describe('formatDeadCodeCandidates', () => {
  it('renders a placeholder when there are no candidates', () => {
    expect(formatDeadCodeCandidates([])).toContain('未报告');
  });

  it('groups by file and includes diagnostic code + source tag', () => {
    const out = formatDeadCodeCandidates([
      {
        file: '/repo/a.ts',
        line: 5,
        col: 9,
        message: 'X is declared but never used',
        code: 6133,
        source: 'typescript',
      },
      {
        file: '/repo/b.py',
        line: 1,
        col: 1,
        message: "'os' imported but unused",
        code: 'F401',
        source: 'pyflakes',
      },
    ]);
    expect(out).toContain('共 2 条');
    expect(out).toContain('## /repo/a.ts');
    expect(out).toContain('5:9 [typescript](6133)');
    expect(out).toContain('## /repo/b.py');
    expect(out).toContain("1:1 [pyflakes](F401) 'os' imported but unused");
  });
});

describe('DEFAULT_DEAD_CODE_CODES', () => {
  it('contains the headline TS / Python / ESLint codes the workflow promises', () => {
    // Spot-check the contract with the workflow doc — anyone trimming
    // these without updating the workflow plan is the regression we
    // want to catch.
    expect(DEFAULT_DEAD_CODE_CODES.has(6133)).toBe(true);
    expect(DEFAULT_DEAD_CODE_CODES.has(6196)).toBe(true);
    expect(DEFAULT_DEAD_CODE_CODES.has('F401')).toBe(true);
    expect(DEFAULT_DEAD_CODE_CODES.has('F841')).toBe(true);
    expect(DEFAULT_DEAD_CODE_CODES.has('no-unused-vars')).toBe(true);
    expect(DEFAULT_DEAD_CODE_CODES.has('unused-imports/no-unused-imports')).toBe(true);
  });
});
