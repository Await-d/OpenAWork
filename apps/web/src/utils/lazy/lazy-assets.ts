/**
 * 重型预览依赖的按需加载入口（模块级懒加载器）。
 *
 * 必须留在模块级：React Compiler 1.0.0 不支持 `import()` 表达式
 * （"Handle Import expressions"），直接写在组件 / hook 里会让整个函数脱靶
 * （实测）。把这些动态导入集中到模块函数后，组件只调普通函数即可。
 */

/** mermaid 实例类型（与 `import('mermaid').default` 一致）。 */
export type MermaidApi = (typeof import('mermaid'))['default'];

/** 按需加载 mermaid。调用方负责处理失败与取消（组件里按需判 `cancelled`）。 */
export async function loadMermaidOnce(): Promise<MermaidApi> {
  const mod = await import('mermaid');
  return mod.default;
}

/** mammoth 实例（浏览器构建挂在 package default 上）。 */
export type MammothApi = typeof import('mammoth');

/** 按需加载 mammoth（DOCX → HTML 转换）。 */
export async function loadMammothOnce(): Promise<MammothApi> {
  return import('mammoth');
}

/** 按需加载 xlsx 解析库（SheetJS）。 */
export async function loadXlsxOnce(): Promise<typeof import('xlsx')> {
  return import('xlsx');
}

/**
 * 按需加载 Tauri window API；非 Tauri 环境下由调用方先行短路。
 *
 * 单独成函数而非内联表达式：`import()` 只能出现在模块级。
 */
export async function loadTauriWindowOnce(): Promise<typeof import('@tauri-apps/api/window')> {
  return import('@tauri-apps/api/window');
}

/** 按需加载 Tauri webview 模块。 */
export async function loadTauriWebviewOnce(): Promise<typeof import('@tauri-apps/api/webview')> {
  return import('@tauri-apps/api/webview');
}

/** 按需加载 Tauri dpi 模块（缩放因子与物理尺寸换算）。 */
export async function loadTauriDpiOnce(): Promise<typeof import('@tauri-apps/api/dpi')> {
  return import('@tauri-apps/api/dpi');
}
