import { describe, expect, it } from 'vitest';
import {
  PatchTextError,
  deriveUpdatedText,
  ensureTrailingNewline,
  parsePatchText,
} from '../../tools/patch-text.js';

const FILE = '/repo/src/sample.ts';

function updateChunksOf(patchText: string) {
  const actions = parsePatchText(patchText);
  const action = actions[0];
  if (action?.type !== 'update') {
    throw new Error(`expected a single update action, got ${action?.type ?? 'none'}`);
  }
  return action.chunks;
}

describe('parsePatchText', () => {
  it('拒绝缺少 Begin / End 信封的输入', () => {
    expect(() => parsePatchText('*** Add File: /repo/a.txt\n+hi')).toThrow(PatchTextError);
    expect(() => parsePatchText('*** Add File: /repo/a.txt\n+hi')).toThrow(
      /the first line of the patch must be '\*\*\* Begin Patch'/,
    );
    expect(() => parsePatchText('*** Begin Patch\n*** Add File: /repo/a.txt\n+hi')).toThrow(
      /the last line of the patch must be '\*\*\* End Patch'/,
    );
  });

  it('解析 Add File 内容并按行保留内部换行', () => {
    const actions = parsePatchText(
      ['*** Begin Patch', '*** Add File: /repo/a.txt', '+one', '+two', '*** End Patch'].join('\n'),
    );
    expect(actions).toEqual([{ type: 'add', path: '/repo/a.txt', content: 'one\ntwo' }]);
  });

  it('Add File 出现非 + 前缀行时给出行号', () => {
    expect(() =>
      parsePatchText(
        ['*** Begin Patch', '*** Add File: /repo/a.txt', '+ok', 'oops', '*** End Patch'].join('\n'),
      ),
    ).toThrow(/Invalid hunk at line 4: Invalid Add File line/);
  });

  it('解析 Delete File，并拒绝带正文行的删除块', () => {
    expect(
      parsePatchText(
        ['*** Begin Patch', '*** Delete File: /repo/a.txt', '*** End Patch'].join('\n'),
      ),
    ).toEqual([{ type: 'delete', path: '/repo/a.txt' }]);

    expect(() =>
      parsePatchText(
        ['*** Begin Patch', '*** Delete File: /repo/a.txt', 'extra', '*** End Patch'].join('\n'),
      ),
    ).toThrow(/Delete hunks do not contain body lines/);
  });

  it('容忍操作头之间的纯空行（Begin 之后与 Delete 之后）', () => {
    expect(
      parsePatchText(
        ['*** Begin Patch', '', '*** Add File: /repo/c.txt', '+hi', '*** End Patch'].join('\n'),
      ),
    ).toEqual([{ type: 'add', path: '/repo/c.txt', content: 'hi' }]);

    expect(
      parsePatchText(
        ['*** Begin Patch', '*** Delete File: /repo/a.txt', '', '*** End Patch'].join('\n'),
      ),
    ).toEqual([{ type: 'delete', path: '/repo/a.txt' }]);
  });

  it('解析 Move to / @@ 锚点 / End of File', () => {
    const actions = parsePatchText(
      [
        '*** Begin Patch',
        `*** Update File: ${FILE}`,
        '*** Move to: /repo/src/renamed.ts',
        '@@ function greet() {',
        '-  return 1;',
        '+  return 2;',
        '*** End of File',
        '*** End Patch',
      ].join('\n'),
    );
    expect(actions).toEqual([
      {
        type: 'update',
        path: FILE,
        moveTo: '/repo/src/renamed.ts',
        chunks: [
          {
            anchor: 'function greet() {',
            endOfFile: true,
            oldLines: ['  return 1;'],
            newLines: ['  return 2;'],
          },
        ],
      },
    ]);
  });

  it('空 Move to 直接报错', () => {
    expect(() =>
      parsePatchText(
        ['*** Begin Patch', `*** Update File: ${FILE}`, '*** Move to:', '*** End Patch'].join('\n'),
      ),
    ).toThrow(/Move destination for '\/repo\/src\/sample.ts' must not be empty/);
  });

  it('忽略信封内的 Environment ID 行，并剥离 heredoc 包裹', () => {
    const wrapped =
      "cat <<'EOF'\n" +
      [
        '*** Begin Patch',
        '*** Environment ID: abc-123',
        '*** Add File: /repo/b.txt',
        '+hi',
        '*** End Patch',
      ].join('\n') +
      '\nEOF';
    expect(parsePatchText(wrapped)).toEqual([{ type: 'add', path: '/repo/b.txt', content: 'hi' }]);
  });

  it('Update 块没有任何行时报错', () => {
    expect(() =>
      parsePatchText(
        ['*** Begin Patch', `*** Update File: ${FILE}`, '@@', '*** End Patch'].join('\n'),
      ),
    ).toThrow(/Update hunk does not contain any lines/);
  });
});

