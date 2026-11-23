import { describe, expect, it } from 'vitest';
import type { SessionFileDiffEntry } from '@openAwork/web-client';
import { matchFileDiff, toCompleteSnapshot } from './match-file-diff.js';

function diff(partial: {
  file: string;
  before?: string;
  after?: string;
  additions?: number;
  deletions?: number;
}): SessionFileDiffEntry {
  return {
    file: partial.file,
    before: partial.before,
    after: partial.after,
    additions: partial.additions ?? 0,
    deletions: partial.deletions ?? 0,
  };
}

describe('matchFileDiff · 路径匹配', () => {
  it('原始字符串完全相等时命中', () => {
    const target = diff({ file: 'src/example.ts' });
    expect(matchFileDiff([diff({ file: 'other.ts' }), target], 'src/example.ts')).toBe(target);
  });

  it('归一化分隔符后相等时命中（Windows 反斜杠 / 混合分隔符）', () => {
    const target = diff({ file: 'C:\\repo\\src\\example.ts' });
    expect(matchFileDiff([target], 'C:/repo/src/example.ts')).toBe(target);
  });

  it('工具输出是相对路径、存储侧是绝对路径时按路径段后缀命中', () => {
    const target = diff({ file: '/home/await/project/OpenAWork/apps/web/src/x.ts' });
    expect(matchFileDiff([target], 'apps/web/src/x.ts')).toBe(target);
    expect(matchFileDiff([target], 'src/x.ts')).toBe(target);
  });

  it('工具输出是绝对路径、存储侧是相对路径时同样命中（反方向）', () => {
    const target = diff({ file: 'apps/web/src/x.ts' });
    expect(matchFileDiff([target], '/home/await/project/OpenAWork/apps/web/src/x.ts')).toBe(target);
  });

  it('后缀必须落在路径段边界：bar.ts 不能命中 foobar.ts', () => {
    const foobar = diff({ file: 'src/foobar.ts' });
    expect(matchFileDiff([foobar], 'bar.ts')).toBeUndefined();
    expect(matchFileDiff([foobar], 'oobar.ts')).toBeUndefined();
  });

  it('没有任何候选时返回 undefined', () => {
    expect(matchFileDiff([diff({ file: 'a.ts' })], 'b.ts')).toBeUndefined();
    expect(matchFileDiff([], 'a.ts')).toBeUndefined();
  });

  it('空 / 空白路径返回 undefined（不把空串当通配）', () => {
    expect(matchFileDiff([diff({ file: 'a.ts' })], '')).toBeUndefined();
    expect(matchFileDiff([diff({ file: 'a.ts' })], '   ')).toBeUndefined();
  });

  it('后缀级出现多个候选时判定为歧义，返回 undefined 而不是随手挑一个', () => {
    const a = diff({ file: '/repo/one/src/x.ts' });
    const b = diff({ file: '/repo/two/src/x.ts' });
    expect(matchFileDiff([a, b], 'src/x.ts')).toBeUndefined();
  });

  it('精确级优先于后缀级：即使后缀级有多个候选，精确命中依然胜出', () => {
    const exact = diff({ file: 'src/x.ts' });
    const other = diff({ file: '/repo/other/src/x.ts' });
    expect(matchFileDiff([other, exact], 'src/x.ts')).toBe(exact);
  });

  it('归一化级优先于后缀级：分隔符差异命中后不再参与歧义判定', () => {
    const normalized = diff({ file: 'C:\\repo\\src\\x.ts' });
    const sibling = diff({ file: '/repo/other/src/x.ts' });
    expect(matchFileDiff([sibling, normalized], 'C:/repo/src/x.ts')).toBe(normalized);
  });

  it('忽略 file 为空字符串的脏条目', () => {
    const target = diff({ file: '/repo/src/x.ts' });
    expect(matchFileDiff([diff({ file: '  ' }), target], 'src/x.ts')).toBe(target);
  });
});

describe('toCompleteSnapshot · 完整快照投影', () => {
  it('两侧都在时原样返回全文并采信服务端计数', () => {
    const entry = diff({ file: 'a.ts', before: 'a', after: 'b', additions: 7, deletions: 3 });
    expect(toCompleteSnapshot(entry)).toEqual({
      before: 'a',
      after: 'b',
      additions: 7,
      deletions: 3,
    });
  });

  it('两侧都缺失时返回 undefined（网关没给文本，调用方需报「不可用」）', () => {
    expect(toCompleteSnapshot(diff({ file: 'a.ts' }))).toBeUndefined();
  });

  it('单侧缺失按空文件处理：新增没有 before、删除没有 after', () => {
    expect(toCompleteSnapshot(diff({ file: 'new.ts', after: 'x', additions: 1 }))).toMatchObject({
      before: '',
      after: 'x',
    });
    expect(toCompleteSnapshot(diff({ file: 'gone.ts', before: 'y', deletions: 1 }))).toMatchObject({
      before: 'y',
      after: '',
    });
  });

  it('服务端计数非法时按完整文本本地统计兜底', () => {
    const entry = {
      file: 'a.ts',
      before: 'one\ntwo\n',
      after: 'one\nthree\n',
      additions: Number.NaN,
      deletions: -1,
    } as SessionFileDiffEntry;
    const snapshot = toCompleteSnapshot(entry);
    expect(snapshot?.additions).toBe(1);
    expect(snapshot?.deletions).toBe(1);
  });
});
