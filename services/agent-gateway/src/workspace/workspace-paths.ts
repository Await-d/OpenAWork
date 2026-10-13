import { posix, win32 } from 'node:path';
import { WORKSPACE_ACCESS_RESTRICTED, WORKSPACE_ROOTS } from '../infra/db.js';

type PathFlavor = typeof posix;

const WINDOWS_ABSOLUTE_PATH_PATTERN = /^(?:[A-Za-z]:[\\/]|\\\\)/;

function pathFlavorFor(...paths: string[]): PathFlavor {
  return paths.some((path) => WINDOWS_ABSOLUTE_PATH_PATTERN.test(path)) ? win32 : posix;
}

function isPathFlavorSupportedByCurrentHost(flavor: PathFlavor): boolean {
  return process.platform === 'win32' ? flavor === win32 : flavor === posix;
}

function currentHostName(): string {
  if (process.platform === 'win32') {
    return 'Windows';
  }
  if (process.platform === 'darwin') {
    return 'macOS';
  }
  return 'Linux';
}

function pathFlavorName(flavor: PathFlavor): string {
  return flavor === win32 ? 'Windows' : 'POSIX';
}

export function assertWorkspacePathSupportedByCurrentHost(path: string): void {
  const flavor = pathFlavorFor(path);
  if (isPathFlavorSupportedByCurrentHost(flavor)) {
    return;
  }

  // 文案是前端的稳定契约：`WorkspaceFileTreePanel` 用「无法访问 + 路径」判定
  // 跨主机错误并挂出恢复入口，preview-read-identity.ts 用它判定是否改走 SSH
  // 身份重试，故前缀不得改写，只在其后补足两条可操作的出路。
  throw new Error(
    `当前网关运行在 ${currentHostName()}，无法访问 ${pathFlavorName(flavor)} 路径：${path}。` +
      '该路径位于其他设备的文件系统上。请将会话工作区切换到当前设备可访问的目录，' +
      '或用 SSH 远程连接绑定该主机后再访问。',
  );
}

function normalizeRelativeSeparators(path: string, flavor: PathFlavor): string {
  return flavor === win32 ? path.replaceAll('/', '\\') : path.replaceAll('\\', '/');
}

function normalizeForComparison(path: string, flavor: PathFlavor): string {
  const resolvedPath = flavor.resolve(path);
  return flavor === win32 ? resolvedPath.toLowerCase() : resolvedPath;
}

function resolveWorkspacePath(path: string): string {
  return pathFlavorFor(path).resolve(path);
}

export const WORKSPACE_ROOT_PATHS = WORKSPACE_ROOTS.map((root) => resolveWorkspacePath(root));

export function isWorkspaceAbsolutePath(path: string): boolean {
  return pathFlavorFor(path).isAbsolute(path);
}

export function isPathWithinRoot(path: string, rootPath: string): boolean {
  const flavor = pathFlavorFor(path, rootPath);
  const normalizedPath = normalizeForComparison(path, flavor);
  const normalizedRootPath = normalizeForComparison(rootPath, flavor);
  const rootAnchor = normalizeForComparison(flavor.parse(normalizedRootPath).root, flavor);

  if (normalizedRootPath === rootAnchor) {
    return normalizedPath.startsWith(rootAnchor);
  }

  return (
    normalizedPath === normalizedRootPath ||
    normalizedPath.startsWith(`${normalizedRootPath}${flavor.sep}`)
  );
}

export function isSamePath(leftPath: string, rightPath: string): boolean {
  const flavor = pathFlavorFor(leftPath, rightPath);
  return normalizeForComparison(leftPath, flavor) === normalizeForComparison(rightPath, flavor);
}

export function resolveWorkspaceEntryPath(
  path: string,
  workspaceRoot?: string | null,
): string | null {
  const flavor = pathFlavorFor(path, workspaceRoot ?? '');
  if (flavor.isAbsolute(path)) {
    const safePath = validateWorkspacePath(path);
    if (!safePath) {
      return null;
    }
    if (!workspaceRoot) {
      return safePath;
    }
    const safeRoot = validateWorkspacePath(workspaceRoot);
    if (!safeRoot) {
      return null;
    }
    return isPathWithinRoot(safePath, safeRoot) ? safePath : null;
  }

  if (!workspaceRoot) {
    return null;
  }

  const safeRoot = validateWorkspacePath(workspaceRoot);
  if (!safeRoot) {
    return null;
  }

  const normalizedRelativePath = normalizeRelativeSeparators(path, flavor);
  const resolvedPath = flavor.resolve(safeRoot, normalizedRelativePath);
  return isPathWithinRoot(resolvedPath, safeRoot) ? resolvedPath : null;
}

/**
 * 把 `path` 解析到 `workspaceRoot` 之下，**跳过 WORKSPACE_ROOT(S) 白名单**。
 *
 * 只服务于「根本身由服务端决议、且可能不在全局白名单里」的受控场景——当前唯一
 * 调用方是未绑定会话的默认工作区回退（`resolveUnboundSessionWorkspaceFallback`，
 * 通常是 `~/Documents/OpenAWork`，restricted 模式下必然不在白名单里）。
 *
 * 白名单检查由调用方用 `validateWorkspacePath` 承担；本函数只保证结果落在给定
 * 根内：相对路径按根拼接，绝对路径必须在根内，`..` 逃逸 / 越界一律返回 null。
 */
export function resolveWorkspaceEntryPathWithinRoot(
  path: string,
  workspaceRoot: string,
): string | null {
  const flavor = pathFlavorFor(path, workspaceRoot);
  const safeRoot = flavor.resolve(workspaceRoot);
  if (flavor.isAbsolute(path)) {
    const resolvedPath = flavor.resolve(path);
    return isPathWithinRoot(resolvedPath, safeRoot) ? resolvedPath : null;
  }

  const normalizedRelativePath = normalizeRelativeSeparators(path, flavor);
  const resolvedPath = flavor.resolve(safeRoot, normalizedRelativePath);
  return isPathWithinRoot(resolvedPath, safeRoot) ? resolvedPath : null;
}

export function validateWorkspacePath(path: string): string | null {
  const flavor = pathFlavorFor(path);
  if (!flavor.isAbsolute(path)) {
    return null;
  }

  const resolvedPath = flavor.resolve(path);

  if (!WORKSPACE_ACCESS_RESTRICTED) {
    return resolvedPath;
  }

  const matchedRootPath = WORKSPACE_ROOT_PATHS.find((rootPath) =>
    isPathWithinRoot(resolvedPath, rootPath),
  );

  if (!matchedRootPath) {
    return null;
  }

  return resolvedPath;
}

export function validateWorkspaceRelativePath(rootPath: string, filePath: string): string | null {
  const flavor = pathFlavorFor(rootPath);
  const normalizedRootPath = flavor.resolve(rootPath);
  const resolvedPath = flavor.resolve(flavor.join(normalizedRootPath, filePath));
  if (!isPathWithinRoot(resolvedPath, normalizedRootPath)) {
    return null;
  }

  return flavor.relative(normalizedRootPath, resolvedPath).replaceAll(flavor.sep, '/');
}
