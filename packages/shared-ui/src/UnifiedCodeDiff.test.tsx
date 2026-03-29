import { describe, expect, it } from 'vitest';
import {
  parseUnifiedDiffRows,
  summarizeUnifiedDiff,
  toUnifiedDisplayRows,
} from './UnifiedCodeDiff.js';

const SAMPLE_DIFF = [
  'diff --git a/src/example.ts b/src/example.ts',
  '--- a/src/example.ts',
  '+++ b/src/example.ts',
  '@@ -1,3 +1,4 @@',
  ' const a = 1;',
  '-const b = 2;',
  '+const b = 3;',
  '+const c = 4;',
  ' export { a, b };',
].join('\n');

describe('UnifiedCodeDiff', () => {
  it('summarizes additions and removals from unified diff text', () => {
    expect(summarizeUnifiedDiff(SAMPLE_DIFF)).toEqual({ added: 2, removed: 1 });
  });

  it('parses unified diff rows into aligned left/right changes', () => {
    const rows = parseUnifiedDiffRows(SAMPLE_DIFF);
    expect(rows.some((row) => row.type === 'hunk')).toBe(true);
    expect(rows).toContainEqual(
      expect.objectContaining({
        type: 'change',
        left: expect.objectContaining({ kind: 'removed', lineNumber: 2, text: 'const b = 2;' }),
        right: expect.objectContaining({ kind: 'added', lineNumber: 2, text: 'const b = 3;' }),
      }),
    );
    expect(rows).toContainEqual(
      expect.objectContaining({
        type: 'change',
        left: expect.objectContaining({ kind: 'empty' }),
        right: expect.objectContaining({ kind: 'added', lineNumber: 3, text: 'const c = 4;' }),
      }),
    );
  });

  it('derives unified rows with separate remove/add entries', () => {
    const unifiedRows = toUnifiedDisplayRows(parseUnifiedDiffRows(SAMPLE_DIFF));
    expect(unifiedRows).toContainEqual(
      expect.objectContaining({ kind: 'removed', leftLine: 2, text: 'const b = 2;' }),
    );
    expect(unifiedRows).toContainEqual(
      expect.objectContaining({ kind: 'added', rightLine: 2, text: 'const b = 3;' }),
    );
  });
});
