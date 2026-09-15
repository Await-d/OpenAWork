/**
 * `@` 文件提及的服务端检索：把原先在 Web 端 `composer.ts` 里本地执行的
 * 浏览 / 全局搜索排序迁移到网关，客户端只消费相对路径。
 *
 * 排序规则必须与客户端保持一致（浏览模式：目录在前、按片段排序；
 * 搜索模式：精确 > 前缀 > 子串 > 路径子串，同分文件在前、浅层在前）。
 * 纯函数，不触碰文件系统，永不抛错。
 */

import type { CachedWorkspaceFileIndex, WorkspaceFileIndexEntry } from './workspace-file-index.js';

export const WORKSPACE_FILE_SEARCH_DEFAULT_LIMIT = 20;
export const WORKSPACE_FILE_SEARCH_MAX_LIMIT = 50;

export interface WorkspaceFileSearchInput {
  index: CachedWorkspaceFileIndex;
  query: string;
  limit: number;
}

export interface WorkspaceFileSearchResult {
  files: readonly string[];
  directories: readonly string[];
}

const EMPTY_RESULT: WorkspaceFileSearchResult = { files: [], directories: [] };

function browseWorkspaceFileIndex(
  index: CachedWorkspaceFileIndex,
  query: string,
  slashIndex: number,
  limit: number,
): WorkspaceFileSearchResult {
  const prefix = query === '' ? '' : query.slice(0, slashIndex + 1);
  const segment = query === '' ? '' : query.slice(slashIndex + 1);
  const prefixLower = prefix.toLowerCase();
  const segmentLower = segment.toLowerCase();

  const matchedDirectories: Array<{ directory: string; rest: string }> = [];
  for (const directory of index.directories) {
    if (!directory.toLowerCase().startsWith(prefixLower)) continue;
    const rest = directory.slice(prefix.length);
    if (rest === '' || rest.includes('/')) continue;
    if (segment !== '' && !rest.toLowerCase().includes(segmentLower)) continue;
    matchedDirectories.push({ directory, rest });
  }
  matchedDirectories.sort((left, right) => left.rest.localeCompare(right.rest));

  const matchedFiles: Array<{ relativePath: string; rest: string }> = [];
  for (const file of index.files) {
    if (!file.lowerPath.startsWith(prefixLower)) continue;
    const rest = file.relativePath.slice(prefix.length);
    if (rest === '' || rest.includes('/')) continue;
    if (segment !== '' && !file.lowerLabel.includes(segmentLower)) continue;
    matchedFiles.push({ relativePath: file.relativePath, rest });
  }
  matchedFiles.sort((left, right) => left.relativePath.localeCompare(right.relativePath));

  const directories = matchedDirectories.slice(0, limit).map((candidate) => candidate.directory);
  const files = matchedFiles
    .slice(0, Math.max(0, limit - directories.length))
    .map((candidate) => candidate.relativePath);

  return { files, directories };
}

function scoreFile(file: WorkspaceFileIndexEntry, queryLower: string): number {
  if (file.lowerLabel === queryLower) return 0;
  if (file.lowerLabel.startsWith(queryLower)) return 1;
  if (file.lowerLabel.includes(queryLower)) return 2;
  if (file.lowerPath.includes(queryLower)) return 3;
  return -1;
}

function scoreDirectorySegment(directory: string, queryLower: string): number {
  const lastSlash = directory.lastIndexOf('/');
  const ownSegment = lastSlash === -1 ? directory : directory.slice(lastSlash + 1);
  const ownSegmentLower = ownSegment.toLowerCase();
  if (ownSegmentLower === queryLower) return 0;
  if (ownSegmentLower.startsWith(queryLower)) return 1;
  if (ownSegmentLower.includes(queryLower)) return 2;
  return -1;
}

function countPathSegments(path: string): number {
  return path.split('/').filter((segment) => segment.length > 0).length;
}

interface SearchCandidate {
  path: string;
  score: number;
  depth: number;
  isDirectory: boolean;
}

function searchAllWorkspaceFileIndex(
  index: CachedWorkspaceFileIndex,
  queryLower: string,
  limit: number,
): WorkspaceFileSearchResult {
  const candidates: SearchCandidate[] = [];

  for (const file of index.files) {
    const score = scoreFile(file, queryLower);
    if (score < 0) continue;
    candidates.push({
      path: file.relativePath,
      score,
      depth: file.depth,
      isDirectory: false,
    });
  }

  for (const directory of index.directories) {
    const score = scoreDirectorySegment(directory, queryLower);
    if (score < 0) continue;
    candidates.push({
      path: directory,
      score,
      depth: countPathSegments(directory),
      isDirectory: true,
    });
  }

  candidates.sort((left, right) => {
    if (left.score !== right.score) return left.score - right.score;
    if (left.isDirectory !== right.isDirectory) return left.isDirectory ? 1 : -1;
    if (left.depth !== right.depth) return left.depth - right.depth;
    return left.path.localeCompare(right.path);
  });

  const limited = candidates.slice(0, limit);
  return {
    files: limited.filter((candidate) => !candidate.isDirectory).map((candidate) => candidate.path),
    directories: limited
      .filter((candidate) => candidate.isDirectory)
      .map((candidate) => candidate.path),
  };
}

export function searchWorkspaceFileIndex(
  input: WorkspaceFileSearchInput,
): WorkspaceFileSearchResult {
  const { index, query, limit } = input;
  if (limit <= 0 || (index.files.length === 0 && index.directories.length === 0)) {
    return { ...EMPTY_RESULT };
  }

  // 前导斜杠（如 `@/src` 产生的 `/src`）不是有效的浏览前缀：目录集合里的
  // 相对路径都不以 `/` 开头，直接浏览会永远空命中。统一去掉前导 `/`，让
  // `/src` 与 `src` 走同一条分支。
  const normalizedQuery = query.replace(/^\/+/, '');
  const slashIndex = normalizedQuery.lastIndexOf('/');
  if (normalizedQuery === '' || slashIndex >= 0) {
    return browseWorkspaceFileIndex(index, normalizedQuery, slashIndex, limit);
  }

  return searchAllWorkspaceFileIndex(index, normalizedQuery.toLowerCase(), limit);
}
