/**
 * 结构化补丁文本（`patch` 工具）的解析与内容推导。
 *
 * 协议对齐 opencode v2 的参考实现（`packages/util/src/patch.ts`）：
 * - 信封：`*** Begin Patch` / `*** End Patch`
 * - 文件操作头：`*** Add File:` / `*** Delete File:` / `*** Update File:`（可带 `*** Move to:`）
 * - 更新块：`@@ [上下文锚点]` + 空格上下文 / `-` 删除 / `+` 新增行，`*** End of File` 锚定文件末尾
 * - 匹配阶梯：exact → rstrip → trim → Unicode 归一化（智能引号 / 破折号 / 特殊空格）
 * - 兼容 BOM、CRLF、`cat <<'EOF' ... EOF` 包裹，以及首行的 `*** Environment ID:` 标记
 *
 * 本模块是纯函数层：只做解析与内容推导，文件读写 / 权限 / 备份由调用方负责。
 * 失败一律抛 `PatchTextError`，其 message 直接面向模型（英文，便于按格式自查重试）。
 */

const PATCH_BEGIN = '*** Begin Patch';
const PATCH_END = '*** End Patch';
const ADD_FILE_PREFIX = '*** Add File: ';
const DELETE_FILE_PREFIX = '*** Delete File: ';
const UPDATE_FILE_PREFIX = '*** Update File: ';
const MOVE_TO_PREFIX = '*** Move to: ';
const ENVIRONMENT_ID_PREFIX = '*** Environment ID:';
const END_OF_FILE = '*** End of File';
const ANCHOR_PREFIX = '@@ ';
const BOM = '\uFEFF';

export class PatchTextError extends Error {
  readonly lineNumber: number | undefined;

  constructor(message: string, lineNumber?: number) {
    super(lineNumber === undefined ? message : `Invalid hunk at line ${lineNumber}: ${message}`);
    this.name = 'PatchTextError';
    this.lineNumber = lineNumber;
  }
}

export interface PatchUpdateChunk {
  /** `@@ <text>` 定位锚点：应用前必须先找到该行，块体从其后开始匹配。 */
  readonly anchor: string | undefined;
  /** `*** End of File`：块体必须命中文件末尾。 */
  readonly endOfFile: boolean;
  readonly newLines: readonly string[];
  readonly oldLines: readonly string[];
}

export type PatchAction =
  | { readonly content: string; readonly path: string; readonly type: 'add' }
  | { readonly path: string; readonly type: 'delete' }
  | {
      readonly chunks: readonly PatchUpdateChunk[];
      readonly moveTo: string | undefined;
      readonly path: string;
      readonly type: 'update';
    };

export interface DerivedPatchText {
  /** 推导后的完整文件内容（保留原始 BOM）。 */
  readonly content: string;
  /** 原始文件使用的换行符，写回时保持一致。 */
  readonly eol: '\n' | '\r\n';
}

/** Add File 的内容始终以换行收尾（空文件除外），与参考实现保持一致。 */
export function ensureTrailingNewline(content: string): string {
  return content === '' || content.endsWith('\n') ? content : `${content}\n`;
}

