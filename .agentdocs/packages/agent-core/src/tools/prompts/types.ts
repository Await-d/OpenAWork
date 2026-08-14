/**
 * 工具提示词接口规范
 *
 * 所有工具提示词必须遵循此规范
 */

/**
 * 工具使用指南
 * 详细的 Markdown 格式文本，包含：
 * - 工具概述
 * - 使用场景
 * - 参数说明
 * - 代码示例
 * - 最佳实践
 * - 错误处理
 * - 常见问题
 */
export type ToolUsageGuide = string;

/**
 * 工具名称列表
 * 只读的字符串数组
 */
export type ToolNamesList = readonly string[];

/**
 * 工具提示词导出规范
 */
export interface ToolPromptExport {
  /** 工具使用指南 */
  USAGE_GUIDE: ToolUsageGuide;
  /** 工具名称列表 */
  TOOLS_LIST: ToolNamesList;
}

/**
 * 示例：LSP 工具提示词
 *
 * @example
 * ```typescript
 * export const LSP_TOOL_USAGE_GUIDE: ToolUsageGuide = `
 * ## LSP 工具使用指南
 * ...
 * `;
 *
 * export const LSP_TOOLS_LIST: ToolNamesList = [
 *   'lsp_diagnostics',
 *   'lsp_touch',
 *   // ...
 * ] as const;
 * ```
 */