describe('deriveUpdatedText', () => {
  it('应用单个替换块', () => {
    const chunks = updateChunksOf(
      [
        '*** Begin Patch',
        `*** Update File: ${FILE}`,
        '@@',
        ' const a = 1;',
        '-const b = 2;',
        '+const b = 3;',
        '*** End Patch',
      ].join('\n'),
    );
    const derived = deriveUpdatedText({
      chunks,
      original: 'const a = 1;\nconst b = 2;\n',
      path: FILE,
    });
    expect(derived.content).toBe('const a = 1;\nconst b = 3;\n');
    expect(derived.eol).toBe('\n');
  });

  it('多块顺序推进：前块写入的内容不会成为后块的匹配目标', () => {
    const chunks = updateChunksOf(
      [
        '*** Begin Patch',
        `*** Update File: ${FILE}`,
        '@@',
        '-A',
        '+B',
        '@@',
        '-B',
        '+C',
        '*** End Patch',
      ].join('\n'),
    );
    const derived = deriveUpdatedText({ chunks, original: 'A\nB\n', path: FILE });
    expect(derived.content).toBe('B\nC\n');
  });

  it('@@ 锚点先定位再匹配块体', () => {
    const chunks = updateChunksOf(
      [
        '*** Begin Patch',
        `*** Update File: ${FILE}`,
        '@@ function greet() {',
        '-  return 1;',
        '+  return 2;',
        '*** End Patch',
      ].join('\n'),
    );
    const derived = deriveUpdatedText({
      chunks,
      original: 'const before = 1;\nfunction greet() {\n  return 1;\n}\n',
      path: FILE,
    });
    expect(derived.content).toBe('const before = 1;\nfunction greet() {\n  return 2;\n}\n');
  });

  it('锚点找不到时给出可读错误', () => {
    const chunks = updateChunksOf(
      [
        '*** Begin Patch',
        `*** Update File: ${FILE}`,
        '@@ missing()',
        '-a',
        '+b',
        '*** End Patch',
      ].join('\n'),
    );
    expect(() => deriveUpdatedText({ chunks, original: 'a\n', path: FILE })).toThrow(
      new RegExp(`Failed to find context 'missing\\(\\)' in ${FILE.replace(/[/.]/g, '\\$&')}`),
    );
  });

  it('按 rstrip / 归一化阶梯放宽匹配（尾随空格与智能引号）', () => {
    const trailing = updateChunksOf(
      [
        '*** Begin Patch',
        `*** Update File: ${FILE}`,
        '@@',
        '-const s = "hi";',
        '+const s = "yo";',
        '*** End Patch',
      ].join('\n'),
    );
    expect(
      deriveUpdatedText({
        chunks: trailing,
        original: 'const s = "hi";   \n',
        path: FILE,
      }).content,
    ).toBe('const s = "yo";\n');

    const smart = updateChunksOf(
      [
        '*** Begin Patch',
        `*** Update File: ${FILE}`,
        '@@',
        '-const s = "hi";',
        '+const s = "yo";',
        '*** End Patch',
      ].join('\n'),
    );
    expect(
      deriveUpdatedText({ chunks: smart, original: 'const s = \u201chi\u201d;\n', path: FILE })
        .content,
    ).toBe('const s = "yo";\n');
  });

  it('保留 CRLF 与 BOM', () => {
    const chunks = updateChunksOf(
      ['*** Begin Patch', `*** Update File: ${FILE}`, '@@', '-b', '+B', '*** End Patch'].join('\n'),
    );
    const derived = deriveUpdatedText({ chunks, original: '\uFEFFa\r\nb\r\n', path: FILE });
    expect(derived.content).toBe('\uFEFFa\r\nB\r\n');
    expect(derived.eol).toBe('\r\n');
  });

  it('End of File 只认文件末尾', () => {
    const chunks = updateChunksOf(
      [
        '*** Begin Patch',
        `*** Update File: ${FILE}`,
        '@@',
        '-omega',
        '+OMEGA',
        '*** End of File',
        '*** End Patch',
      ].join('\n'),
    );
    expect(
      deriveUpdatedText({ chunks, original: 'alpha\nbeta\nomega\n', path: FILE }).content,
    ).toBe('alpha\nbeta\nOMEGA\n');

    expect(() => deriveUpdatedText({ chunks, original: 'omega\nalpha\n', path: FILE })).toThrow(
      /Failed to find expected lines in/,
    );
  });

  it('容忍补丁尾部的空上下文行（文件末尾无换行场景）', () => {
    const chunks = updateChunksOf(
      [
        '*** Begin Patch',
        `*** Update File: ${FILE}`,
        '@@',
        ' a',
        '-b',
        '+B',
        '',
        '*** End Patch',
      ].join('\n'),
    );
    expect(deriveUpdatedText({ chunks, original: 'a\nb\n', path: FILE }).content).toBe('a\nB\n');
  });

  it('匹配失败时回显期望行，便于模型自查重试', () => {
    const chunks = updateChunksOf(
      [
        '*** Begin Patch',
        `*** Update File: ${FILE}`,
        '@@',
        '-not-here',
        '+x',
        '*** End Patch',
      ].join('\n'),
    );
    expect(() => deriveUpdatedText({ chunks, original: 'a\n', path: FILE })).toThrow(
      /Failed to find expected lines in .*sample\.ts:\nnot-here/,
    );
  });
});

describe('ensureTrailingNewline', () => {
  it('空文件保持为空，其余补足换行', () => {
    expect(ensureTrailingNewline('')).toBe('');
    expect(ensureTrailingNewline('hi')).toBe('hi\n');
    expect(ensureTrailingNewline('hi\n')).toBe('hi\n');
  });
});
