import { describe, expect, it } from 'vitest';
import {
  estimateComposerTokens,
  getComposerCharacterCount,
  getComposerCharacterLimit,
} from './composer-character-count.js';

describe('estimateComposerTokens', () => {
  it('空文本返回 0', () => {
    expect(estimateComposerTokens('')).toBe(0);
  });

  it('拉丁字符按 4 字符 1 token 折算', () => {
    expect(estimateComposerTokens('a'.repeat(400))).toBe(100);
  });

  it('中文字符按约 1 字 1 token 折算', () => {
    expect(estimateComposerTokens('中'.repeat(400))).toBe(400);
  });

  it('中英混排分别折算后合并', () => {
    // 100 个汉字 (100) + 400 个拉丁字符 (100) = 200
    expect(estimateComposerTokens(`${'字'.repeat(100)}${'a'.repeat(400)}`)).toBe(200);
  });

  it('代理对字符按单个码点计数', () => {
    // CJK 扩展 B 区：每个字符独占代理对，但应只计 1 个 token
    expect(estimateComposerTokens('𠮷'.repeat(10))).toBe(10);
  });

  it('全角标点按密集字符折算', () => {
    expect(estimateComposerTokens('，。！？'.repeat(10))).toBe(40);
  });
});

describe('getComposerCharacterCount', () => {
  it('无上下文预算时退回字符数比', () => {
    const result = getComposerCharacterCount('a'.repeat(4000));

    expect(result.contextMaxTokens).toBeNull();
    expect(result.limit).toBe(8000);
    expect(result.tone).toBe('normal');
    expect(result.label).toBe('4,000 / 8,000 字符');
  });

  it('无上下文预算时字符数过半即进入 warning', () => {
    expect(getComposerCharacterCount('a'.repeat(6400)).tone).toBe('warning');
    expect(getComposerCharacterCount('a'.repeat(8000)).tone).toBe('danger');
  });

  it('有上下文预算时按 token 占用判定，长拉丁文本不再过早告警', () => {
    // 8000 个拉丁字符 ≈ 2000 tokens，仅占 128k 窗口的 1.6%
    const result = getComposerCharacterCount('a'.repeat(8000), 128_000);

    expect(result.estimatedTokens).toBe(2000);
    expect(result.tone).toBe('normal');
    expect(result.label).toBe('约 2,000 / 128k tokens');
  });

  it('有上下文预算时中文能触发告警', () => {
    expect(getComposerCharacterCount('中'.repeat(80_000), 100_000).tone).toBe('warning');
    expect(getComposerCharacterCount('中'.repeat(120_000), 100_000).tone).toBe('danger');
  });

  it('上下文预算为 0 或负数时退回字符数比', () => {
    expect(getComposerCharacterCount('测试', 0).contextMaxTokens).toBeNull();
    expect(getComposerCharacterCount('测试', -1).contextMaxTokens).toBeNull();
  });

  it('小于 1000 的窗口直接展示原始数值', () => {
    expect(getComposerCharacterCount('a'.repeat(400), 800).label).toBe('约 100 / 800 tokens');
  });
});

describe('getComposerCharacterLimit', () => {
  it('按 4 字符 1 token 折算窗口并为下限兜底', () => {
    expect(getComposerCharacterLimit(128_000)).toBe(32_000);
    expect(getComposerCharacterLimit(100)).toBe(500);
    expect(getComposerCharacterLimit()).toBe(8000);
  });
});
