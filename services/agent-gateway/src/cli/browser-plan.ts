/**
 * `--print-browser-plan` 诊断入口。
 *
 * 供发布 CI 在编译后的 sidecar 二进制上做冒烟验证：`bun build --compile` 会把
 * Playwright 的注册表元数据内联进产物，普通单测覆盖不到这一点，只有真实二进制
 * 才能证明 `resolveManagedBrowserTargets` 在 sidecar 中仍可解析。
 *
 * 输出 JSON 计划后返回退出码：解析到至少一个可下载目标为 0，目标为空或抛错为 1。
 */

import { resolveBrowsersPath } from '../browser-live/browser-installer.js';

/** 从 argv 中读取 `--browsers-path <value>`；缺省 / 空值返回 null。 */
function readBrowsersPathArg(argv: readonly string[]): string | null {
  const index = argv.indexOf('--browsers-path');
  if (index === -1) return null;

  const value = argv[index + 1];
  if (value === undefined) return null;

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * 执行 `--print-browser-plan`：解析托管浏览器目标并以 JSON 形式写到 stdout。
 *
 * @returns 0 表示至少解析到一个可下载目标；1 表示目标为空或解析失败。
 */
export async function runPrintBrowserPlan(argv: readonly string[]): Promise<number> {
  const browsersPath = readBrowsersPathArg(argv) ?? resolveBrowsersPath();
  const base = {
    platform: process.platform,
    arch: process.arch,
    browsersPath,
  };

  try {
    // 动态 import：普通启动路径不应因此急切加载 Playwright 注册表。
    const { resolveManagedBrowserTargets } = await import('@openAwork/browser-automation');
    const targets = resolveManagedBrowserTargets(browsersPath).map((target) => ({
      name: target.name,
      revision: target.revision,
      browserVersion: target.browserVersion,
      directory: target.directory,
      executableRelativePath: target.executableRelativePath,
      downloadUrls: target.downloadUrls,
    }));

    process.stdout.write(`${JSON.stringify({ ok: true, ...base, targets }, null, 2)}\n`);
    return targets.length > 0 ? 0 : 1;
  } catch (error) {
    const message =
      error instanceof Error && error.message.length > 0 ? error.message : String(error);
    process.stdout.write(`${JSON.stringify({ ok: false, ...base, error: message }, null, 2)}\n`);
    return 1;
  }
}
