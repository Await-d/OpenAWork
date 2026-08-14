/**
 * 工具提示词接口规范
 *
 * 用于定义工具使用指南的标准接口
 */

/**
 * 工具使用指南
 *
 * 包含详细的工具使用说明、最佳实践和示例代码
 */
export type ToolUsageGuide = string;

/**
 * 工具列表
 *
 * 定义该提示词覆盖的工具名称列表
 */
export type ToolsList = readonly string[];

/**
 * 工具提示词模块接口
 */
export interface ToolPromptModule {
  /** 工具使用指南内容 */
  usageGuide: ToolUsageGuide;
  /** 该提示词覆盖的工具列表 */
  tools: ToolsList;
}
