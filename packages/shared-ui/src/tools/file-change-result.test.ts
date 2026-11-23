import { describe, expect, it } from 'vitest';
import { parseFileChangeResult } from './file-change-result.js';
import { resolveToolCallCardDisplayData } from './ToolCallCard.js';

const file = { action: 'update', path: 'src/a.ts', before: '  a\n\n', after: '\t b\n' };
const output = { success: true, files: [file] };

describe('共享文件快照归一化', () => {
  it.each([{ incomplete: false }, { beforeIncomplete: false }, { complete: true }])(
    '否定不完整标记不会误伤完整快照 %j',
    (flags) => {
      const result = parseFileChangeResult({ success: true, files: [{ ...file, ...flags }] });
      expect(result?.files[0]?.incomplete).toBe(false);
    },
  );
  it('complete 为 false 时保护不完整快照', () => {
    expect(
      parseFileChangeResult({ success: true, files: [{ ...file, complete: false }] })?.files[0]
        ?.incomplete,
    ).toBe(true);
  });
  it('网关原生 move 动作与其他文件一起解析', () => {
    const result = parseFileChangeResult({
      success: true,
      files: [file, { action: 'move', path: 'src/destination.ts', before: 'a', after: 'a' }],
    });
    expect(result?.files).toHaveLength(2);
    expect(result?.files[1]).toMatchObject({ action: 'move', incomplete: false });
  });
  it.each([output, JSON.stringify(output), JSON.stringify(JSON.stringify(output))])(
    '完整快照保留空白和真实 diff',
    (value) => {
      expect(parseFileChangeResult(value)?.files[0]?.before).toBe(file.before);
      const data = resolveToolCallCardDisplayData({ toolName: 'tool', input: {}, output: value });
      expect(data.diffView?.beforeText).toBe(file.before);
      expect(data.diffView?.afterText).toBe(file.after);
    },
  );
  it.each([
    { ...file, after: undefined },
    { ...file, before: undefined },
    { ...file, truncated: true },
    { ...file, before: 'prefix\n...[truncated]' },
    { ...file, after: 'prefix…[truncated, 100 chars omitted]' },
  ])('缺失或截断一侧不生成删除/新增', (entry) => {
    const value = { success: true, files: [entry] };
    expect(parseFileChangeResult(value)?.files[0]?.incomplete).toBe(true);
    expect(
      resolveToolCallCardDisplayData({ toolName: 'tool', input: {}, output: value }).diffView,
    ).toBeUndefined();
  });
  it('截断在 before 中只还原标识，绝不计算差异', () => {
    const value = '{"success":true,"files":[{"action":"update","path":"src/a.ts","before":"partial';
    expect(parseFileChangeResult(value)?.files[0]).toMatchObject({
      path: 'src/a.ts',
      incomplete: true,
    });
    expect(
      resolveToolCallCardDisplayData({ toolName: 'tool', input: {}, output: value }).diffView,
    ).toBeUndefined();
  });
  it('明确空侧有效，正文包含截断二字不是完整性标记', () => {
    const value = { success: true, files: [{ ...file, before: '', after: '// 截断处理\n' }] };
    expect(parseFileChangeResult(value)?.files[0]?.incomplete).toBe(false);
    expect(
      resolveToolCallCardDisplayData({ toolName: 'tool', input: {}, output: value }).diffView
        ?.beforeText,
    ).toBe('');
  });
  it.each(['broken', '{"files":[oops', JSON.stringify(JSON.stringify(JSON.stringify(output)))])(
    '无效或超层解码回退',
    (value) => {
      expect(parseFileChangeResult(value)).toBeNull();
    },
  );
});
