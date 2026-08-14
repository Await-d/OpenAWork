/**
 * 工具章节生成器
 *
 * 根据启用的工具动态生成使用指南章节
 */

import {
  LSP_TOOL_USAGE_GUIDE,
  LSP_TOOLS_LIST,
} from '@openAwork/agent-core';

export interface ToolSection {
  title: string;
  content: string;
  tools: readonly string[];
}

/**
 * 获取所有可用的工具章节
 */
export function getAllToolSections(): ToolSection[] {
  return [
    {
      title: 'LSP 工具',
      content: LSP_TOOL_USAGE_GUIDE,
      tools: LSP_TOOLS_LIST,
    },
    // 其他工具章节将在后续添加
  ];
}

/**
 * 根据启用的工具筛选章节
 */
export function getEnabledToolSections(
  enabledTools: Set<string>,
): ToolSection[] {
  return getAllToolSections().filter(section =>
    section.tools.some(tool => enabledTools.has(tool)),
  );
}

/**
 * 生成工具使用章节文本
 */
export function buildToolUsageSections(
  enabledTools: Set<string>,
): string {
  const sections = getEnabledToolSections(enabledTools);

  if (sections.length === 0) {
    return '';
  }

  const header = '# 工具使用指南\n\n';
  const content = sections.map(s => s.content).join('\n\n---\n\n');

  return header + content;
}
