/**
 * 「懒加载模块取不回来」的统一判定。
 *
 * 各浏览器的报错文案并不一致，必须逐条匹配，不能只看一种：
 * - Chrome / Edge：`Failed to fetch dynamically imported module: <url>`
 * - Firefox：`error loading dynamically imported module: <url>`
 * - WebKit（Tauri / Safari）：`Importing a module script failed.`
 * - 构建期 split chunk：`Loading chunk 42 failed` / `ChunkLoadError`
 *
 * 这类失败的共同点是**模块本身没错、只是这次没取到**：开发环境来自 Vite
 * 依赖预构建重建或服务重启，生产环境来自发布后旧 chunk 被替换。唯一的
 * 恢复动作是整页刷新——组件层重挂载拿不到新的模块图。
 */
const DYNAMIC_IMPORT_FAILURE_PATTERNS: readonly RegExp[] = [
  /failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /importing a module script failed/i,
  /chunkloaderror/i,
  /loading chunk \d+ failed/i,
];

function matchesFailureText(text: string): boolean {
  return DYNAMIC_IMPORT_FAILURE_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * 判断错误是否为动态导入失败。
 *
 * 用结构化读取而非 `instanceof Error`：跨 realm（iframe / WebView 注入）时
 * 原型链可能对不上，但 `name` / `message` 仍然可读。
 */
export function isDynamicImportFailure(error: unknown): boolean {
  if (typeof error === 'string') {
    return matchesFailureText(error);
  }
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const candidate = error as { name?: unknown; message?: unknown };
  const name = typeof candidate.name === 'string' ? candidate.name : '';
  const message = typeof candidate.message === 'string' ? candidate.message : '';
  return matchesFailureText(`${name}: ${message}`);
}
