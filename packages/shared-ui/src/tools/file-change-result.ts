import { parseJsonObjectTolerant } from './truncated-json.js';

// 网关在快照末尾追加标记；兼容旧的三点及无字符计数格式。
const SNAPSHOT_TRUNCATION_SUFFIX = /\n?(?:…|\.{3})\[truncated(?:, (\d+) chars omitted)?\]$/u;

export interface FileChangeResultEntry {
  action: 'update' | 'add' | 'delete' | 'move';
  path: string;
  moveTo?: string;
  before?: string;
  after?: string;
  additions?: number;
  deletions?: number;
  incomplete: boolean;
  /**
   * 快照被网关瘦身时省略的字符数（`…[truncated, N chars omitted]` 里的 N）。
   *
   * 只有「两侧都还有可用内容」时才会带上：此时 `before` / `after` 是截断后的前缀，
   * 仍然可以画出**部分**差异，只是不能声称它是完整对比。一侧完全缺失时不会走到这里。
   */
  omittedChars?: number;
}

export interface FileChangeResult {
  success: boolean;
  files: FileChangeResultEntry[];
  raw: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** 只识别明确的完整性标记，不把源码中的“截断”等普通文字当成元数据。 */
export function isIncompleteFileSnapshot(record: Record<string, unknown>): boolean {
  return (
    Object.entries(record).some(([key, value]) => {
      if (/truncated|incomplete|partial/i.test(key) && value !== false && value != null) {
        return true;
      }
      if (/complete/i.test(key) && !/incomplete/i.test(key) && value === false) return true;
      if (
        /status/i.test(key) &&
        typeof value === 'string' &&
        /truncat|partial|incomplete/i.test(value)
      ) {
        return true;
      }
      return /metadata|status/i.test(key) && isRecord(value) && isIncompleteFileSnapshot(value);
    }) ||
    [record['before'], record['after']].some(
      (text) => typeof text === 'string' && SNAPSHOT_TRUNCATION_SUFFIX.test(text),
    )
  );
}

/** 空字符串是有效快照；缺失一侧绝不能冒充空文件。 */
export function readFileSnapshot(record: Record<string, unknown>):
  | {
      before: string;
      after: string;
    }
  | undefined {
  if (isIncompleteFileSnapshot(record)) return undefined;
  const before = record['before'];
  const after = record['after'];
  return typeof before === 'string' && typeof after === 'string' ? { before, after } : undefined;
}

function readCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function readRetainedSnapshot(value: string | undefined) {
  const marker = value === undefined ? null : SNAPSHOT_TRUNCATION_SUFFIX.exec(value);
  const text = marker ? value?.slice(0, marker.index) : value;
  // 明确的空字符串是有效快照，只有截断标记的字符串则没有可比较的内容。
  return { text: marker && text === '' ? undefined : text, omittedChars: Number(marker?.[1] ?? 0) };
}

/** 与工具卡共用有界 JSON 解码；截断后的文本只可用于标明范围的部分差异。 */
export function parseFileChangeResult(output: unknown): FileChangeResult | null {
  const decoded = typeof output === 'string' ? parseJsonObjectTolerant(output) : null;
  const value = decoded?.value ?? output;
  if (!isRecord(value) || typeof value['success'] !== 'boolean' || !Array.isArray(value['files'])) {
    return null;
  }
  const files: FileChangeResultEntry[] = [];
  for (const entry of value['files'] as unknown[]) {
    if (!isRecord(entry)) return null;
    const action = entry['action'];
    const path = entry['path'];
    const rawBefore = entry['before'];
    const rawAfter = entry['after'];
    if (
      ['additions', 'deletions'].some(
        (key) => entry[key] !== undefined && readCount(entry[key]) === undefined,
      )
    )
      return null;
    if (
      (action !== 'update' && action !== 'add' && action !== 'delete' && action !== 'move') ||
      typeof path !== 'string' ||
      !path.trim() ||
      (rawBefore !== undefined && typeof rawBefore !== 'string') ||
      (rawAfter !== undefined && typeof rawAfter !== 'string')
    )
      return null;
    const incomplete =
      Boolean(decoded?.truncated) || isIncompleteFileSnapshot(value) || !readFileSnapshot(entry);
    const before = readRetainedSnapshot(rawBefore);
    const after = readRetainedSnapshot(rawAfter);
    const omittedChars = before.omittedChars + after.omittedChars;
    files.push({
      action,
      path,
      moveTo: typeof entry['moveTo'] === 'string' ? entry['moveTo'] : undefined,
      before: before.text,
      after: after.text,
      additions: incomplete ? undefined : readCount(entry['additions']),
      deletions: incomplete ? undefined : readCount(entry['deletions']),
      incomplete,
      ...(before.text !== undefined &&
        after.text !== undefined &&
        Number.isSafeInteger(omittedChars) &&
        omittedChars > 0 && { omittedChars }),
    });
  }
  return { success: value['success'], files, raw: output };
}
