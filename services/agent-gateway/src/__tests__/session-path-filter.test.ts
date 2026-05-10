/**
 * Regression coverage for `session-path-filter.ts`.
 *
 * The path-matching rules are subtle enough that we pin them
 * explicitly rather than rely on the route-level integration test:
 *
 *   - prefix match must use `<path><sep>` so `/a` doesn't match `/abc`
 *   - exact match (includeDescendants=false) is opt-in
 *   - missing / blank `workingDirectory` never matches
 *   - blank filter path is treated as "no filter" — the helper
 *     returns the input untouched
 *   - paths are normalised (resolved + trailing-slash stripped)
 */

import { describe, expect, it } from 'vitest';

import {
  filterSessionsByPath,
  normaliseFilterPath,
  sessionMatchesPath,
  type PathFilterableSession,
} from '../session-path-filter.js';

function makeRow(id: string, workingDirectory: string | undefined): PathFilterableSession {
  const metadata: Record<string, unknown> = {};
  if (workingDirectory !== undefined) metadata['workingDirectory'] = workingDirectory;
  return { id, metadata_json: JSON.stringify(metadata) };
}

describe('normaliseFilterPath', () => {
  it('returns empty for blank input', () => {
    expect(normaliseFilterPath('')).toBe('');
    expect(normaliseFilterPath('  ')).toBe('');
  });

  it('resolves to an absolute path', () => {
    expect(normaliseFilterPath('/a/b')).toBe('/a/b');
  });

  it('strips a trailing separator on non-root paths', () => {
    expect(normaliseFilterPath('/a/b/')).toBe('/a/b');
  });

  it('keeps the root separator', () => {
    expect(normaliseFilterPath('/')).toBe('/');
  });
});

describe('sessionMatchesPath — descendants (default)', () => {
  it('matches an exact directory', () => {
    expect(sessionMatchesPath(makeRow('s1', '/projects/app'), { path: '/projects/app' })).toBe(
      true,
    );
  });

  it('matches a true descendant', () => {
    expect(sessionMatchesPath(makeRow('s1', '/projects/app/src'), { path: '/projects/app' })).toBe(
      true,
    );
  });

  it('does NOT match a sibling whose name shares the prefix (the "/a vs /abc" guard)', () => {
    expect(sessionMatchesPath(makeRow('s1', '/projects/app2'), { path: '/projects/app' })).toBe(
      false,
    );
    expect(sessionMatchesPath(makeRow('s1', '/abc'), { path: '/a' })).toBe(false);
  });

  it('does not match when the session has no workingDirectory', () => {
    expect(sessionMatchesPath(makeRow('s1', undefined), { path: '/projects' })).toBe(false);
  });

  it('does not match when the workingDirectory is blank', () => {
    expect(sessionMatchesPath(makeRow('s1', ''), { path: '/projects' })).toBe(false);
  });

  it('handles trailing-slash normalisation symmetrically', () => {
    expect(sessionMatchesPath(makeRow('s1', '/projects/app/'), { path: '/projects/app' })).toBe(
      true,
    );
    expect(sessionMatchesPath(makeRow('s1', '/projects/app'), { path: '/projects/app/' })).toBe(
      true,
    );
  });
});

describe('sessionMatchesPath — strict (includeDescendants=false)', () => {
  it('matches the exact directory only', () => {
    expect(
      sessionMatchesPath(makeRow('s1', '/projects/app'), {
        path: '/projects/app',
        includeDescendants: false,
      }),
    ).toBe(true);
  });

  it('refuses descendants', () => {
    expect(
      sessionMatchesPath(makeRow('s1', '/projects/app/src'), {
        path: '/projects/app',
        includeDescendants: false,
      }),
    ).toBe(false);
  });

  it('still rejects the prefix-collision case', () => {
    expect(
      sessionMatchesPath(makeRow('s1', '/projects/app2'), {
        path: '/projects/app',
        includeDescendants: false,
      }),
    ).toBe(false);
  });
});

describe('filterSessionsByPath — list level', () => {
  const rows = [
    makeRow('a', '/projects/app'),
    makeRow('b', '/projects/app/src'),
    makeRow('c', '/projects/other'),
    makeRow('d', undefined),
    makeRow('e', '/projects/app2'),
  ];

  it('keeps only matching rows when descendants are included', () => {
    const filtered = filterSessionsByPath(rows, { path: '/projects/app' });
    expect(filtered.map((row) => row.id)).toEqual(['a', 'b']);
  });

  it('keeps only the exact match when descendants are excluded', () => {
    const filtered = filterSessionsByPath(rows, {
      path: '/projects/app',
      includeDescendants: false,
    });
    expect(filtered.map((row) => row.id)).toEqual(['a']);
  });

  it('returns the input unchanged when path is blank', () => {
    expect(filterSessionsByPath(rows, { path: '' })).toBe(rows);
    expect(filterSessionsByPath(rows, { path: '   ' })).toBe(rows);
  });

  it('preserves the input order', () => {
    const filtered = filterSessionsByPath(rows, { path: '/projects' });
    expect(filtered.map((row) => row.id)).toEqual(['a', 'b', 'c', 'e']);
  });

  it('handles malformed metadata_json by treating the row as no-workingDirectory', () => {
    const broken = [
      ...rows,
      { id: 'broken', metadata_json: 'not-json' } satisfies PathFilterableSession,
    ];
    const filtered = filterSessionsByPath(broken, { path: '/projects/app' });
    expect(filtered.map((row) => row.id)).toEqual(['a', 'b']);
  });
});
