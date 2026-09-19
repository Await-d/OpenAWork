/**
 * 运行时二进制解析 —— 「可执行文件在哪里」的单一事实来源。
 *
 * 解析顺序（首个通过存在性校验的候选胜出）：
 *   1. `env`      —— 环境变量显式指定的绝对路径（如 FFMPEG_BIN / FFPROBE_BIN）
 *   2. `resource` —— 桌面端注入资源目录（OPENAWORK_RESOURCES_DIR）内随应用分发的路径
 *   3. `bundled`  —— 打包/依赖内嵌路径（如 ffmpeg-static / ffprobe-static）
 *   4. `path`     —— 系统 PATH 查找
 *
 * 为什么必须做存在性校验：`bun --compile` 产物中的 bundled 路径是编译期虚拟路径，
 * 在当前机器上并不存在；直接把它交给 spawn 只会得到误导性的「请安装依赖」错误。
 * 校验失败时如实返回 null，调用方据此返回可操作的安装/配置指引。
 */

import { existsSync, statSync } from 'node:fs';
import { delimiter, join } from 'node:path';

export type RuntimeBinarySource = 'env' | 'resource' | 'bundled' | 'path';

export interface RuntimeBinaryResolution {
  path: string;
  source: RuntimeBinarySource;
}

export interface ResolveRuntimeBinaryOptions {
  /** 显式指定路径的环境变量名，如 FFMPEG_BIN / FFPROBE_BIN */
  envVar: string;
  /** 可执行文件名（不含扩展名），如 ffmpeg / ffprobe；用于 PATH 探测 */
  name: string;
  /** 桌面端资源目录下的候选路径 */
  resourcePath?: string | null;
  /** 打包内嵌的候选路径（通常是 ffmpeg-static / ffprobe-static 的默认导出） */
  bundledPath?: unknown;
  /** 环境变量来源，默认 process.env；测试可注入 */
  env?: NodeJS.ProcessEnv;
  /** 目标平台，默认 process.platform；测试可注入 */
  platform?: NodeJS.Platform;
}

/** 候选必须存在且为普通文件（目录同名时不算命中）。 */
function isExistingFile(candidate: string): boolean {
  if (!existsSync(candidate)) {
    return false;
  }
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

/** 仅接受非空字符串；其余类型（null / undefined / 对象 / 空串）一律视为未提供。 */
function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** 在 PATH 中查找可执行文件；win32 下额外探测 `.exe` 后缀。 */
function resolveFromPath(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  name: string,
): string | null {
  const pathValue = env['PATH'] ?? env['Path'] ?? '';
  if (!pathValue) {
    return null;
  }

  const extensions =
    platform === 'win32' && !name.toLowerCase().endsWith('.exe') ? ['', '.exe'] : [''];

  for (const dir of pathValue.split(delimiter)) {
    if (!dir) {
      continue;
    }
    for (const extension of extensions) {
      const candidate = join(dir, `${name}${extension}`);
      if (isExistingFile(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

/**
 * 按 env → resource → bundled → PATH 顺序解析可执行文件。
 * 全部候选都未通过存在性校验时返回 null（不抛错）。
 */
export function resolveRuntimeBinary(
  options: ResolveRuntimeBinaryOptions,
): RuntimeBinaryResolution | null {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;

  const envValue = nonEmptyString(env[options.envVar]);
  if (envValue && isExistingFile(envValue)) {
    return { path: envValue, source: 'env' };
  }

  const resourceValue = nonEmptyString(options.resourcePath);
  if (resourceValue && isExistingFile(resourceValue)) {
    return { path: resourceValue, source: 'resource' };
  }

  const bundledValue = nonEmptyString(options.bundledPath);
  if (bundledValue && isExistingFile(bundledValue)) {
    return { path: bundledValue, source: 'bundled' };
  }

  const pathValue = resolveFromPath(env, platform, options.name);
  if (pathValue) {
    return { path: pathValue, source: 'path' };
  }

  return null;
}

/**
 * 构造面向用户的「二进制不可用」提示 —— 唯一诚实且可操作的文案：
 * 要么安装系统命令并加入 PATH，要么用环境变量显式指定绝对路径。
 * 不再提示安装 ffmpeg-static / ffprobe-static（打包产物中它并不存在）。
 */
export function runtimeBinaryUnavailableMessage(options: {
  /** 展示名，如 FFmpeg / FFprobe */
  label: string;
  /** 可执行文件名，如 ffmpeg / ffprobe */
  binaryName: string;
  /** 显式指定路径的环境变量名 */
  envVar: string;
}): string {
  return (
    `${options.label} 不可用：系统未找到可执行文件。` +
    `请安装 ${options.binaryName} 并将其加入系统 PATH，` +
    `或通过环境变量 ${options.envVar} 指定其绝对路径。`
  );
}
