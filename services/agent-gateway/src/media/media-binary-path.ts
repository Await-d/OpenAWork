/**
 * 媒体二进制路径解析 —— `infra/runtime-binary` 在媒体域的薄封装。
 *
 * 四级回退（env → 桌面资源目录 → 内嵌 bundled → 系统 PATH）与存在性校验
 * 全部由 `resolveRuntimeBinary` 实现；这里只负责组装媒体域参数，
 * 并为桌面端资源目录 `OPENAWORK_RESOURCES_DIR/media/` 提供候选路径。
 */

import { join } from 'node:path';
import { resolveRuntimeBinary, type RuntimeBinaryResolution } from '../infra/runtime-binary.js';

/** 桌面端资源目录内媒体二进制的子目录。 */
const MEDIA_RESOURCE_SUBDIR = 'media';

export interface MediaBinaryResolutionOptions {
  /** 显式指定路径的环境变量名，如 FFMPEG_BIN / FFPROBE_BIN */
  envVar: string;
  /** 可执行文件名（不含扩展名），如 ffmpeg / ffprobe */
  name: string;
  /** 桌面端资源目录下的候选路径 */
  resourcePath?: string | null;
  /** 打包内嵌的候选路径（ffmpeg-static / ffprobe-static 默认导出） */
  bundledPath?: unknown;
  /** 环境变量来源，默认 process.env；测试可注入 */
  env?: NodeJS.ProcessEnv;
  /** 目标平台，默认 process.platform；测试可注入 */
  platform?: NodeJS.Platform;
}

/**
 * 构造 `<OPENAWORK_RESOURCES_DIR>/media/<name>[.exe]` 候选路径。
 * 桌面端（Tauri sidecar）会注入该环境变量；未注入时返回 null。
 */
export function resolveMediaResourcePath(name: string): string | null {
  const resourcesDir = process.env.OPENAWORK_RESOURCES_DIR?.trim();
  if (!resourcesDir) {
    return null;
  }
  const fileName = process.platform === 'win32' ? `${name}.exe` : name;
  return join(resourcesDir, MEDIA_RESOURCE_SUBDIR, fileName);
}

/**
 * 解析媒体二进制路径。
 * 返回带来源标记的解析结果；全部候选未通过存在性校验时返回 null。
 */
export function resolveMediaBinaryPath(
  options: MediaBinaryResolutionOptions,
): RuntimeBinaryResolution | null {
  return resolveRuntimeBinary({
    envVar: options.envVar,
    name: options.name,
    resourcePath: options.resourcePath ?? null,
    bundledPath: options.bundledPath,
    env: options.env,
    platform: options.platform,
  });
}
