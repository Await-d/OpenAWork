import { describe, expect, it } from 'vitest';
import { transformAsciiDiagrams } from './transform-ascii-diagrams.js';

describe('transformAsciiDiagrams', () => {
  it('passes through content with no box-drawing characters', () => {
    const input = 'Hello, **world**.\n\n```ts\nconst x = 1;\n```';
    expect(transformAsciiDiagrams(input)).toBe(input);
  });

  it('wraps a run of box-drawing lines in a `text` fenced block', () => {
    const input = [
      'Before paragraph.',
      '',
      '┌─────────────┐    ┌─────────────┐',
      '│  Web (Vue)  │ →  │  API (.NET) │',
      '└─────────────┘    └─────────────┘',
      '',
      'After paragraph.',
    ].join('\n');

    const output = transformAsciiDiagrams(input);

    expect(output).toContain('````text');
    expect(output).toContain('│  Web (Vue)  │');
    expect(output).toContain('└─────────────┘    └─────────────┘');
    // Diagram is wrapped exactly once
    expect(output.match(/````text/g)?.length ?? 0).toBe(1);
    // Closing fence appears
    expect(output).toMatch(/└─────────────┘ {4}└─────────────┘\n````/);
    // Paragraphs around the diagram survive untouched
    expect(output.startsWith('Before paragraph.')).toBe(true);
    expect(output.endsWith('After paragraph.')).toBe(true);
  });

  it('keeps a multi-section diagram with a single blank line as one block', () => {
    const input = [
      '┌──┐',
      '│ A│',
      '└──┘',
      '',
      '┌──┐',
      '│ B│',
      '└──┘',
    ].join('\n');

    const output = transformAsciiDiagrams(input);
    // Only one fence pair
    expect(output.match(/````text/g)?.length ?? 0).toBe(1);
    expect(output.match(/^````$/gm)?.length ?? 0).toBe(1);
    // Both sections are inside it
    expect(output).toContain('│ A│');
    expect(output).toContain('│ B│');
  });

  it('does not wrap a single isolated diagram-character line in prose', () => {
    const input = '点击 → 进入下一步。';
    expect(transformAsciiDiagrams(input)).toBe(input);
  });

  it('leaves content inside an existing fenced code block alone', () => {
    const input = [
      '```text',
      '┌──┐',
      '│ A│',
      '└──┘',
      '```',
    ].join('\n');

    const output = transformAsciiDiagrams(input);
    // No additional fence is introduced
    expect(output.match(/```/g)?.length ?? 0).toBe(2);
    expect(output).toBe(input);
  });

  it('leaves content inside a 4-tick fence (its own previous output) alone', () => {
    const wrapped = [
      'Intro.',
      '',
      '````text',
      '┌──┐',
      '│ A│',
      '└──┘',
      '````',
      '',
      'Outro.',
    ].join('\n');

    expect(transformAsciiDiagrams(wrapped)).toBe(wrapped);
  });

  it('is idempotent — a second pass produces the same string', () => {
    const input = [
      'Before.',
      '',
      '┌──┐',
      '│ A│',
      '└──┘',
      '',
      'After.',
    ].join('\n');

    const once = transformAsciiDiagrams(input);
    const twice = transformAsciiDiagrams(once);
    expect(twice).toBe(once);
  });

  it('handles multiple separate diagrams as independent fenced blocks', () => {
    const input = [
      'A:',
      '┌──┐',
      '│A1│',
      '└──┘',
      '',
      'Some narrative paragraph in between.',
      '',
      'B:',
      '┌──┐',
      '│B1│',
      '└──┘',
    ].join('\n');

    const output = transformAsciiDiagrams(input);
    expect(output.match(/````text/g)?.length ?? 0).toBe(2);
    expect(output).toContain('│A1│');
    expect(output).toContain('│B1│');
    expect(output).toContain('Some narrative paragraph in between.');
  });

  it('does not insert a fence for a single diagram line', () => {
    // A lone box-drawing line (rare but possible) is not enough signal
    // — wrapping a single line as a code block is more visually
    // disruptive than helpful.
    const input = 'Status: ─────';
    const output = transformAsciiDiagrams(input);
    expect(output).toBe(input);
  });

  it('does not break a 4-tick fence whose body contains a nested 3-tick fence', () => {
    // Reasoning blocks emitted by transformInlineReasoningTags are 4-tick
    // fences, and the model often quotes 3-tick code samples inside them.
    // A naive non-greedy regex split would close the outer fence at the
    // inner ``` and treat the rest as fence-free, potentially double-
    // wrapping any diagram characters that follow.
    const input = [
      '````thinking',
      'Let me show a snippet:',
      '```ts',
      'const x = 1;',
      '```',
      'And a diagram:',
      '┌──┐',
      '│ A│',
      '└──┘',
      '````',
      '',
      'Outer prose continues.',
    ].join('\n');

    const output = transformAsciiDiagrams(input);
    // Whole 4-tick block including its inner 3-tick fence and the
    // diagram inside it must be preserved verbatim — no extra
    // synthetic ````text fence is introduced.
    expect(output).toBe(input);
  });

  it('treats a tilde-fenced block as a fence', () => {
    const input = [
      '~~~text',
      '┌──┐',
      '│ A│',
      '└──┘',
      '~~~',
    ].join('\n');

    const output = transformAsciiDiagrams(input);
    expect(output).toBe(input);
    // No `text` fence introduced
    expect(output).not.toContain('````text');
  });

  it('recognises an indented (≤3 spaces) fence opener', () => {
    // CommonMark allows fences with up to 3 leading spaces.
    const input = [
      '   ```text',
      '┌──┐',
      '│ A│',
      '└──┘',
      '   ```',
    ].join('\n');

    const output = transformAsciiDiagrams(input);
    expect(output).toBe(input);
  });

  it('preserves block-elements characters (▼ ▲ █) inside diagrams', () => {
    const input = [
      'Layered architecture:',
      '┌──────────────┐',
      '│  Web API     │',
      '└──────┬───────┘',
      '       ▼',
      '┌──────────────┐',
      '│  Service     │',
      '└──────────────┘',
    ].join('\n');

    const output = transformAsciiDiagrams(input);
    expect(output).toContain('````text');
    expect(output).toContain('▼');
    expect(output).toContain('│  Service     │');
  });
});
