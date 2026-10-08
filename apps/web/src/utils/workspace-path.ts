const WINDOWS_ABSOLUTE_PATH_PATTERN = /^(?:[A-Za-z]:[\\/]|\\\\)/;

function isWindowsPath(path: string): boolean {
  return WINDOWS_ABSOLUTE_PATH_PATTERN.test(path);
}

function normalizeSeparators(path: string, windows: boolean): string {
  return windows ? path.replaceAll('/', '\\') : path;
}

function collapseRepeatedSeparators(path: string, windows: boolean): string {
  if (!windows) {
    return path.replace(/\/{2,}/g, '/');
  }

  if (path.startsWith('\\\\')) {
    return `\\\\${path.slice(2).replace(/[\\/]+/g, '\\')}`;
  }

  return path.replace(/[\\/]+/g, '\\');
}

function getRootPath(path: string, windows: boolean): string {
  if (!windows) {
    return '/';
  }

  const normalized = collapseRepeatedSeparators(normalizeSeparators(path, true), true);
  const driveMatch = normalized.match(/^([A-Za-z]:)\\/);
  if (driveMatch) {
    return `${driveMatch[1]}\\`;
  }

  const uncMatch = normalized.match(/^\\\\[^\\]+\\[^\\]+\\/);
  if (uncMatch) {
    return uncMatch[0];
  }

  return '\\\\';
}

function trimTrailingSeparators(path: string, windows: boolean): string {
  const normalized = collapseRepeatedSeparators(normalizeSeparators(path, windows), windows);
  const rootPath = getRootPath(normalized, windows);
  const trimmed = normalized.replace(windows ? /[\\/]+$/g : /\/+$/g, '');

  if (trimmed.length < rootPath.length) {
    return rootPath;
  }

  return trimmed || rootPath;
}

function normalizeForComparison(path: string): string {
  const windows = isWindowsPath(path);
  const normalized = trimTrailingSeparators(path, windows);
  return windows ? normalized.toLowerCase() : normalized;
}

export function getPathBasename(path: string | null | undefined, fallback: string = ''): string {
  const trimmed = path?.trim();
  if (!trimmed) {
    return fallback;
  }

  const windows = isWindowsPath(trimmed);
  const normalized = trimTrailingSeparators(trimmed, windows);
  const rootPath = trimTrailingSeparators(getRootPath(normalized, windows), windows);
  if (normalizeForComparison(normalized) === normalizeForComparison(rootPath)) {
    return normalized;
  }

  const separator = windows ? '\\' : '/';
  const segments = normalized.split(separator).filter((segment) => segment.length > 0);
  return segments.at(-1) ?? normalized;
}

export function isPathWithinRoot(path: string, rootPath: string): boolean {
  const windows = isWindowsPath(path) || isWindowsPath(rootPath);
  const normalizedPath = normalizeForComparison(path);
  const normalizedRootPath = normalizeForComparison(rootPath);
  const rootAnchor = normalizeForComparison(getRootPath(rootPath, windows));

  if (normalizedRootPath === rootAnchor) {
    return normalizedPath.startsWith(rootAnchor);
  }

  const separator = windows ? '\\' : '/';
  return (
    normalizedPath === normalizedRootPath ||
    normalizedPath.startsWith(`${normalizedRootPath}${separator}`)
  );
}

/**
 * 是否为绝对路径。
 *
 * 覆盖 POSIX（`/a/b`）、Windows 盘符（`C:\a`、`C:/a`）与 UNC（`\\host\share`）。
 * 网关的 `validateWorkspacePath` 只接受绝对路径，前端在拼接工作区根之前必须
 * 先用同一个口径判定，否则 `C:\repo\a.ts` 会被误当成相对路径再拼一次根。
 */
export function isAbsolutePath(path: string | null | undefined): boolean {
  const trimmed = path?.trim();
  if (!trimmed) {
    return false;
  }
  return trimmed.startsWith('/') || WINDOWS_ABSOLUTE_PATH_PATTERN.test(trimmed);
}

/** 是否包含目录分隔符（含反斜杠），用于区分「裸文件名」与「带目录的相对路径」。 */
export function hasDirectorySeparator(path: string): boolean {
  return path.includes('/') || path.includes('\\');
}

