/**
 * 目录清单解析（read 命中目录时网关返回的文本形态）。
 *
 * 网关 `executeReadTool` 对目录走 `readDirectoryListing`：每行一条
 * `dir <名>` / `file <名>`，再经 `applyLineWindow` 套上行窗口信封（`path` +
 * `content` + `lineStart/lineEnd/totalLines`）。因此「read 的结果其实是目录」
 * 只能从 content 的形态判断——两个调用方（文件预览 / 摘要）共用这一处判定。
 */
export interface DirectoryListingEntry {
  isDir: boolean;
  name: string;
}

export function parseDirectoryListing(content: string): DirectoryListingEntry[] | null {
  const rows = content.split('\n').filter((line) => line.trim().length > 0);
  if (rows.length === 0) return null;
  if (!rows.every((line) => /^(dir|file) /.test(line))) return null;
  return rows.map((line) => ({ isDir: line.startsWith('dir '), name: line.slice(4) }));
}

export interface DirectoryTreeNode {
  name: string;
  path?: string;
  type?: 'file' | 'dir' | 'directory';
  children?: DirectoryTreeNode[];
}

export interface DirectoryTreeBundle {
  path?: string;
  visited?: number;
  depth?: number;
  truncated?: boolean;
  nodes: DirectoryTreeNode[];
}

/** 不修补残缺 JSON，也不把错误信封中的 nodes 当成成功结果。 */
export function parseDirectoryTree(output: unknown): DirectoryTreeBundle | null {
  let value: unknown = output;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.error || record.isError === true || record.ok === false) return null;
  if (['pending', 'running', 'error', 'failed', 'cancelled'].includes(String(record.status))) {
    return null;
  }
  if (!Array.isArray(record.nodes)) return null;

  // 有界校验，避免异常深度或恶意载荷使递归预览溢出。
  let remaining = 20_000;
  function validateNodes(nodes: unknown[], level: number): nodes is DirectoryTreeNode[] {
    if (level > 64) return false;
    for (const node of nodes) {
      remaining -= 1;
      if (remaining < 0 || !node || typeof node !== 'object' || Array.isArray(node)) return false;
      const item = node as Record<string, unknown>;
      if (typeof item.name !== 'string' || !item.name.trim()) return false;
      if (item.path !== undefined && typeof item.path !== 'string') return false;
      if (item.type !== undefined && !['file', 'dir', 'directory'].includes(String(item.type))) {
        return false;
      }
      if (item.children !== undefined) {
        if (!Array.isArray(item.children) || !validateNodes(item.children, level + 1)) return false;
        if (item.type === 'file' && item.children.length > 0) return false;
      }
    }
    return true;
  }
  if (!validateNodes(record.nodes, 0)) return null;
  const nonNegativeInteger = (item: unknown): number | undefined =>
    typeof item === 'number' && Number.isSafeInteger(item) && item >= 0 ? item : undefined;
  return {
    path: typeof record.path === 'string' ? record.path : undefined,
    visited: nonNegativeInteger(record.visitedEntries),
    depth: nonNegativeInteger(record.depth),
    truncated: record.truncated === true || record.entryLimitReached === true,
    nodes: record.nodes,
  };
}
