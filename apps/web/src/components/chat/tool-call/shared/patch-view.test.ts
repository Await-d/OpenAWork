import { describe, expect, it } from 'vitest';
import { hasTruncatedPatchSnapshot, parsePatchFiles, patchResult } from './patch-view.js';

export const PATCH_EXAMPLE = `*** Begin Patch
*** Update File: src/a.ts
@@ export function hello
-const oldValue = 1;
+const newValue = 2;
*** Add File: src/new.ts
+export const added = true;
*** Delete File: src/unused.ts
*** Update File: src/old.ts
*** Move to: src/moved.ts
@@
-old
+new
*** End Patch`;

describe('patch 请求解析', () => {
  it('隐式更新片段保留首条正文后的裸空白上下文', () => {
    const lines = [' first', '', '-old', '+new'];
    const files = parsePatchFiles(
      ['*** Begin Patch', '*** Update File: a.ts', ...lines, '*** End Patch'].join('\n'),
    );
    expect(files?.[0]).toMatchObject({ lines, added: 1, removed: 1 });
  });

  it('仅在活动片段内保留裸空行，切换文件后重置片段状态', () => {
    const files = parsePatchFiles(
      [
        '*** Begin Patch',
        '*** Update File: a.ts',
        '',
        '@@ first',
        '',
        '+first',
        '*** Update File: b.ts',
        '',
        '@@ second',
        '',
        '-second',
        '*** End Patch',
      ].join('\n'),
    );
    expect(files?.map(({ lines, added, removed }) => ({ lines, added, removed }))).toEqual([
      { lines: ['@@ first', '', '+first'], added: 1, removed: 0 },
      { lines: ['@@ second', '', '-second'], added: 0, removed: 1 },
    ]);
  });

  it('保留裸空上下文行及空白增删的原始位置，不增加变更计数', () => {
    const lines = ['@@ first', '', '-', '+', '', ' keep', '@@ second', '', '+next'];
    const files = parsePatchFiles(
      ['*** Begin Patch', '*** Update File: a.ts', ...lines, '*** End Patch'].join('\n'),
    );
    expect(files?.[0]).toMatchObject({ lines, added: 2, removed: 1 });
  });

  it('文件尾标记之后的空行不属于上下文，下一片段重新保留空行', () => {
    const files = parsePatchFiles(
      [
        '*** Begin Patch',
        '*** Update File: a.ts',
        '@@ first',
        '+',
        '*** End of File',
        '',
        ' ',
        '@@ second',
        '',
        '-',
        '*** End Patch',
      ].join('\n'),
    );
    expect(files?.[0]?.lines).toEqual(['@@ first', '+', '@@ second', '', '-']);
  });

  it('解析多文件修改、新增、删除和移动及请求行数', () => {
    const files = parsePatchFiles(PATCH_EXAMPLE);
    expect(files).toHaveLength(4);
    expect(files?.[0]).toMatchObject({ path: 'src/a.ts', action: 'update', added: 1, removed: 1 });
    expect(files?.[1]).toMatchObject({ action: 'add', added: 1 });
    expect(files?.[2]).toMatchObject({ action: 'delete', added: 0, removed: 0 });
    expect(files?.[3]).toMatchObject({ path: 'src/old.ts', moveTo: 'src/moved.ts' });
  });

  it('识别不完整输入，拒绝无效格式', () => {
    expect(
      parsePatchFiles(PATCH_EXAMPLE.replace('*** End Patch', ''))?.every((file) => file.truncated),
    ).toBe(true);
    expect(parsePatchFiles('not a patch')).toBeNull();
    expect(parsePatchFiles('*** Begin Patch\ninvalid\n*** End Patch')).toBeNull();
    expect(parsePatchFiles(undefined)).toBeNull();
  });

  it('解析 success/files JSON 字符串，损坏 JSON 保持兜底', () => {
    expect(
      patchResult(
        JSON.stringify({ success: true, files: [{ action: 'update', path: 'src/a.ts' }] }),
      ),
    ).toMatchObject({ success: true });
    expect(patchResult('{"success":true,"files":[')).toBeNull();
    expect(patchResult('null')).toBeNull();
  });

  it('重复元数据只标记匹配文件的截断状态', () => {
    const file = parsePatchFiles(PATCH_EXAMPLE)![0]!;
    expect(
      hasTruncatedPatchSnapshot(file, [
        { file: 'src/a.ts', before: 'first', after: 'next' },
        { file: 'src/a.ts', before: '[truncated]', after: 'next' },
      ]),
    ).toBe(true);
    expect(hasTruncatedPatchSnapshot(file, [{ file: 'other.ts', truncated: true }])).toBe(false);
  });
});