/**
 * 把工作区相对路径拼成根下的绝对路径（`getRelativePath` 的逆运算）。
 *
 * `.` / 空段被丢弃，`..` 回退一级；一旦回退会越出根（例如 `../../etc/passwd`）
 * 就返回 null，由调用方决定是拒绝还是回退到原始路径 —— 绝不在前端把工作区
 * 边界当成可协商的参数。
 */
export function resolvePathWithinRoot(relativePath: string, rootPath: string): string | null {
  const trimmedRoot = rootPath.trim();
  const trimmedRelative = relativePath.trim();
  if (!trimmedRoot || !trimmedRelative) {
    return null;
  }
  const windows = isWindowsPath(trimmedRoot);
  const root = trimTrailingSeparators(trimmedRoot, windows);
  const rawSegments = (windows ? trimmedRelative.replaceAll('/', '\\') : trimmedRelative).split(
    windows ? '\\' : '/',
  );

  const segments: string[] = [];
  for (const segment of rawSegments) {
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
  return joinDirectoryPath(root, segments.join(windows ? '\\' : '/'));
}

export function findContainingRoot(path: string, roots: readonly string[]): string | null {
  return roots.find((root) => isPathWithinRoot(path, root)) ?? null;
}

export function getRelativePath(path: string, rootPath: string): string | null {
  const trimmedPath = path.trim();
  const trimmedRootPath = rootPath.trim();
  if (!trimmedPath || !trimmedRootPath) {
    return null;
  }

  const windows = isWindowsPath(trimmedPath) || isWindowsPath(trimmedRootPath);
  const normalizedPath = trimTrailingSeparators(trimmedPath, windows);
  const normalizedRootPath = trimTrailingSeparators(trimmedRootPath, windows);

  if (!isPathWithinRoot(normalizedPath, normalizedRootPath)) {
    return null;
  }

  if (normalizeForComparison(normalizedPath) === normalizeForComparison(normalizedRootPath)) {
    return '.';
  }

  const separator = windows ? '\\' : '/';
  let relativePath = normalizedPath.slice(normalizedRootPath.length);
  if (relativePath.startsWith(separator)) {
    relativePath = relativePath.slice(1);
  }
  return relativePath.replaceAll('\\', '/');
}

export function getParentPath(path: string): string | null {
  const trimmed = path.trim();
  if (!trimmed) {
    return null;
  }

  const windows = isWindowsPath(trimmed);
  const normalized = trimTrailingSeparators(trimmed, windows);
  const rootPath = trimTrailingSeparators(getRootPath(normalized, windows), windows);
  if (normalizeForComparison(normalized) === normalizeForComparison(rootPath)) {
    return null;
  }

  const separator = windows ? '\\' : '/';
  const lastSeparatorIndex = normalized.lastIndexOf(separator);
  if (lastSeparatorIndex < 0) {
    return null;
  }

  const parentPath = normalized.slice(0, lastSeparatorIndex);
  if (parentPath.length < rootPath.length) {
    return rootPath;
  }

  return parentPath || rootPath;
}

export function joinDirectoryPath(parentPath: string, directoryName: string): string {
  const trimmedParentPath = parentPath.trim();
  const trimmedDirectoryName = directoryName.trim();
  const windows = isWindowsPath(trimmedParentPath);
  const separator = windows ? '\\' : '/';
  const normalizedParentPath = trimTrailingSeparators(trimmedParentPath, windows);
  const rootPath = trimTrailingSeparators(getRootPath(normalizedParentPath, windows), windows);

  if (normalizeForComparison(normalizedParentPath) === normalizeForComparison(rootPath)) {
    return `${normalizedParentPath}${trimmedDirectoryName}`;
  }

  return `${normalizedParentPath}${separator}${trimmedDirectoryName}`;
}

export function rebasePath(path: string, oldRoot: string, newRoot: string): string | null {
  const relativePath = getRelativePath(path, oldRoot);
  if (relativePath === null) {
    return null;
  }
  if (relativePath === '.') {
    return newRoot;
  }
  const windows = isWindowsPath(path) || isWindowsPath(oldRoot) || isWindowsPath(newRoot);
  const normalizedRelativePath = windows ? relativePath.replaceAll('/', '\\') : relativePath;
  return joinDirectoryPath(newRoot, normalizedRelativePath);
}

export interface WorkspacePathLabelOptions {
  /** 标签字符预算，默认 24（约等于 244px 面板第二行能容纳的等宽字符数）。 */
  readonly maxLength?: number;
  /** 省略后至少保留的尾部层级数，默认 2，保证「父级/目录名」这一对定位信息。 */
  readonly minTailSegments?: number;
  /**
   * 路径末段（目录名）是否参与展示，默认 true。
   *
   * 窄栏位通常已经在上一行展示了目录名（工作区名），此时置 false，
   * 只保留父级链，避免两行重复同一段文字。
   */
  readonly includeBasename?: boolean;
}

/** 窄栏位路径标签的默认字符预算：244px 面板第二行按等宽 10.5px 约可容 25 字符，留 2 字余量避免触发 CSS ellipsis。 */
const WORKSPACE_PATH_LABEL_MAX_LENGTH = 22;

/** 省略后至少保留的尾部层级数：`父级/目录名` 是最小可用的定位信息。 */
const WORKSPACE_PATH_MIN_TAIL_SEGMENTS = 2;

/**
 * 窄栏位用的紧凑路径标签：超预算时从左侧省略中间层级，只保留根锚点 + 末尾若干层。
 *
 * 路径的信息量集中在尾部（越靠后的目录越具体），头部省略比尾部省略更符合
 * 读路径的习惯，因此这里固定「左省略」而不是交给 CSS 的尾部 ellipsis：
 *
 * - `/home/await/project/OpenAWork` → `/…/project/OpenAWork`
 * - `/home/await/project/OpenAWork/services/agent-gateway` → `/…/services/agent-gateway`
 *
 * 是否省略以**字符预算**（而非层级数）判定：短路径原样返回才符合「窄栏位」的
 * 初衷——`/home/await/repo` 只有 16 字符，硬省略成 `/…/await/repo` 反而丢信息。
 *
 * 路径等于根（`/`、`D:\`）时返回空串：根路径没有可省略的层级，交给调用方展示
 * 「本机根目录」之类的语境文案更贴切。
 */
export function formatWorkspacePathLabel(
  path: string | null | undefined,
  options: WorkspacePathLabelOptions = {},
): string {
  const trimmed = path?.trim();
  if (!trimmed) {
    return '';
  }

  const windows = isWindowsPath(trimmed);
  const normalized = trimTrailingSeparators(trimmed, windows);
  const rootPath = trimTrailingSeparators(getRootPath(normalized, windows), windows);
  if (normalizeForComparison(normalized) === normalizeForComparison(rootPath)) {
    return '';
  }

  const separator = windows ? '\\' : '/';
  // 根锚点自身占掉的段要从segments 里剥掉：`C:\` 的盘符段、`\\host\share\`
  // 的前两段已经被rootPath 表达了，再拼一次会得到 `C:\C:\repo`。
  const rootSegmentCount = rootPath.split(separator).filter((segment) => segment.length > 0).length;
  const segments = normalized
    .split(separator)
    .filter((segment) => segment.length > 0)
    .slice(rootSegmentCount);
  const kept = options.includeBasename === false ? segments.slice(0, -1) : segments;
  if (kept.length === 0) {
    return rootPath;
  }

  const maxLength = Math.max(
    rootPath.length + 2,
    options.maxLength ?? WORKSPACE_PATH_LABEL_MAX_LENGTH,
  );
  const fullLabel = `${rootPath}${kept.join(separator)}`;
  if (fullLabel.length <= maxLength) {
    return fullLabel;
  }

  const ellipsisPrefix = `${rootPath}…${separator}`;
  const minTailSegments = Math.max(1, options.minTailSegments ?? WORKSPACE_PATH_MIN_TAIL_SEGMENTS);
  let tailCount = Math.min(minTailSegments, kept.length);
  while (
    tailCount < kept.length &&
    `${ellipsisPrefix}${kept.slice(-(tailCount + 1)).join(separator)}`.length <= maxLength
  ) {
    tailCount += 1;
  }

  return `${ellipsisPrefix}${kept.slice(-tailCount).join(separator)}`;
}
