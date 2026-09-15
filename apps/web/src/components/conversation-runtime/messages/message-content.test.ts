/**
 * message-content 把网关未校验的 `MessageContent[]` 投影成客户端展示模型：
 * 每个导出都必须能吞掉畸形 JSON 而不抛错，并在未知 shape 下给出稳定的
 * 输出形状。这里逐函数钉住 happy path / 空输入 / 畸形输入。
 */
import { describe, expect, it } from 'vitest';
import {
  extractDisplayText,
  extractInputImages,
  extractModifiedFilesSummary,
  extractTextFragments,
  extractToolCalls,
  extractToolResults,
  parseFileDiffContent,
  parseModifiedFilesSummaryContent,
  parseToolCallObservability,
} from './message-content.js';

describe('extractDisplayText', () => {
  it('把文本分片用换行拼接并 trim', () => {
    expect(
      extractDisplayText([
        { type: 'text', text: '第一段' },
        { type: 'text', text: '第二段' },
      ]),
    ).toBe('第一段\n第二段');
  });

  it('空白分片与非文本内容不产出文案', () => {
    expect(extractDisplayText([{ type: 'text', text: '   ' }, { type: 'tool_call' }])).toBe('');
    expect(extractDisplayText([])).toBe('');
  });

  it('畸形数组元素被静默跳过', () => {
    expect(extractDisplayText([null, 42, { type: 'text', text: 'ok' }])).toBe('ok');
  });
});

describe('extractTextFragments', () => {
  it('字符串原样保留（不做 trim），纯空白返回空数组', () => {
    expect(extractTextFragments('  hi  ')).toEqual(['  hi  ']);
    expect(extractTextFragments('   ')).toEqual([]);
  });

  it('递归展开嵌套数组', () => {
    expect(extractTextFragments(['a', ['b', ['c']], null, 7])).toEqual(['a', 'b', 'c']);
  });

  it('识别 text / input_text / output_text，并过滤 synthetic 内部片段', () => {
    expect(
      extractTextFragments([
        { type: 'text', text: 'A' },
        { type: 'input_text', text: 'B' },
        { type: 'output_text', text: 'C' },
        { type: 'text', text: '<system-reminder>', synthetic: true },
      ]),
    ).toEqual(['A', 'B', 'C']);
  });

  it('reasoning 记录（含 field 形态）不贡献展示文案', () => {
    expect(
      extractTextFragments([
        { type: 'reasoning', text: 'thought' },
        { type: 'thinking', text: 'thought' },
        { field: 'reasoning_content', text: 'thought' },
      ]),
    ).toEqual([]);
  });

  it('tool_call / tool_result 记录不贡献展示文案', () => {
    expect(
      extractTextFragments([
        { type: 'tool_call', text: 'call' },
        { type: 'tool_result', text: 'result' },
      ]),
    ).toEqual([]);
  });

  it('未知 type 回退到候选文本字段（text/title/…）', () => {
    expect(extractTextFragments({ type: 'mystery', text: 'body', title: 'Title' })).toEqual([
      'body',
      'Title',
    ]);
  });
});

describe('extractInputImages', () => {
  it('提取全部可选字段', () => {
    expect(
      extractInputImages([
        {
          type: 'input_image',
          artifactId: 'artifact-1',
          detail: 'high',
          fileId: 'file-1',
          fileName: 'photo.png',
          imageUrl: 'https://example.test/photo.png',
          mimeType: 'image/png',
        },
      ]),
    ).toEqual([
      {
        artifactId: 'artifact-1',
        detail: 'high',
        fileId: 'file-1',
        fileName: 'photo.png',
        imageUrl: 'https://example.test/photo.png',
        mimeType: 'image/png',
      },
    ]);
  });

  it('最小 input_image 产出空对象，非法 detail / 非字符串字段被丢弃', () => {
    expect(extractInputImages([{ type: 'input_image' }])).toEqual([{}]);
    expect(
      extractInputImages([{ type: 'input_image', detail: 'huge', fileId: 7, fileName: null }]),
    ).toEqual([{}]);
  });

  it('非 input_image 与畸形元素被跳过', () => {
    expect(
      extractInputImages([
        null,
        'x',
        { type: 'text', text: 'a' },
        { type: 'input_image', fileId: 'file-1' },
      ]),
    ).toEqual([{ fileId: 'file-1' }]);
  });
});