export function parsePatchText(patchText: string): PatchAction[] {
  const lines = stripHeredoc(patchText.trim())
    .split('\n')
    .map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));

  if (lines[0]?.trim() !== PATCH_BEGIN || lines.length < 2) {
    throw new PatchTextError(
      "patch rejected: the first line of the patch must be '*** Begin Patch'",
    );
  }
  const end = lines.length - 1;
  if (lines.at(-1)?.trim() !== PATCH_END) {
    throw new PatchTextError("patch rejected: the last line of the patch must be '*** End Patch'");
  }

  const actions: PatchAction[] = [];
  let index = 1;

  while (index < end) {
    const header = (lines[index] ?? '').trim();

    // Codex 系模型偶尔会在信封内带上环境标识行，直接忽略。
    if (
      index === 1 &&
      header.startsWith(ENVIRONMENT_ID_PREFIX) &&
      header.slice(ENVIRONMENT_ID_PREFIX.length).trim().length > 0
    ) {
      index += 1;
      continue;
    }

    // 有意比参考实现宽松：操作头之间（含 `*** Begin Patch` 之后）的纯空行没有
    // 语义，历史解析器也一直容忍，直接跳过可少一轮模型重试。
    if (header.length === 0) {
      index += 1;
      continue;
    }

    if (header.startsWith(ADD_FILE_PREFIX)) {
      const path = header.slice(ADD_FILE_PREFIX.length).trim();
      const parsed = parseAddHunk(lines, index + 1, end, path);
      actions.push({ content: parsed.content, path, type: 'add' });
      index = parsed.next;
      continue;
    }

    if (header.startsWith(DELETE_FILE_PREFIX)) {
      const path = header.slice(DELETE_FILE_PREFIX.length).trim();
      const next = (lines[index + 1] ?? '').trim();
      // 同上的宽松处理：删除块没有正文，紧邻的空行忽略；真正的正文行仍然拒绝。
      if (index + 1 < end && next.length > 0 && !isBoundary(next)) {
        throw new PatchTextError(
          next.startsWith('*** ')
            ? `'${next}' is not a valid hunk header. Valid hunk headers: '*** Add File: {path}', '*** Delete File: {path}', '*** Update File: {path}'`
            : `Unexpected line after Delete File '${path}': '${next}'. Delete hunks do not contain body lines`,
          index + 2,
        );
      }
      actions.push({ path, type: 'delete' });
      index += 1;
      continue;
    }

    if (header.startsWith(UPDATE_FILE_PREFIX)) {
      const path = header.slice(UPDATE_FILE_PREFIX.length).trim();
      let next = index + 1;
      while ((lines[next] ?? '').trimEnd() === END_OF_FILE) next += 1;

      let moveTo: string | undefined;
      const move = (lines[next] ?? '').trimEnd();
      if (move === MOVE_TO_PREFIX.trimEnd() || move.startsWith(MOVE_TO_PREFIX)) {
        moveTo = move.slice(MOVE_TO_PREFIX.length).trim();
        if (moveTo.length === 0) {
          throw new PatchTextError(`Move destination for '${path}' must not be empty`, next + 1);
        }
        next += 1;
      }

      const parsed = parseUpdateHunks(lines, next, end, path, index);
      actions.push({ chunks: parsed.chunks, moveTo, path, type: 'update' });
      index = parsed.next;
      continue;
    }

    throw new PatchTextError(
      `'${header}' is not a valid hunk header. Valid hunk headers: '*** Add File: {path}', '*** Delete File: {path}', '*** Update File: {path}'`,
      index + 1,
    );
  }

  return actions;
}

/**
 * 把更新块应用到原始文件内容上。
 *
 * 与逐块 `String.replace` 的关键差异：块体按行匹配并顺序推进 `lineIndex`，同一
 * 段重复文本不会被反复命中首处；匹配失败时按阶梯放宽（见 `seek`），并在错误里
 * 回显期望行，模型可据此自查重试。
 */
export function deriveUpdatedText(input: {
  chunks: readonly PatchUpdateChunk[];
  original: string;
  path: string;
}): DerivedPatchText {
  const source = splitBom(input.original);
  const eol: '\n' | '\r\n' = source.text.includes('\r\n') ? '\r\n' : '\n';
  const lines = source.text.split(eol);
  if (lines.at(-1) === '') lines.pop();

  const replacements = computeReplacements(lines, input.path, input.chunks);
  for (const [start, remove, insert] of replacements.reverse()) {
    lines.splice(start, remove, ...insert);
  }
  if (lines.at(-1) !== '') lines.push('');

  return { content: joinBom(lines.join(eol), source.bom), eol };
}

function parseAddHunk(
  lines: readonly string[],
  start: number,
  end: number,
  path: string,
): { content: string; next: number } {
  const content: string[] = [];
  let index = start;
  while (index < end && !isBoundary((lines[index] ?? '').trim())) {
    const line = lines[index] ?? '';
    if (!line.startsWith('+')) {
      throw new PatchTextError(
        `Invalid Add File line for '${path}': expected a line starting with '+', got '${line.trim()}'`,
        index + 1,
      );
    }
    content.push(line.slice(1));
    index += 1;
  }
  return { content: content.join('\n'), next: index };
}

