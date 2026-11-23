#!/usr/bin/env node
// 前端在目标同级目录暂存，以便停服后通过 rename 切换并保留旧版本。
import {
  accessSync,
  chmodSync,
  constants,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function canonical(filename) {
  if (existsSync(filename)) return realpathSync(filename);
  const parent = path.dirname(filename);
  return path.join(canonical(parent), path.basename(filename));
}

function within(filename, parent) {
  return filename === parent || filename.startsWith(`${parent}${path.sep}`);
}

export function validateTarget(source, target) {
  if (!path.isAbsolute(target)) throw new Error('前端目标必须是绝对路径。');
  const normalized = path.resolve(target);
  if (lstatSync(normalized, { throwIfNoEntry: false })?.isSymbolicLink()) {
    throw new Error('前端目标不能是符号链接。');
  }
  const resolvedSource = canonical(source);
  const resolvedTarget = canonical(normalized);
  if (resolvedSource === resolvedTarget) return resolvedTarget;
  if (
    resolvedTarget === path.parse(resolvedTarget).root ||
    within(resolvedSource, resolvedTarget) ||
    within(resolvedTarget, canonical(path.dirname(source)))
  ) {
    throw new Error('前端目标不能覆盖根目录、构建源的祖先或前端源码树。');
  }
  if (existsSync(resolvedTarget) && !statSync(resolvedTarget).isDirectory()) {
    throw new Error('前端目标必须是目录。');
  }
  return resolvedTarget;
}

export function prepare(source, target) {
  const destination = validateTarget(source, target);
  if (!statSync(path.join(source, 'index.html')).isFile()) {
    throw new Error('前端构建缺少 index.html。');
  }
  if (canonical(source) === destination) return '';
  const parent = path.dirname(destination);
  mkdirSync(parent, { recursive: true });
  accessSync(parent, constants.W_OK | constants.X_OK);
  const staging = mkdtempSync(path.join(parent, '.openawork-web-'));
  try {
    cpSync(source, staging, {
      recursive: true,
      dereference: true,
      filter: (filename) => {
        realpathSync(filename);
        return true;
      },
    });
    chmodSync(staging, statSync(source).mode & 0o777);
    if (!statSync(path.join(staging, 'index.html')).isFile()) {
      throw new Error('前端暂存缺少 index.html。');
    }
    return staging;
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}

const WEB_STAGING_PREFIX = '.openawork-web-';

// 每次发布都会把当前前端改名成新的 `.previous`，中断还可能留下未发布的暂存目录。
// 不清理时部署目录会随每次更新线性增长（单份产物可达上百 MB）。
// 这里只保留最新一份旧前端作为回滚点，其余在发布成功后删除。
export function pruneBackups(target, keepPath = '', includeStaging = false) {
  const parent = path.dirname(path.resolve(target));
  let entries;
  try {
    entries = readdirSync(parent, { withFileTypes: true });
  } catch (error) {
    console.error(`[本机网关] 无法扫描前端备份目录 ${parent}：${error.message}`);
    return;
  }
  const previous = [];
  const staging = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(WEB_STAGING_PREFIX)) continue;
    const full = path.join(parent, entry.name);
    if (entry.name.endsWith('.previous')) previous.push(full);
    else staging.push(full);
  }
  const modified = (directory) => lstatSync(directory, { throwIfNoEntry: false })?.mtimeMs ?? 0;
  previous.sort((left, right) => modified(right) - modified(left));
  const keep = keepPath ? path.resolve(keepPath) : '';
  const ordered =
    keep && previous.includes(keep)
      ? [keep, ...previous.filter((directory) => directory !== keep)]
      : previous;
  // 无 `.previous` 后缀的都是发布中断留下的暂存目录。发布由 flock 串行化，
  // 因此只在发布成功后清理，此时不会误删任何活跃暂存目录。
  const stale = [...(includeStaging ? staging : []), ...ordered.slice(1)];
  for (const directory of stale) {
    try {
      rmSync(directory, { recursive: true, force: true });
      console.log(`[本机网关] 清理旧前端备份：${directory}`);
    } catch (error) {
      console.error(`[本机网关] 清理旧前端备份失败（可手工删除）：${directory}：${error.message}`);
    }
  }
}

export function publish(source, target, staging) {
  const destination = validateTarget(source, target);
  const backup = `${staging}.previous`;
  let moved = false;
  try {
    if (existsSync(destination)) {
      renameSync(destination, backup);
      moved = true;
      console.log(`[本机网关] 前端旧版本备份：${backup}`);
    }
    renameSync(staging, destination);
    pruneBackups(destination, moved ? backup : '', true);
  } catch (error) {
    if (moved) {
      try {
        renameSync(backup, destination);
      } catch (restoreError) {
        throw new AggregateError([error, restoreError], `前端恢复失败，请从 ${backup} 手动恢复。`);
      }
    }
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [operation, source, target, staging] = process.argv.slice(2);
  if (operation === 'validate') validateTarget(source, target);
  else if (operation === 'prepare') console.log(prepare(source, target));
  else if (operation === 'publish') publish(source, target, staging);
  else if (operation === 'prune') {
    // 同源（构建目录即发布目录）时不能清理，否则会误删源码树旁的产物。
    if (canonical(source) !== validateTarget(source, target)) pruneBackups(target);
  } else throw new Error('未知前端操作。');
}
