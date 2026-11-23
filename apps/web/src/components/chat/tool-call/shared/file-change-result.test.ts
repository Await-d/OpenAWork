import { describe, expect, it } from 'vitest';
import { parseFileChangeResult } from './file-change-result.js';

const file = {
  action: 'update',
  path: 'src/example.ts',
  before: '',
  after: '',
  additions: 0,
  deletions: 0,
};
const envelope = { success: true, files: [file] };

describe('文件变更结果严格解析', () => {
  it.each([envelope, JSON.stringify(envelope), JSON.stringify(JSON.stringify(envelope))])(
    '接受对象和最多两层序列化',
    (value) => {
      expect(parseFileChangeResult(value)?.files[0]).toMatchObject({ ...file, incomplete: false });
    },
  );
  it.each([
    null,
    'text',
    '{"success":true,"files":[',
    { files: [file] },
    { success: 'true', files: [file] },
    { success: true, files: {} },
    { success: true, files: [{ ...file, action: 'rename' }] },
    { success: true, files: [{ ...file, path: '' }] },
    { success: true, files: [{ ...file, before: null }] },
    { success: true, files: [{ ...file, additions: -1 }] },
    { success: true, files: [{ ...file, deletions: 1.5 }] },
  ])('拒绝无效或未完整接收的信封', (value) => {
    expect(parseFileChangeResult(value)).toBeNull();
  });
  it('接受以 path 表示目标的网关原生 move', () => {
    const moved = { ...file, action: 'move', path: 'src/destination.ts' };
    expect(parseFileChangeResult({ success: true, files: [moved] })?.files[0]).toMatchObject({
      ...moved,
      moveTo: undefined,
      incomplete: false,
    });
  });
  it('保留失败、空文件列表、新增/删除和 moveTo 信息，不填充缺失快照与计数', () => {
    expect(parseFileChangeResult({ success: false, files: [] })).toMatchObject({
      success: false,
      files: [],
    });
    const result = parseFileChangeResult({
      success: false,
      files: [
        { action: 'add', path: 'new.ts', before: '', after: 'new' },
        { action: 'delete', path: 'old.ts', before: 'old', after: '' },
        { action: 'update', path: 'a.ts', moveTo: 'b.ts' },
      ],
    });
    expect(result?.success).toBe(false);
    expect(result?.files[2]).toMatchObject({
      moveTo: 'b.ts',
      before: undefined,
      additions: undefined,
    });
  });
  it.each([
    { beforeTruncated: true },
    { afterTruncated: true },
    { truncated: true },
    { before: 'prefix…[truncated, 123 chars omitted]' },
    { after: '…[truncated]' },
    { status: 'truncated' },
    { metadata: { status: 'partial' } },
    { metadata: { complete: false } },
  ])('截断快照不保留行数 $status', (metadata) => {
    const result = parseFileChangeResult({ success: true, files: [{ ...file, ...metadata }] });
    expect(result?.files[0]).toMatchObject({
      incomplete: true,
      additions: undefined,
      deletions: undefined,
    });
  });
  it('从两侧剥离截断标记并汇总省略量，保留原始输出与源码换行', () => {
    const raw = JSON.stringify({
      success: true,
      files: [
        {
          ...file,
          before: 'old\n\n…[truncated, 12 chars omitted]',
          after: 'new…[truncated, 8 chars omitted]',
        },
      ],
    });
    const result = parseFileChangeResult(raw);
    expect(result?.raw).toBe(raw);
    expect(result?.files[0]).toMatchObject({
      before: 'old\n',
      after: 'new',
      omittedChars: 20,
      incomplete: true,
      additions: undefined,
      deletions: undefined,
    });
  });
  it('缺少一侧时不提供前段差异的省略量，也不补空快照', () => {
    const result = parseFileChangeResult({
      success: true,
      files: [{ ...file, before: 'prefix…[truncated, 12 chars omitted]', after: undefined }],
    });
    expect(result?.files[0]).toMatchObject({
      before: 'prefix',
      after: undefined,
      incomplete: true,
    });
    expect(result?.files[0]?.omittedChars).toBeUndefined();
  });
  it('顶层状态元数据同样禁止完整 diff 和计数', () => {
    expect(
      parseFileChangeResult({ ...envelope, metadata: { status: { truncated: true } } })?.files[0],
    ).toMatchObject({ incomplete: true, additions: undefined });
  });
});
