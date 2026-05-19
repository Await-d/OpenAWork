import { describe, expect, it } from 'vitest';
import { resolveToolCallCardDisplayData } from './ToolCallCard.js';

/**
 * `apply_patch` (and write/edit/multi_edit) outputs are object envelopes
 * that get JSON-stringified during agent-gateway storage. The UI receives
 * the encoded string, so the diff resolver has to recover the structured
 * shape before it can produce a real diff view — otherwise the user sees
 * a 4KB raw JSON dump in the generic ExpandableOutput fallback.
 */
describe('resolveToolCallCardDisplayData diffView (JSON-encoded envelope recovery)', () => {
  it('recovers a single-file apply_patch envelope from a JSON string', () => {
    const output = JSON.stringify({
      success: true,
      files: [
        {
          action: 'update',
          path: '/repo/src/foo.ts',
          before: 'const a = 1;\n',
          after: 'const a = 2;\n',
          additions: 1,
          deletions: 1,
          status: 'modified',
        },
      ],
    });

    const data = resolveToolCallCardDisplayData({
      toolName: 'apply_patch',
      input: { patchText: '...' },
      output,
    });

    expect(data.diffView).toBeDefined();
    expect(data.diffView?.filePath).toBe('/repo/src/foo.ts');
    // `readNonEmptyString` trims surrounding whitespace, so the trailing
    // `\n` is not preserved — that's fine for the diff renderer which
    // re-splits on `\n` regardless.
    expect(data.diffView?.beforeText).toBe('const a = 1;');
    expect(data.diffView?.afterText).toBe('const a = 2;');
    // Single-file branch produces beforeText/afterText, not files[].
    expect(data.diffView?.files).toBeUndefined();
  });

  it('recovers a multi-file apply_patch envelope from a JSON string', () => {
    const output = JSON.stringify({
      success: true,
      files: [
        {
          action: 'update',
          path: '/repo/a.ts',
          before: 'old a\n',
          after: 'new a\n',
          additions: 1,
          deletions: 1,
        },
        {
          action: 'add',
          path: '/repo/b.ts',
          before: '',
          after: 'new file\n',
          additions: 1,
          deletions: 0,
        },
      ],
    });

    const data = resolveToolCallCardDisplayData({
      toolName: 'apply_patch',
      input: { patchText: '...' },
      output,
    });

    expect(data.diffView?.files).toHaveLength(2);
    expect(data.diffView?.summary).toContain('2 个文件');
  });

  it('does not parse JSON for bash-style string outputs', () => {
    // Strings that don't begin/end with `{` or `[` should never enter
    // JSON.parse — protects bash/grep stdout from being mis-detected.
    const data = resolveToolCallCardDisplayData({
      toolName: 'bash',
      input: { command: 'echo hi' },
      output: 'hi\n',
    });
    expect(data.diffView).toBeUndefined();
  });

  it('falls through gracefully on malformed JSON', () => {
    const data = resolveToolCallCardDisplayData({
      toolName: 'apply_patch',
      input: { patchText: '...' },
      output: '{ this is not valid json',
    });
    expect(data.diffView).toBeUndefined();
  });

  it('still recognises raw unified-diff string output', () => {
    const diff = `diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+new\n`;
    const data = resolveToolCallCardDisplayData({
      toolName: 'apply_patch',
      input: { patchText: '...' },
      output: diff,
    });
    expect(data.diffView).toBeDefined();
    expect(data.diffView?.diffText).toBe(diff.trim());
  });
});
