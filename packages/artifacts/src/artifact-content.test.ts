import { describe, expect, it } from 'vitest';
import {
  buildArtifactPreviewSnippet,
  computeArtifactLineDiff,
  detectArtifactContentType,
} from './artifact-content.js';

describe('artifact content helpers', () => {
  it('detects by file name and mime type first', () => {
    expect(
      detectArtifactContentType({
        content: 'const x = 1;',
        fileName: 'diagram.svg',
      }),
    ).toBe('svg');

    expect(
      detectArtifactContentType({
        content: '# hello',
        mimeType: 'text/markdown',
      }),
    ).toBe('markdown');
  });

  it('detects html, react, mermaid, csv, markdown, and code from content', () => {
    expect(
      detectArtifactContentType({ content: '<!doctype html><html><body>hi</body></html>' }),
    ).toBe('html');
    expect(
      detectArtifactContentType({
        content:
          "import React from 'react'; export default function Demo() { return (<div>ok</div>); }",
      }),
    ).toBe('react');
    expect(detectArtifactContentType({ content: 'graph TD\nA-->B' })).toBe('mermaid');
    expect(detectArtifactContentType({ content: 'name,age\nA,1\nB,2' })).toBe('csv');
    expect(detectArtifactContentType({ content: '# Title\n\n- item' })).toBe('markdown');
    expect(detectArtifactContentType({ content: 'const answer = 42;' })).toBe('code');
  });

  it('builds preview snippets with truncation', () => {
    expect(buildArtifactPreviewSnippet('')).toBeUndefined();
    expect(buildArtifactPreviewSnippet('hello', 10)).toBe('hello');
    expect(buildArtifactPreviewSnippet('abcdefghijk', 5)).toBe('abcde\n…');
  });

  it('computes line-level diff for modified, added, and removed lines', () => {
    expect(computeArtifactLineDiff('a\nb', 'a\nc\nd')).toEqual([
      { lineNumber: 2, kind: 'modified', before: 'b', after: 'c' },
      { lineNumber: 3, kind: 'added', after: 'd' },
    ]);

    expect(computeArtifactLineDiff('a\nb', 'a')).toEqual([
      { lineNumber: 2, kind: 'removed', before: 'b' },
    ]);
  });
});