function parseUpdateHunks(
  lines: readonly string[],
  start: number,
  end: number,
  path: string,
  headerIndex: number,
): { chunks: PatchUpdateChunk[]; next: number } {
  const chunks: Array<{
    anchor: string | undefined;
    endOfFile: boolean;
    newLines: string[];
    oldLines: string[];
  }> = [];
  let index = start;
  let afterEndOfFile = false;

  while (index < end) {
    const line = lines[index] ?? '';
    const updateLine = line.trimEnd();

    if (afterEndOfFile) {
      if (updateLine === '') {
        index += 1;
        continue;
      }
      if (updateLine === '@@' || updateLine.startsWith(ANCHOR_PREFIX)) {
        afterEndOfFile = false;
      } else if (isBoundary(updateLine)) {
        break;
      } else {
        throw new PatchTextError(
          `Expected update hunk to start with a @@ context marker, got: '${line}'`,
          index + 1,
        );
      }
    }

    if (updateLine === END_OF_FILE) {
      const chunk = chunks.at(-1);
      if (chunk && chunk.oldLines.length === 0 && chunk.newLines.length === 0) {
        throw new PatchTextError('Update hunk does not contain any lines', index + 1);
      }
      if (chunk) {
        chunk.endOfFile = true;
        afterEndOfFile = true;
      }
      index += 1;
      continue;
    }

    if (isBoundary(updateLine)) break;

    if (updateLine === '@@' || updateLine.startsWith(ANCHOR_PREFIX)) {
      const previous = chunks.at(-1);
      if (previous && previous.oldLines.length === 0 && previous.newLines.length === 0) {
        throw new PatchTextError(
          `Unexpected line found in update hunk: '${line}'. Every line should start with ' ' (context line), '+' (added line), or '-' (removed line)`,
          index + 1,
        );
      }
      chunks.push({
        anchor: updateLine === '@@' ? undefined : updateLine.slice(ANCHOR_PREFIX.length),
        endOfFile: false,
        newLines: [],
        oldLines: [],
      });
      index += 1;
      continue;
    }

    let chunk = chunks.at(-1);
    if (!chunk) {
      chunk = { anchor: undefined, endOfFile: false, newLines: [], oldLines: [] };
      chunks.push(chunk);
    }

    if (line === '') {
      // 模型常省略行尾空格；空行按「两边都是空行」的上下文处理。
      chunk.oldLines.push('');
      chunk.newLines.push('');
      index += 1;
      continue;
    }
    if (line.startsWith(' ')) {
      chunk.oldLines.push(line.slice(1));
      chunk.newLines.push(line.slice(1));
      index += 1;
      continue;
    }
    if (line.startsWith('-')) {
      chunk.oldLines.push(line.slice(1));
      index += 1;
      continue;
    }
    if (line.startsWith('+')) {
      chunk.newLines.push(line.slice(1));
      index += 1;
      continue;
    }

    const populated = chunk.oldLines.length > 0 || chunk.newLines.length > 0;
    throw new PatchTextError(
      populated
        ? `Expected update hunk to start with a @@ context marker, got: '${line}'`
        : `Unexpected line found in update hunk: '${line}'. Every line should start with ' ' (context line), '+' (added line), or '-' (removed line)`,
      index + 1,
    );
  }

  if (chunks.length === 0) {
    throw new PatchTextError(`Update file hunk for path '${path}' is empty`, headerIndex + 1);
  }
  const lastChunk = chunks.at(-1);
  if (lastChunk && lastChunk.oldLines.length === 0 && lastChunk.newLines.length === 0) {
    const line = (lines[index] ?? '').trim();
    throw new PatchTextError(
      line === PATCH_END
        ? 'Update hunk does not contain any lines'
        : `Unexpected line found in update hunk: '${line}'. Every line should start with ' ' (context line), '+' (added line), or '-' (removed line)`,
      index + 1,
    );
  }

  return { chunks, next: index };
}

function isBoundary(line: string): boolean {
  return (
    line === PATCH_END ||
    line.startsWith(ADD_FILE_PREFIX) ||
    line.startsWith(DELETE_FILE_PREFIX) ||
    line.startsWith(UPDATE_FILE_PREFIX)
  );
}

