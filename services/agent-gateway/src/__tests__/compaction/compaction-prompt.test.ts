/**
 * Regression coverage for the compaction-prompt builder.
 *
 * Mirrors opencode #23870: instead of asking the compaction LLM to
 * re-summarise the entire conversation from scratch every round, we
 * embed the previous summary as an anchor and ask the model to update
 * it in place. The tests below pin:
 *
 *   - first-time compaction emits a "create new" instruction
 *   - subsequent compaction wraps the previous summary in
 *     `<previous-summary>…</previous-summary>` and frames it as an
 *     update task
 *   - whitespace-only / empty `previousSummary` is treated as absent
 *   - the structured output template is always appended unchanged
 *     (downstream parsers depend on the section headings)
 */

import { describe, expect, it } from 'vitest';

import { COMPACTION_SYSTEM_PROMPT, buildCompactionUserPrompt } from '../../compaction/compaction-prompt.js';

const REQUIRED_SECTIONS = [
  '## 目标',
  '## 约束与偏好',
  '## 进度',
  '### 已完成',
  '### 进行中',
  '### 阻塞',
  '## 关键决策',
  '## 下一步',
  '## 关键上下文',
  '## 相关文件',
];

describe('COMPACTION_SYSTEM_PROMPT', () => {
  it('frames the task as anchor-based summary maintenance, not generic chat', () => {
    expect(COMPACTION_SYSTEM_PROMPT).toContain('锚点');
    // The system prompt must teach the model how to react when the user
    // prompt contains an anchor block.
    expect(COMPACTION_SYSTEM_PROMPT).toContain('<previous-summary>');
  });

  it('forbids meta-talk so summaries do not leak compaction wording', () => {
    expect(COMPACTION_SYSTEM_PROMPT).toContain('不要回应对话本身');
    expect(COMPACTION_SYSTEM_PROMPT).toContain('不要提及');
  });
});

describe('buildCompactionUserPrompt', () => {
  it('emits a create-new instruction when no previousSummary is supplied', () => {
    const prompt = buildCompactionUserPrompt();
    expect(prompt).toContain('创建一份新的锚点摘要');
    expect(prompt).not.toContain('<previous-summary>');
  });

  it('emits a create-new instruction for explicit undefined', () => {
    const prompt = buildCompactionUserPrompt({ previousSummary: undefined });
    expect(prompt).toContain('创建一份新的锚点摘要');
    expect(prompt).not.toContain('<previous-summary>');
  });

  it('treats empty / whitespace-only previousSummary as absent', () => {
    expect(buildCompactionUserPrompt({ previousSummary: '' })).toContain('创建一份新的锚点摘要');
    expect(buildCompactionUserPrompt({ previousSummary: '   \n\t' })).toContain(
      '创建一份新的锚点摘要',
    );
  });

  it('wraps a real previousSummary in <previous-summary> tags and frames as update', () => {
    const prev = '## 目标\n- 重构 retry-classify\n## 进度\n### 已完成\n- 加白名单';
    const prompt = buildCompactionUserPrompt({ previousSummary: prev });
    expect(prompt).toContain('<previous-summary>');
    expect(prompt).toContain('</previous-summary>');
    expect(prompt).toContain(prev);
    expect(prompt).toContain('更新下面的锚点摘要');
    expect(prompt).toContain('保留仍然成立的细节');
    // Update instruction must NOT appear together with the new-summary
    // instruction — they are mutually exclusive framings.
    expect(prompt).not.toContain('创建一份新的锚点摘要');
  });

  it('always appends the structured output template with every section', () => {
    for (const variant of [
      buildCompactionUserPrompt(),
      buildCompactionUserPrompt({ previousSummary: 'anything' }),
    ]) {
      for (const section of REQUIRED_SECTIONS) {
        expect(variant).toContain(section);
      }
      // Sanity check on the output rules block.
      expect(variant).toContain('保留每一节，即使为空');
      expect(variant).toContain('精确保留文件路径');
    }
  });

  it('trims surrounding whitespace from the embedded anchor body', () => {
    const prev = '\n\n  ## 目标\n  - foo  \n\n  ';
    const prompt = buildCompactionUserPrompt({ previousSummary: prev });
    // The embedded body is the trimmed version, not the raw input.
    expect(prompt).toContain('## 目标\n  - foo');
    // The leading/trailing whitespace is gone before the closing tag.
    expect(prompt).not.toMatch(/<previous-summary>\s*\n\s*\n/);
  });
});
