import { describe, expect, it } from 'vitest';

import { parseAttachmentReferences, stripAttachmentReferences } from './attachment-reference.js';

/** 真实形态：用户正文 + 空行 + `[附件]` 段。 */
const REAL_MESSAGE = [
  '帮我看看这几个文件',
  '',
  '[附件]',
  '- report.pdf (artifact:3f2a1b4c-9d8e-4f6a-b1c2-de34567890ab)',
  '内容摘录:',
  '这是文件内容预览',
  '第二行预览',
  '- notes.txt (artifact:aaaaaaaa-1111-2222-3333-444444444444)',
].join('\n');

describe('parseAttachmentReferences', () => {
  it('解析 [附件] 段内的单个引用', () => {
    const text = ['正文', '', '[附件]', '- report.pdf (artifact:abc-def-123)'].join('\n');

    expect(parseAttachmentReferences(text)).toEqual([
      { fileName: 'report.pdf', artifactId: 'abc-def-123' },
    ]);
  });

  it('解析 [附件] 段内的多个引用并保持顺序', () => {
    expect(parseAttachmentReferences(REAL_MESSAGE)).toEqual([
      { fileName: 'report.pdf', artifactId: '3f2a1b4c-9d8e-4f6a-b1c2-de34567890ab' },
      { fileName: 'notes.txt', artifactId: 'aaaaaaaa-1111-2222-3333-444444444444' },
    ]);
  });

  it('同一文件被引用两次时不去重', () => {
    const text = [
      '[附件]',
      '- dup.xlsx (artifact:cccccccc-0000-0000-0000-000000000000)',
      '- dup.xlsx (artifact:cccccccc-0000-0000-0000-000000000000)',
    ].join('\n');

    expect(parseAttachmentReferences(text)).toEqual([
      { fileName: 'dup.xlsx', artifactId: 'cccccccc-0000-0000-0000-000000000000' },
      { fileName: 'dup.xlsx', artifactId: 'cccccccc-0000-0000-0000-000000000000' },
    ]);
  });

  it('核心防线：正文里形如引用的行不在 [附件] 段内，不得被解析', () => {
    const text = [
      '这是我粘贴的日志：',
      '- fake.pdf (artifact:deadbeef-0000-0000-0000-000000000000)',
      '-- 上面只是举例',
      '',
      '[附件]',
      '- real.pdf (artifact:11111111-2222-3333-4444-555555555555)',
    ].join('\n');

    expect(parseAttachmentReferences(text)).toEqual([
      { fileName: 'real.pdf', artifactId: '11111111-2222-3333-4444-555555555555' },
    ]);
  });

  it('行首有缩进的引用行也能识别', () => {
    const text = [
      '[附件]',
      '    - indented.zip (artifact:eeeeeeee-2222-2222-2222-222222222222)',
    ].join('\n');

    expect(parseAttachmentReferences(text)).toEqual([
      { fileName: 'indented.zip', artifactId: 'eeeeeeee-2222-2222-2222-222222222222' },
    ]);
  });

  it('没有 [附件] 段时返回空数组', () => {
    expect(parseAttachmentReferences('就是一段普通文本\n- a.pdf (artifact:abc)')).toEqual([]);
  });

  it('[附件] 段内没有合法引用行时返回空数组', () => {
    const text = ['正文', '[附件]', '内容摘录:', '没有任何引用行'].join('\n');

    expect(parseAttachmentReferences(text)).toEqual([]);
  });

  it('空字符串返回空数组', () => {
    expect(parseAttachmentReferences('')).toEqual([]);
  });
});

describe('stripAttachmentReferences', () => {
  it('[附件] 段位于正文末尾时，剥离后只剩用户正文', () => {
    expect(stripAttachmentReferences(REAL_MESSAGE)).toBe('帮我看看这几个文件');
  });

  it('移除整个 [附件] 段，内容摘录块不残留', () => {
    const stripped = stripAttachmentReferences(REAL_MESSAGE);

    expect(stripped).not.toContain('[附件]');
    expect(stripped).not.toContain('内容摘录:');
    expect(stripped).not.toContain('artifact:');
  });

  it('核心防线：正文里形如引用的行不在 [附件] 段内，不得被剥离', () => {
    const text = [
      '粘贴的日志：',
      '- fake.pdf (artifact:deadbeef-0000-0000-0000-000000000000)',
      '',
      '[附件]',
      '- real.pdf (artifact:11111111-2222-3333-4444-555555555555)',
    ].join('\n');

    expect(stripAttachmentReferences(text)).toBe(
      '粘贴的日志：\n- fake.pdf (artifact:deadbeef-0000-0000-0000-000000000000)',
    );
  });

  it('剥离后只规整末尾空行，不挤压正文内部空行', () => {
    const text = ['第一段', '', '第二段', '', '[附件]', '- a.pdf (artifact:abc-123)'].join('\n');

    expect(stripAttachmentReferences(text)).toBe('第一段\n\n第二段');
  });

  it('没有 [附件] 段时返回原文（等价性断言）', () => {
    const text = '普通正文\n- 不是附件段.pdf (artifact:xyz)';

    expect(stripAttachmentReferences(text)).toBe(text);
  });

  it('[附件] 段存在但没有合法引用行时返回原文（等价性断言）', () => {
    const text = ['正文', '[附件]', '说明文本，没有引用行'].join('\n');

    expect(stripAttachmentReferences(text)).toBe(text);
  });

  it('空字符串原样返回', () => {
    expect(stripAttachmentReferences('')).toBe('');
  });
});
