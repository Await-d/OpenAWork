import { describe, expect, it } from 'vitest';
import { computeCommonPathPrefix, splitPathParts, stripPathPrefix } from './path-display.js';

describe('computeCommonPathPrefix', () => {
  it('returns empty for fewer than 2 paths', () => {
    expect(computeCommonPathPrefix([])).toBe('');
    expect(computeCommonPathPrefix(['a/b/c.ts'])).toBe('');
  });

  it('returns empty when there is no shared directory', () => {
    expect(computeCommonPathPrefix(['a/x.ts', 'b/y.ts'])).toBe('');
  });

  it('finds the deepest shared directory across two POSIX paths', () => {
    expect(computeCommonPathPrefix(['src/components/a.ts', 'src/components/b.ts'])).toBe(
      'src/components/',
    );
  });

  it('preserves the leading slash for absolute paths', () => {
    expect(
      computeCommonPathPrefix(['/home/await/project/x/a.ts', '/home/await/project/x/b.ts']),
    ).toBe('/home/await/project/x/');
  });

  it('never strips a filename even if every path has the same name', () => {
    // Two different directories that happen to share `index.ts` — the
    // filename must NOT be folded into the prefix.
    const prefix = computeCommonPathPrefix(['src/a/index.ts', 'src/b/index.ts']);
    expect(prefix).toBe('src/');
  });

  it('compares whole segments, not character substrings', () => {
    // `src/foo.ts` and `src/foobar.ts` share characters `src/foo` but
    // not a directory segment past `src/`.
    expect(computeCommonPathPrefix(['src/foo.ts', 'src/foobar.ts'])).toBe('src/');
  });

  it('normalises backslashes to forward slashes', () => {
    expect(computeCommonPathPrefix(['src\\a\\x.ts', 'src\\a\\y.ts'])).toBe('src/a/');
  });

  it('returns empty when one path is a single filename (no directory)', () => {
    // "x.ts" has 0 directory segments — the shared directory depth is 0.
    expect(computeCommonPathPrefix(['x.ts', 'src/y.ts'])).toBe('');
  });
});

describe('stripPathPrefix', () => {
  it('removes the prefix when present', () => {
    expect(stripPathPrefix('src/components/a.ts', 'src/')).toBe('components/a.ts');
  });

  it('returns the path unchanged when prefix is missing', () => {
    expect(stripPathPrefix('apps/web/a.ts', 'src/')).toBe('apps/web/a.ts');
  });

  it('returns the path unchanged when prefix is empty', () => {
    expect(stripPathPrefix('apps/web/a.ts', '')).toBe('apps/web/a.ts');
  });

  it('normalises backslashes before comparing', () => {
    expect(stripPathPrefix('src\\a\\x.ts', 'src/')).toBe('a/x.ts');
  });
});

describe('splitPathParts', () => {
  it('splits a path into directory and filename', () => {
    expect(splitPathParts('src/components/a.ts')).toEqual({
      dir: 'src/components/',
      name: 'a.ts',
    });
  });

  it('treats a bare filename as having no directory', () => {
    expect(splitPathParts('a.ts')).toEqual({ dir: '', name: 'a.ts' });
  });

  it('normalises backslashes', () => {
    expect(splitPathParts('src\\a\\x.ts')).toEqual({
      dir: 'src/a/',
      name: 'x.ts',
    });
  });

  it('handles trailing-slash directories by treating them as no-name', () => {
    // `splitPathParts` is filename-oriented — a trailing slash is
    // interpreted as "the dir is everything before the last /, the name
    // is empty". Callers shouldn't pass directories here, but the helper
    // must not throw on the edge case.
    expect(splitPathParts('src/foo/')).toEqual({ dir: 'src/foo/', name: '' });
  });
});
