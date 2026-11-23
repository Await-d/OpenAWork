import { describe, expect, it } from 'vitest';
import { naturalLanguageSummary } from './natural-language-summary.js';

describe('Skill 加载摘要', () => {
  it.each([
    [{ name: ' frontend ', skill: 'other', skillId: 'legacy' }, '加载技能 frontend'],
    [{ name: ' ', skill: 'design', skillId: 'legacy' }, '加载技能 design'],
    [{ skillId: 'legacy' }, '加载技能 legacy'],
    [{}, '加载技能'],
  ])('名称遵循真实入参优先级 %j', (input, expected) => {
    expect(naturalLanguageSummary('skill', input)).toBe(expected);
  });
});
