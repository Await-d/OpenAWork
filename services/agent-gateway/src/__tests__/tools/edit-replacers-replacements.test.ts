import { describe, expect, it } from 'vitest';
import { fuzzyReplace } from '../../tools/edit-replacers.js';

describe('fuzzyReplace replacement counting', () => {
  it('reports the true count for an exact-match replaceAll', () => {
    const content = 'foo\nfoo\nfoo\n';
    const result = fuzzyReplace(content, 'foo', 'bar', true);

    expect(result.content).toBe('bar\nbar\nbar\n');
    expect(result.replacements).toBe(3);
  });

  it('reports 1 for a single (non-replaceAll) replacement', () => {
    const content = 'alpha\nbeta\n';
    const result = fuzzyReplace(content, 'beta', 'gamma', false);

    expect(result.content).toBe('alpha\ngamma\n');
    expect(result.replacements).toBe(1);
  });

  it('counts the resolved fuzzy-matched string, not the caller oldString', () => {
    // The file uses two spaces; the caller passes a single space. Level 1
    // (exact) cannot match, so the whitespace-normalizing replacer resolves
    // `search` to the real "foo  bar". Counting the caller's "foo bar" would
    // yield 0 and previously degraded to a hardcoded 1.
    const content = 'foo  bar\nfoo  bar\n';
    expect(content.includes('foo bar')).toBe(false);

    const result = fuzzyReplace(content, 'foo bar', 'baz', true);

    expect(result.content).toBe('baz\nbaz\n');
    expect(result.replacements).toBe(2);
  });

  it('never reports 0 replacements on a successful replace', () => {
    const content = 'foo  bar\n';
    const result = fuzzyReplace(content, 'foo bar', 'baz', true);

    expect(result.replacements).toBeGreaterThanOrEqual(1);
  });

  it('throws when oldString equals newString', () => {
    expect(() => fuzzyReplace('foo\n', 'foo', 'foo', true)).toThrow(/No changes to apply/u);
  });

  it('throws when oldString cannot be found at all', () => {
    expect(() => fuzzyReplace('foo\n', 'nonexistent-token', 'bar', true)).toThrow(
      /Could not find oldString/u,
    );
  });
});