describe('extractToolCalls', () => {
  it('只提取字段完整的 tool_call（input 必须是普通对象）', () => {
    expect(
      extractToolCalls([
        { type: 'tool_call', toolCallId: 't1', toolName: 'read', input: { file: 'a.ts' } },
        { type: 'tool_call', toolCallId: 't2', toolName: 'echo', input: {} },
        { type: 'tool_call', toolCallId: 't3', toolName: 'drop', input: [1] },
        { type: 'tool_call', toolCallId: 't4', toolName: 'drop' },
        { type: 'tool_call', toolCallId: 5, toolName: 'drop', input: {} },
        { type: 'tool_result', toolCallId: 't5', output: 'x' },
        null,
      ]),
    ).toEqual([
      { toolCallId: 't1', toolName: 'read', input: { file: 'a.ts' } },
      { toolCallId: 't2', toolName: 'echo', input: {} },
    ]);
  });
});

describe('extractToolResults', () => {
  it('提取最小结果并补 isError=false', () => {
    expect(extractToolResults([{ type: 'tool_result', toolCallId: 't1', output: 'ok' }])).toEqual([
      { toolCallId: 't1', output: 'ok', isError: false },
    ]);
  });

  it('合并可选字段：clientRequestId / fileDiffs / observability / 审批标记', () => {
    const [result] = extractToolResults([
      {
        type: 'tool_result',
        toolCallId: 't1',
        toolName: 'write',
        clientRequestId: 'req-1',
        output: null,
        isError: true,
        fileDiffs: [{ file: 'a.ts', before: '', after: 'x', additions: 1, deletions: 0 }],
        observability: { presentedToolName: 'presented', canonicalToolName: 'canonical' },
        pendingPermissionRequestId: 'perm-1',
        resumedAfterApproval: true,
      },
    ]);

    expect(result).toMatchObject({
      toolCallId: 't1',
      toolName: 'write',
      clientRequestId: 'req-1',
      output: null,
      isError: true,
      pendingPermissionRequestId: 'perm-1',
      resumedAfterApproval: true,
    });
    expect(result?.fileDiffs).toHaveLength(1);
    expect(result?.fileDiffs?.[0]?.file).toBe('a.ts');
    expect(result?.observability).toStrictEqual({
      presentedToolName: 'presented',
      canonicalToolName: 'canonical',
      adapterVersion: undefined,
    });
  });

  it('resumedAfterApproval 仅在 true 时出现；observability 无有效字段时省略', () => {
    const [result] = extractToolResults([
      {
        type: 'tool_result',
        toolCallId: 't1',
        output: 'ok',
        isError: false,
        resumedAfterApproval: 'yes',
        observability: { presentedToolName: '   ' },
      },
    ]);

    expect(result).toStrictEqual({ toolCallId: 't1', output: 'ok', isError: false });
  });

  it('fileDiffs 为数组但条目全非法时仍保留空数组', () => {
    const [result] = extractToolResults([
      { type: 'tool_result', toolCallId: 't1', output: 'ok', fileDiffs: [{ file: 'a.ts' }] },
    ]);

    expect(result?.fileDiffs).toEqual([]);
  });

  it('缺少 toolCallId 或类型不符的条目被跳过', () => {
    expect(
      extractToolResults([
        null,
        'junk',
        { type: 'tool_result', output: 'x' },
        { type: 'text', toolCallId: 't1' },
      ]),
    ).toEqual([]);
  });
});

describe('extractModifiedFilesSummary / parseModifiedFilesSummaryContent', () => {
  const summary = {
    type: 'modified_files_summary' as const,
    title: '修改文件',
    summary: '共 1 个文件',
    files: [{ file: 'a.ts', before: '', after: 'x', additions: 1, deletions: 0 }],
  };

  it('返回 content 中第一个合法的 modified_files_summary', () => {
    expect(
      extractModifiedFilesSummary([
        { type: 'text', text: 'ignored' },
        { type: 'modified_files_summary', title: 'bad', summary: 'bad', files: [] },
        summary,
      ]),
    ).toMatchObject({ title: '修改文件', summary: '共 1 个文件' });
  });

  it('没有任何合法摘要时返回 null', () => {
    expect(extractModifiedFilesSummary([])).toBeNull();
    expect(extractModifiedFilesSummary([null, { type: 'text', text: 'x' }])).toBeNull();
  });

  it('parseModifiedFilesSummaryContent 拒绝畸形输入', () => {
    expect(parseModifiedFilesSummaryContent(null)).toBeNull();
    expect(parseModifiedFilesSummaryContent([])).toBeNull();
    expect(parseModifiedFilesSummaryContent({ ...summary, type: 'other' })).toBeNull();
    expect(parseModifiedFilesSummaryContent({ ...summary, title: 1 })).toBeNull();
    expect(parseModifiedFilesSummaryContent({ ...summary, files: 'x' })).toBeNull();
    expect(parseModifiedFilesSummaryContent({ ...summary, files: [{ file: 'a.ts' }] })).toBeNull();
  });

  it('parseModifiedFilesSummaryContent 解析文件条目', () => {
    const parsed = parseModifiedFilesSummaryContent(summary);
    expect(parsed?.files).toHaveLength(1);
    expect(parsed?.files[0]).toMatchObject({ file: 'a.ts', additions: 1, deletions: 0 });
  });
});

