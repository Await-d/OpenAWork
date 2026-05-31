import { describe, expect, it } from 'vitest';
import { parseSoulFrontmatter, soulFieldLabel } from './parse-soul-frontmatter.js';

const SAMPLE = [
  '---',
  'identity: 接待 Agent。第一个触点。',
  'tone: 友好、稳定',
  'focus:',
  '  - 听清用户真正想要的结果',
  '  - 把模糊诉求拆成具体目标',
  'boundaries:',
  '  - 不直接给实现细节',
  'output_style: 短段落 + 结构化追问',
  '---',
  '',
  '# 接待 Agent SOUL',
  '',
  '正文内容第一段。',
].join('\n');

describe('parseSoulFrontmatter', () => {
  it('解析 frontmatter 字段（scalar + 列表）与正文', () => {
    const parsed = parseSoulFrontmatter(SAMPLE);
    expect(parsed.hasFrontmatter).toBe(true);

    const byKey = new Map(parsed.fields.map((f) => [f.key, f]));
    expect(byKey.get('identity')?.value).toBe('接待 Agent。第一个触点。');
    expect(byKey.get('tone')?.value).toBe('友好、稳定');
    expect(byKey.get('focus')?.items).toEqual(['听清用户真正想要的结果', '把模糊诉求拆成具体目标']);
    expect(byKey.get('boundaries')?.items).toEqual(['不直接给实现细节']);
    expect(byKey.get('output_style')?.value).toBe('短段落 + 结构化追问');

    expect(parsed.body.startsWith('# 接待 Agent SOUL')).toBe(true);
    expect(parsed.body).toContain('正文内容第一段。');
  });

  it('保持字段原始顺序', () => {
    const parsed = parseSoulFrontmatter(SAMPLE);
    expect(parsed.fields.map((f) => f.key)).toEqual([
      'identity',
      'tone',
      'focus',
      'boundaries',
      'output_style',
    ]);
  });

  it('无 frontmatter 时整体作为正文', () => {
    const parsed = parseSoulFrontmatter('# 纯正文\n没有 frontmatter。');
    expect(parsed.hasFrontmatter).toBe(false);
    expect(parsed.fields).toEqual([]);
    expect(parsed.body).toContain('纯正文');
  });

  it('soulFieldLabel 映射已知 key，未知 key 原样返回', () => {
    expect(soulFieldLabel('identity')).toBe('身份定位');
    expect(soulFieldLabel('output_style')).toBe('输出风格');
    expect(soulFieldLabel('unknown_key')).toBe('unknown_key');
  });
});
