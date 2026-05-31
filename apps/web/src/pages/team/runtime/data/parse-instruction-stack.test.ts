import { describe, expect, it } from 'vitest';
import {
  parseInstructionStack,
  instructionSegmentLabel,
  isMarkdownSegment,
} from './parse-instruction-stack.js';

const SAMPLE = [
  '<team-instruction layer="constitution">',
  '# 团队宪法',
  '必须写测试。',
  '</team-instruction>',
  '',
  '<team-instruction layer="user-memory">',
  '我偏好中文回复。',
  '</team-instruction>',
  '',
  '<team-instruction layer="soul:executor:default">',
  '# 执行 SOUL',
  '小步前进。',
  '</team-instruction>',
  '',
  '<team-instruction layer="cache-breaker" tag="abc123" />',
].join('\n');

describe('parseInstructionStack', () => {
  it('按序拆出各层片段并归类', () => {
    const segs = parseInstructionStack(SAMPLE);
    expect(segs.map((s) => s.kind)).toEqual([
      'constitution',
      'user-memory',
      'soul',
      'cache-breaker',
    ]);
    expect(segs[0]?.body).toContain('团队宪法');
    expect(segs[2]?.layer).toBe('soul:executor:default');
  });

  it('解析 cache-breaker 的 self-closing tag 属性', () => {
    const segs = parseInstructionStack(SAMPLE);
    const cb = segs.find((s) => s.kind === 'cache-breaker');
    expect(cb?.tag).toBe('abc123');
    expect(cb?.body).toBe('');
  });

  it('无标签文本归为单个 raw 片段（保底不丢内容）', () => {
    const segs = parseInstructionStack('就是一段普通文本，没有标签。');
    expect(segs).toHaveLength(1);
    expect(segs[0]?.kind).toBe('raw');
    expect(segs[0]?.body).toContain('普通文本');
  });

  it('空串返回空数组', () => {
    expect(parseInstructionStack('')).toEqual([]);
  });

  it('isMarkdownSegment / instructionSegmentLabel 正确', () => {
    expect(isMarkdownSegment('constitution')).toBe(true);
    expect(isMarkdownSegment('cache-breaker')).toBe(false);
    expect(instructionSegmentLabel('soul')).toBe('角色 SOUL');
    expect(instructionSegmentLabel('cache-breaker')).toBe('缓存标记');
  });
});