describe('parseFileDiffContent', () => {
  it('缺失必需字段或类型不符返回空数组', () => {
    expect(parseFileDiffContent(null)).toEqual([]);
    expect(parseFileDiffContent([{ file: 'a.ts' }])).toEqual([]);
    expect(parseFileDiffContent({ file: 'a.ts', before: '', after: 'x' })).toEqual([]);
    expect(
      parseFileDiffContent({ file: 'a.ts', before: '', after: 'x', additions: '1', deletions: 0 }),
    ).toEqual([]);
  });

  it('解析合法 diff 并归一化可选字段', () => {
    const [diff] = parseFileDiffContent({
      file: 'src/a.ts',
      before: 'old',
      after: 'new',
      additions: 3,
      deletions: 1,
      status: 'modified',
      clientRequestId: 'req-1',
      requestId: 'run-1',
      toolName: 'edit',
      toolCallId: 'tool-1',
      sourceKind: 'structured_tool_diff',
      guaranteeLevel: 'strong',
      observability: { canonicalToolName: 'edit_file' },
      backupBeforeRef: { backupId: 'backup-1', kind: 'before_write', storagePath: '/tmp/b' },
    });

    expect(diff).toMatchObject({
      file: 'src/a.ts',
      additions: 3,
      deletions: 1,
      status: 'modified',
      clientRequestId: 'req-1',
      sourceKind: 'structured_tool_diff',
      guaranteeLevel: 'strong',
    });
    expect(diff?.backupBeforeRef).toMatchObject({ backupId: 'backup-1', kind: 'before_write' });
    expect(diff?.observability?.canonicalToolName).toBe('edit_file');
  });

  it('非法 status 被丢弃；未做白名单校验的 sourceKind / guaranteeLevel 原样透传', () => {
    const [diff] = parseFileDiffContent({
      file: 'a.ts',
      before: '',
      after: '',
      additions: 0,
      deletions: 0,
      status: 'renamed',
      sourceKind: 'not_a_real_kind',
      guaranteeLevel: 'bogus',
    });

    expect(diff?.status).toBeUndefined();
    // 现状：这两个字段只 trim 后强转类型，没有运行时白名单校验。
    expect(diff?.sourceKind).toBe('not_a_real_kind');
    expect(diff?.guaranteeLevel).toBe('bogus');
  });

  it('backupRef 缺少 backupId / kind 时整体丢弃', () => {
    const [diff] = parseFileDiffContent({
      file: 'a.ts',
      before: '',
      after: '',
      additions: 0,
      deletions: 0,
      backupAfterRef: { backupId: '', kind: 'after_write' },
    });

    expect(diff?.backupAfterRef).toBeUndefined();
  });
});

describe('parseToolCallObservability', () => {
  it('非对象或三字段全空时返回 undefined', () => {
    expect(parseToolCallObservability(null)).toBeUndefined();
    expect(parseToolCallObservability('x')).toBeUndefined();
    expect(parseToolCallObservability({})).toBeUndefined();
    expect(
      parseToolCallObservability({ presentedToolName: '  ', adapterVersion: 3 }),
    ).toBeUndefined();
  });

  it('trim 后返回全部三个键（缺省键显式为 undefined）', () => {
    expect(parseToolCallObservability({ canonicalToolName: '  edit_file  ' })).toStrictEqual({
      presentedToolName: undefined,
      canonicalToolName: 'edit_file',
      adapterVersion: undefined,
    });
  });
});
