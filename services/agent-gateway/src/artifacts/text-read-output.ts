import { extname } from 'node:path';

/**
 * 上限与输出格式镜像 opencode `tool/read.ts`（`DEFAULT_READ_LIMIT` /
 * `MAX_LINE_LENGTH` / `MAX_BYTES` / `<path><type><content>` 包裹与截断提示），
 * 便于模型对「读到的文件」形成一致预期。
 */
const DEFAULT_READ_LIMIT = 2000;
const MAX_LINE_LENGTH = 2000;
const MAX_LINE_SUFFIX = `... (line truncated to ${MAX_LINE_LENGTH} chars)`;
const MAX_BYTES = 50 * 1024;
const MAX_BYTES_LABEL = `${MAX_BYTES / 1024} KB`;
const SAMPLE_BYTES = 4096;

const BINARY_EXTENSIONS = new Set([
  '.zip',
  '.tar',
  '.gz',
  '.exe',
  '.dll',
  '.so',
  '.class',
  '.jar',
  '.war',
  '.7z',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.odt',
  '.ods',
  '.odp',
  '.bin',
  '.dat',
  '.obj',
  '.o',
  '.a',
  '.lib',
  '.wasm',
  '.pyc',
  '.pyo',
]);

export interface TextReadOutput {
  readonly text: string;
  readonly totalLines: number;
  readonly truncated: boolean;
}

export function isBinaryContent(fileName: string, sample: Buffer): boolean {
  if (BINARY_EXTENSIONS.has(extname(fileName).toLowerCase())) {
    return true;
  }
  if (sample.length === 0) {
    return false;
  }

  let nonPrintable = 0;
  for (const byte of sample) {
    if (byte === 0) {
      return true;
    }
    if (byte < 9 || (byte > 13 && byte < 32)) {
      nonPrintable += 1;
    }
  }
  return nonPrintable / sample.length > 0.3;
}

function splitContentLines(content: string): string[] {
  const lines = content.split(/\r?\n/);
  if (lines.length > 1 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines;
}

export function formatTextReadOutput(options: {
  readonly buffer: Buffer;
  readonly displayPath: string;
  readonly offset?: number;
  readonly limit?: number;
}): TextReadOutput | undefined {
  const { buffer, displayPath } = options;
  if (buffer.byteLength === 0 || isBinaryContent(displayPath, buffer.subarray(0, SAMPLE_BYTES))) {
    return undefined;
  }

  const content = buffer.toString('utf-8');
  if (content.trim() === '') {
    return undefined;
  }

  const allLines = splitContentLines(content);
  const totalLines = allLines.length;
  const offset = options.offset ?? 1;
  const limit = options.limit ?? DEFAULT_READ_LIMIT;

  const raw: string[] = [];
  let bytes = 0;
  let cut = false;
  let more = false;
  for (let index = Math.max(0, offset - 1); index < allLines.length; index += 1) {
    if (raw.length >= limit) {
      more = true;
      break;
    }
    const source = allLines[index] ?? '';
    const line =
      source.length > MAX_LINE_LENGTH ? source.slice(0, MAX_LINE_LENGTH) + MAX_LINE_SUFFIX : source;
    const size = Buffer.byteLength(line, 'utf-8') + (raw.length > 0 ? 1 : 0);
    if (bytes + size > MAX_BYTES) {
      cut = true;
      more = true;
      break;
    }
    raw.push(line);
    bytes += size;
  }

  const last = offset + raw.length - 1;
  const next = last + 1;
  let output = [`<path>${displayPath}</path>`, '<type>file</type>', '<content>\n'].join('\n');
  output += raw.map((line, index) => `${index + offset}: ${line}`).join('\n');
  if (cut) {
    output += `\n\n(Output capped at ${MAX_BYTES_LABEL}. Showing lines ${offset}-${last}. Use offset=${next} to continue.)`;
  } else if (more) {
    output += `\n\n(Showing lines ${offset}-${last} of ${totalLines}. Use offset=${next} to continue.)`;
  } else {
    output += `\n\n(End of file - total ${totalLines} lines)`;
  }
  output += '\n</content>';

  return { text: output, totalLines, truncated: cut || more };
}
