/**
 * Agent 工具写盘后失效工作区文件索引的桥接。
 *
 * Agent 工具直接以 `fsp.writeFile` 写盘，不经过 `/workspace/*` HTTP 路由，
 * 因此路由层的 `invalidateWorkspaceFileIndex` 覆盖不到它们。这里给出唯一的
 * 失效判定：只有在「能改动工作区文件系统」的工具完成（含报错 / 取消）后，
 * 才按会话解析出的工作区根失效一次；只读工具不失效，避免长任务中每次只读
 * 调用都让下一次 `@` 查询强制全量重扫。
 *
 * 只对能解析出工作区根的会话生效；解析不到（无绑定 / 未落库）直接跳过。
 */

import { getSessionWorkspaceRoot } from './workspace-safety.js';
import { invalidateWorkspaceFileIndex } from './workspace-file-index.js';

/**
 * 可能改动工作区文件系统的 canonical 工具名。
 *
 * 包含文件写入（write / edit / multi_edit / apply_patch / ast_grep_replace /
 * lsp_rename / workspace_create_directory / workspace_review_revert）、可执行
 * 任意命令的 shell（bash / interactive_bash / run_bash_in_background）以及会
 * 落盘克隆产物的 repo_clone。只读 / 检索 / 会话类工具绝不在此集合内。
 *
 * SSH 远程会话复用同一批 canonical 名称；远端写入不影响本地索引，这里仍按
 * 本地会话根失效，代价只是一次无害的重扫。
 */
export const WORKSPACE_FILE_INDEX_WRITE_TOOLS: ReadonlySet<string> = new Set([
  'write',
  'edit',
  'multi_edit',
  'apply_patch',
  'ast_grep_replace',
  'lsp_rename',
  'bash',
  'interactive_bash',
  'run_bash_in_background',
  'workspace_create_directory',
  'workspace_review_revert',
  'repo_clone',
]);

/**
 * 若 `toolName` 可写工作区，则失效 `sessionId` 对应工作区根的文件索引。
 * 无法解析工作区根时静默跳过。
 */
export function invalidateWorkspaceFileIndexForToolCall(sessionId: string, toolName: string): void {
  if (!WORKSPACE_FILE_INDEX_WRITE_TOOLS.has(toolName)) {
    return;
  }
  // 运行在工具执行的 finally 中，任何失败都不能覆盖工具本身的结果。
  let workspaceRoot: string | null;
  try {
    workspaceRoot = getSessionWorkspaceRoot(sessionId);
  } catch (error) {
    console.warn('[workspace-file-index] 解析会话工作区根失败，跳过索引失效：', String(error));
    return;
  }
  if (!workspaceRoot) {
    return;
  }
  invalidateWorkspaceFileIndex(workspaceRoot);
}
