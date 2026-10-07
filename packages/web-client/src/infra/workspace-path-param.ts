/**
 * 工作区路径参数的最后一层归一。
 *
 * 网关的 `validateWorkspacePath`（`services/agent-gateway/src/workspace/workspace-paths.ts`）
 * 只接受**绝对路径**，而前端拿到的路径有三种形态：
 *
 *   1. 绝对路径 —— 文件树节点、`findByName` 命中、`repo_overview` 结果；
 *   2. 工作区相对路径 —— `@` 文件提及、模型回复里的行内代码、工具输出
 *      （`/workspace/files/search` 明确只返回相对路径）；
 *   3. SSH 家目录相对路径 —— `~/src/index.ts`，只有网关的 `resolveRemotePath` 能解析。
 *
 * 形态 2 若原样发出，服务端一律回 403「工作区路径不在允许范围内。」。前端通常在
 * 渲染前用 `resolveBareFilename` 之类的解析器把它绝对化，但任何漏掉解析器的调用方
 * （新页面、二进制预览、桌面端复用页面……）都会直接撞上这个错误。因此在**所有**
 * 工作区请求的 `path` 查询参数上做一次兜底归一——只有服务端才知道的基准不该由
 * 每个调用点各自记得传。
 *
 * 边界保持不变：越出工作区根的相对路径（`../..`）原样透传，工作区白名单仍然由
 * 网关单独裁决，前端绝不代它放宽。
 */

const WINDOWS_ABSOLUTE_PATH_PATTERN = /^(?:[A-Za-z]:[\\/]|\\\\)/;

function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || WINDOWS_ABSOLUTE_PATH_PATTERN.test(path);
}

/**
 * 拼接相对路径与根，并按根的系统分隔符归一 `.` / `..` 段。
 * 越出根时返回 null（`null` 与「无根可拼」区分开，便于调用方决定是否透传）。
 */
function joinWorkspaceRelative(relativePath: string, root: string): string | null {
  const windows = WINDOWS_ABSOLUTE_PATH_PATTERN.test(root);
  const separator = windows ? '\\' : '/';
  const normalizedRelative = windows ? relativePath.replaceAll('/', '\\') : relativePath;

  const segments: string[] = [];
  for (const segment of normalizedRelative.split(separator)) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (segments.length === 0) return null;
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  if (segments.length === 0) {
    return root;
  }

  const joined = segments.join(separator);
  // 根本身就是分隔符结尾（`/`、`E:\`）时不能重复拼接。
  return root.endsWith(separator) ? `${root}${joined}` : `${root}${separator}${joined}`;
}

/**
 * 归一工作区请求的 `path` 参数。
 *
 * - 绝对路径、SSH 的 `~/…`、空串：原样返回（分别由服务端本地校验 / SSH 分支处理）；
 * - 未提供 `workspaceRoot`：原样返回，让服务端给出可读错误而不是猜一个基准；
 * - 工作区相对路径：拼到 `workspaceRoot` 之下；
 * - 越界相对路径：原样返回，交由服务端拒绝。
 */
export function normalizeWorkspacePathParam(path: string, workspaceRoot?: string): string {
  const trimmedPath = path.trim();
  if (!trimmedPath || isAbsolutePath(trimmedPath) || trimmedPath.startsWith('~/')) {
    return path;
  }

  const trimmedRoot = workspaceRoot?.trim();
  if (!trimmedRoot) {
    return path;
  }

  return joinWorkspaceRelative(trimmedPath, trimmedRoot) ?? path;
}
