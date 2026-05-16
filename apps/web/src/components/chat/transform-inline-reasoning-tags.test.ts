import { describe, expect, it } from 'vitest';
import { transformInlineReasoningTags } from './transform-inline-reasoning-tags.js';

describe('transformInlineReasoningTags', () => {
  it('passes through text without reasoning tags', () => {
    const input = 'Hello, **world**.\n\n```ts\nconst x = 1;\n```';
    expect(transformInlineReasoningTags(input)).toBe(input);
  });

  it('rewrites a closed <analysis> block into a thinking fence', () => {
    const input = '<analysis>**字面请求**: do X</analysis>\nbody continues here.';
    const output = transformInlineReasoningTags(input);
    expect(output).toContain('````thinking\n');
    expect(output).toContain('**字面请求**: do X');
    expect(output).toMatch(/```` *\n+body continues here\./);
    expect(output).not.toContain('<analysis>');
    expect(output).not.toContain('</analysis>');
  });

  it('handles streaming (open tag without close) by emitting only the opening fence', () => {
    const input = '<analysis>still thinking, no end yet';
    const output = transformInlineReasoningTags(input);
    expect(output).toContain('````thinking');
    expect(output).toContain('still thinking, no end yet');
    expect(output).not.toContain('<analysis>');
  });

  it('matches tag names case-insensitively and recognises common synonyms', () => {
    const tags = [
      'analysis',
      'Thinking',
      'think', // DeepSeek-R1 style (singular, no -ing)
      'REASONING',
      'reasoning_process',
      'thought',
      'Thoughts',
      'thought_process',
      'reflection',
      'scratchpad',
      'scratch_pad',
      'scratch',
      'inner_monologue',
      'monologue',
      'plan',
      'planning',
      'rationale',
      'deliberation',
    ];
    for (const tag of tags) {
      const input = `<${tag}>foo</${tag}>`;
      const output = transformInlineReasoningTags(input);
      expect(output, `tag <${tag}> should be rewritten`).toContain('````thinking');
      expect(output).toContain('foo');
      expect(output.toLowerCase()).not.toContain(`<${tag.toLowerCase()}>`);
      expect(output.toLowerCase()).not.toContain(`</${tag.toLowerCase()}>`);
    }
  });

  it('treats `_` and `-` interchangeably in multi-word tag names', () => {
    const variants = [
      ['<inner_monologue>x</inner_monologue>', 'underscore form'],
      ['<inner-monologue>x</inner-monologue>', 'hyphen form'],
      ['<thought_process>x</thought_process>', 'thought_process underscore'],
      ['<thought-process>x</thought-process>', 'thought-process hyphen'],
      ['<reasoning_process>x</reasoning_process>', 'reasoning_process underscore'],
      ['<reasoning-process>x</reasoning-process>', 'reasoning-process hyphen'],
    ] as const;
    for (const [input, label] of variants) {
      const output = transformInlineReasoningTags(input);
      expect(output, `${label} should rewrite`).toContain('````thinking');
      expect(output).toContain('x');
    }
  });

  it('does not rewrite tags representing user-visible content', () => {
    // observation / output / final_answer / answer are NOT reasoning
    // wrappers — they hold information the user is supposed to see,
    // so we must leave them untouched even though they share the
    // ReAct lineage of `thought`.
    const cases = [
      '<observation>tool result here</observation>',
      '<output>final result</output>',
      '<final_answer>42</final_answer>',
      '<answer>42</answer>',
      '<result>ok</result>',
    ];
    for (const input of cases) {
      const output = transformInlineReasoningTags(input);
      expect(output, `should NOT rewrite: ${input}`).toBe(input);
    }
  });

  it('does not match similarly-named identifiers (component / hyphenated extensions)', () => {
    // A custom React-style component name that merely starts with a
    // recognised word must not be swallowed. The matcher requires
    // the tag name itself to terminate before the closing `>`.
    const cases = [
      '<analysis-component>x</analysis-component>',
      '<thinking-cap>x</thinking-cap>',
      '<plans>x</plans>',
      '<thoughtful>x</thoughtful>',
    ];
    for (const input of cases) {
      const output = transformInlineReasoningTags(input);
      expect(output, `should NOT rewrite: ${input}`).toBe(input);
    }
  });

  it('does not touch reasoning tags that appear inside an existing fenced code block', () => {
    const input = [
      'See this example:',
      '```xml',
      '<analysis>this is documentation, leave alone</analysis>',
      '```',
      'after fence.',
    ].join('\n');
    const output = transformInlineReasoningTags(input);
    expect(output).toContain('<analysis>this is documentation, leave alone</analysis>');
    expect(output).not.toContain('````thinking');
  });

  it('rewrites tags outside fences while leaving in-fence tags intact', () => {
    const input = [
      '<analysis>outside thinking</analysis>',
      '```',
      '<analysis>inside, should stay</analysis>',
      '```',
      '<thinking>another outside block</thinking>',
    ].join('\n');
    const output = transformInlineReasoningTags(input);
    // The two outside tags become thinking fences.
    expect(output.match(/````thinking/g)?.length).toBe(2);
    // The in-fence tag is preserved verbatim.
    expect(output).toContain('<analysis>inside, should stay</analysis>');
    expect(output).toContain('outside thinking');
    expect(output).toContain('another outside block');
  });

  it('is idempotent: applying twice yields the same result as once', () => {
    const input = '<analysis>foo</analysis>\nrest';
    const once = transformInlineReasoningTags(input);
    const twice = transformInlineReasoningTags(once);
    expect(twice).toBe(once);
  });

  it('returns empty string unchanged', () => {
    expect(transformInlineReasoningTags('')).toBe('');
  });
});
