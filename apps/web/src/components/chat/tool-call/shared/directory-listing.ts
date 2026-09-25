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