function computeReplacements(
  lines: readonly string[],
  path: string,
  chunks: readonly PatchUpdateChunk[],
): Array<readonly [start: number, remove: number, insert: readonly string[]]> {
  const replacements: Array<readonly [start: number, remove: number, insert: readonly string[]]> =
    [];
  let lineIndex = 0;

  for (const chunk of chunks) {
    if (chunk.anchor !== undefined) {
      const anchorIndex = seek(lines, [chunk.anchor], lineIndex, false);
      if (anchorIndex === -1) {
        throw new PatchTextError(`Failed to find context '${chunk.anchor}' in ${path}`);
      }
      lineIndex = anchorIndex + 1;
    }

    if (chunk.oldLines.length === 0) {
      replacements.push([lines.length, 0, chunk.newLines]);
      continue;
    }

    let oldLines = chunk.oldLines;
    let newLines = chunk.newLines;
    let found = seek(lines, oldLines, lineIndex, chunk.endOfFile);
    if (found === -1 && oldLines.at(-1) === '') {
      // 文件末尾没有换行时，补丁里的收尾空行匹配不上；去掉尾部空行再试一次。
      oldLines = oldLines.slice(0, -1);
      if (newLines.at(-1) === '') newLines = newLines.slice(0, -1);
      found = seek(lines, oldLines, lineIndex, chunk.endOfFile);
    }
    if (found === -1 && chunk.oldLines.every((line) => line === '')) {
      const expected =
        chunk.oldLines.length === 1
          ? 'an expected blank line'
          : `${chunk.oldLines.length} consecutive blank lines`;
      throw new PatchTextError(`Failed to find ${expected} in ${path}`);
    }
    if (found === -1) {
      throw new PatchTextError(
        `Failed to find expected lines in ${path}:\n${chunk.oldLines.join('\n')}`,
      );
    }

    replacements.push([found, oldLines.length, newLines]);
    lineIndex = found + oldLines.length;
  }

  return replacements.sort((left, right) => left[0] - right[0]);
}

/** 从 `start` 起按 exact → rstrip → trim → 归一化的阶梯匹配；`eof` 时只认文件末尾。 */
function seek(
  lines: readonly string[],
  pattern: readonly string[],
  start: number,
  eof: boolean,
): number {
  if (pattern.length === 0) return -1;

  if (eof) {
    const offset = lines.length - pattern.length;
    if (offset < start) return -1;
    for (const compare of [exact, rstrip, trim, normalized]) {
      if (matches(lines, pattern, offset, compare)) return offset;
    }
    return -1;
  }

  for (const compare of [exact, rstrip, trim, normalized]) {
    for (let offset = start; offset <= lines.length - pattern.length; offset += 1) {
      if (matches(lines, pattern, offset, compare)) return offset;
    }
  }
  return -1;
}

function matches(
  lines: readonly string[],
  pattern: readonly string[],
  offset: number,
  compare: (left: string, right: string) => boolean,
): boolean {
  return pattern.every((line, index) => {
    const candidate = lines[offset + index];
    return candidate !== undefined && compare(candidate, line);
  });
}

const exact = (left: string, right: string): boolean => left === right;
const rstrip = (left: string, right: string): boolean => left.trimEnd() === right.trimEnd();
const trim = (left: string, right: string): boolean => left.trim() === right.trim();
const normalized = (left: string, right: string): boolean =>
  normalize(left.trim()) === normalize(right.trim());

const normalize = (value: string): string =>
  value
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[‐‑‒–—―−]/g, '-')
    .replace(/[\u00A0\u2002-\u200A\u202F\u205F\u3000]/g, ' ');

function stripHeredoc(input: string): string {
  const match = /^(?:cat\s+)?<<(['"]?)(\w+)\1\s*\n([\s\S]*?)\n\2\s*$/.exec(input);
  return match?.[3] ?? input;
}

function splitBom(text: string): { bom: boolean; text: string } {
  return text.startsWith(BOM) ? { bom: true, text: text.slice(BOM.length) } : { bom: false, text };
}

function joinBom(text: string, bom: boolean): string {
  return bom ? `${BOM}${text}` : text;
}
