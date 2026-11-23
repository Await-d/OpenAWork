import { describe, expect, it } from 'vitest';
import { buildFileSnapshotChangeResult } from './file-snapshot-result.js';

const WRITE_OUTPUT = {
  before: 'const a = 1;\nconst b = 2;\n',
  after: 'const a = 1;\nconst b = 3;\nconst c = 4;\n',
  created: false,
  filediff: {
    file: '/tmp/x.ts',
    before: 'const a = 1;\nconst b = 2;\n',
    after: 'const a = 1;\nconst b = 3;\nconst c = 4;\n',
    additions: 2,
    deletions: 1,
    status: 'modified',
  },
  success: true,
  path: '/tmp/x.ts',
  bytes: 40,
};

describe('buildFileSnapshotChangeResult', () => {
  it('把整文件信封转成单文件变更结果', () => {
    const result = buildFileSnapshotChangeResult(WRITE_OUTPUT, WRITE_OUTPUT);
    expect(result).not.toBeNull();
    expect(result?.success).toBe(true);
    expect(result?.files).toHaveLength(1);
    expect(result?.files[0]).toMatchObject({
      action: 'update',
      path: '/tmp/x.ts',
      incomplete: false,
    });
  });

  it('差异行数取自快照本身，而不是采信外部上报值', () => {
    const result = buildFileSnapshotChangeResult(WRITE_OUTPUT, WRITE_OUTPUT);
    // `const b: 2 -> 3` 是一处替换（+1/-1），`const c = 4` 是新增（+1）。
    expect(result?.files[0]?.additions).toBeGreaterThan(0);
    expect(result?.files[0]?.deletions).toBeGreaterThan(0);
  });

  it('接受存储层序列化后的 JSON 字符串', () => {
    const result = buildFileSnapshotChangeResult(JSON.stringify(WRITE_OUTPUT), 'raw');
    expect(result?.files[0]?.path).toBe('/tmp/x.ts');
  });

  it('created 为 true 时判定为新增', () => {
    const result = buildFileSnapshotChangeResult(
      { ...WRITE_OUTPUT, created: true, before: '' },
      WRITE_OUTPUT,
    );
    expect(result?.files[0]?.action).toBe('add');
  });

  it('缺少任一快照侧时返回 null，交回字段表渲染', () => {
    expect(buildFileSnapshotChangeResult({ after: 'x', path: '/a.ts' }, null)).toBeNull();
    expect(buildFileSnapshotChangeResult({ before: 'x', path: '/a.ts' }, null)).toBeNull();
  });

  it('缺少路径时返回 null（无文件名的差异头没有意义）', () => {
    expect(buildFileSnapshotChangeResult({ ...WRITE_OUTPUT, path: undefined }, null)).toBeNull();
  });

  it('带截断标记时仍用可用前缀生成部分差异，并标注省略量', () => {
    // 网关瘦身后的真实形态：两侧都还在，只是末尾被裁掉并追加标记。
    const truncated = {
      ...WRITE_OUTPUT,
      before: 'const a = 1;\n…[truncated, 1062 chars omitted]',
      after: 'const a = 2;\n…[truncated, 1062 chars omitted]',
    };
    const result = buildFileSnapshotChangeResult(truncated, null);
    expect(result).not.toBeNull();
    const entry = result?.files[0];
    expect(entry?.incomplete).toBe(true);
    expect(entry?.omittedChars).toBe(2124);
    // 标记本身绝不能留在用于渲染的文本里。
    // 标记自带前导换行，剥离时一并去掉（否则会留下一条空白行）。
    expect(entry?.before).toBe('const a = 1;');
    expect(entry?.after).toBe('const a = 2;');
    // 可用前缀内确实有差异。
    expect(entry?.additions).toBeGreaterThan(0);
  });

  it('只有一侧被截断时也能出差异', () => {
    const truncated = {
      ...WRITE_OUTPUT,
      after: 'const a = 1;\nconst b = 3;\n…[truncated, 500 chars omitted]',
    };
    const result = buildFileSnapshotChangeResult(truncated, null);
    expect(result?.files[0]?.incomplete).toBe(true);
    expect(result?.files[0]?.omittedChars).toBe(500);
  });

  it('截断时优先采信信封自报的完整计数，不显示 +0/-0', () => {
    // 真实事故形态：13596 / 15235 字符的文件，前 8000 字符完全相同，
    // 改动全在截断点之后。前缀 diff 会算出 +0/-0（看起来「没改」），
    // 而 filediff 里保存着瘦身之前算好的真实计数。
    const truncated = {
      before: 'const a = 1;\n…[truncated, 5596 chars omitted]',
      after: 'const a = 1;\n…[truncated, 7235 chars omitted]',
      created: false,
      filediff: {
        file: '/tmp/big.ts',
        before: '',
        after: '',
        additions: 115,
        deletions: 33,
        status: 'modified',
      },
      success: true,
      path: '/tmp/big.ts',
    };
    const result = buildFileSnapshotChangeResult(truncated, null);
    const entry = result?.files[0];
    expect(entry?.incomplete).toBe(true);
    // 关键：不能因为前缀无差异就声称 +0/-0
    expect(entry?.additions).toBe(115);
    expect(entry?.deletions).toBe(33);
  });

  it('自报计数只有一半时不采信（避免拼出自相矛盾的统计）', () => {
    const truncated = {
      before: 'const a = 1;\n…[truncated, 900 chars omitted]',
      after: 'const a = 2;\n…[truncated, 900 chars omitted]',
      created: false,
      filediff: { file: '/tmp/z.ts', additions: 115 },
      success: true,
      path: '/tmp/z.ts',
    };
    const result = buildFileSnapshotChangeResult(truncated, null);
    // 退回前缀计数：只有 1 处替换，而不是「+115 / -0」
    expect(result?.files[0]?.additions).toBe(1);
    expect(result?.files[0]?.deletions).toBe(1);
  });

  it('完整快照不采信自报计数，仍以内容为准', () => {
    // 自报值故意写错，确认完整快照路径不受影响
    const result = buildFileSnapshotChangeResult(
      { ...WRITE_OUTPUT, filediff: { ...WRITE_OUTPUT.filediff, additions: 999, deletions: 999 } },
      null,
    );
    expect(result?.files[0]?.additions).not.toBe(999);
  });

  it('截断后两侧都为空时不接管（没有可画的内容）', () => {
    const truncated = {
      ...WRITE_OUTPUT,
      before: '…[truncated, 10 chars omitted]',
      after: '…[truncated, 10 chars omitted]',
    };
    expect(buildFileSnapshotChangeResult(truncated, null)).toBeNull();
  });

  it('无截断标记但被标记为不完整时仍不接管（尊重既有完整性语义）', () => {
    expect(buildFileSnapshotChangeResult({ ...WRITE_OUTPUT, status: 'partial' }, null)).toBeNull();
  });

  it('JSON 文本被截断时返回 null', () => {
    const partial = JSON.stringify(WRITE_OUTPUT).slice(0, 120);
    expect(buildFileSnapshotChangeResult(partial, null)).toBeNull();
  });

  it('非信封形状（例如 patch 的 files 数组）不接管', () => {
    expect(buildFileSnapshotChangeResult({ success: true, files: [] }, null)).toBeNull();
    expect(buildFileSnapshotChangeResult('纯文本错误信息', null)).toBeNull();
    expect(buildFileSnapshotChangeResult(null, null)).toBeNull();
  });

  it('原始输出原样透传，供原始结果复制', () => {
    const raw = JSON.stringify(WRITE_OUTPUT);
    const result = buildFileSnapshotChangeResult(WRITE_OUTPUT, raw);
    expect(result?.raw).toBe(raw);
  });
});
