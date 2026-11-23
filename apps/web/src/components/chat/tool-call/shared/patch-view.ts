export interface PatchFileView {
  path: string;
  moveTo?: string;
  action: 'update' | 'add' | 'delete';
  lines: string[];
  added: number;
  removed: number;
  truncated: boolean;
}

/** 解析请求本身，不用结果快照重建补丁：快照可能被截断、重复或只包含文件前缀。 */
export function parsePatchFiles(value: unknown): PatchFileView[] | null {
  if (typeof value !== 'string') return null;
  const lines = value.replaceAll('\r\n', '\n').trim().split('\n');
  if (lines[0] !== '*** Begin Patch') return null;
  const files: PatchFileView[] = [];
  let current: PatchFileView | undefined;
  let afterEndOfFile = false;
  let inHunk = false;
  let ended = false;
  for (const line of lines.slice(1)) {
    if (line === '*** End Patch') {
      ended = true;
      break;
    }
    const header = /^\*\*\* (Update|Add|Delete) File: (.+)$/.exec(line);
    if (header) {
      afterEndOfFile = false;
      inHunk = false;
      current = {
        path: header[2]!.trim(),
        action: header[1] === 'Add' ? 'add' : header[1] === 'Delete' ? 'delete' : 'update',
        lines: [],
        added: 0,
        removed: 0,
        truncated: false,
      };
      files.push(current);
    } else if (current && line.startsWith('*** Move to: ')) {
      current.moveTo = line.slice('*** Move to: '.length).trim();
    } else if (current && line === '*** End of File') {
      afterEndOfFile = true;
      inHunk = false;
      continue;
    } else if (afterEndOfFile && line.trim() === '') {
      continue;
    } else if (current?.action === 'update' && line === '' && inHunk) {
      // 与网关一致：未加空格前缀的空行也是上下文，保留其位置而不计为变更。
      current.lines.push(line);
    } else if (current && /^(?:@@|[ +\-])/.test(line)) {
      if (line.startsWith('@@')) {
        afterEndOfFile = false;
        inHunk = true;
      } else if (current.action === 'update' && !afterEndOfFile) {
        // 网关允许省略 @@；首条正文同样开启隐式更新片段。
        inHunk = true;
      }
      current.lines.push(line);
      if (line.startsWith('+')) current.added += 1;
      if (line.startsWith('-')) current.removed += 1;
    } else if (line.trim()) {
      return null;
    }
  }
  if (files.length === 0) return null;
  return files.map((file) => ({ ...file, truncated: !ended }));
}

export function patchResult(output: unknown): Record<string, unknown> | null {
  let value = output;
  for (let depth = 0; depth < 2 && typeof value === 'string'; depth += 1) {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function hasTruncatedPatchSnapshot(file: PatchFileView, metadata: unknown): boolean {
  if (!Array.isArray(metadata)) return false;
  return metadata.some((entry: unknown) => {
    const record = patchResult(entry);
    if (!record || ![file.path, file.moveTo].includes(String(record.file ?? record.path))) {
      return false;
    }
    return (
      record.truncated === true ||
      record.beforeTruncated === true ||
      record.afterTruncated === true ||
      [record.before, record.after].some(
        (text) =>
          typeof text === 'string' &&
          /(?:\[.*truncat|截断|… truncated|\.\.\. truncated)/i.test(text),
      )
    );
  });
}
