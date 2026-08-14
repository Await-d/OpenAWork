/**
 * 工具章节生成器
 *
 * 根据启用的工具动态生成使用指南章节
 */

import {
  LSP_TOOL_USAGE_GUIDE,
  LSP_TOOLS_LIST,
  WEB_SEARCH_TOOL_USAGE_GUIDE,
  WEB_SEARCH_TOOLS_LIST,
  HASH_EDIT_TOOL_USAGE_GUIDE,
  HASH_EDIT_TOOLS_LIST,
  POST_WRITE_LINT_USAGE_GUIDE,
  POST_WRITE_LINT_TOOLS_LIST,
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
    {
      title: 'Web 搜索工具',
      content: WEB_SEARCH_TOOL_USAGE_GUIDE,
      tools: WEB_SEARCH_TOOLS_LIST,
    },
    {
      title: '哈希锚定编辑工具',
      content: HASH_EDIT_TOOL_USAGE_GUIDE,
      tools: HASH_EDIT_TOOLS_LIST,
    },
    {
      title: 'Post-Write Lint 工具',
      content: POST_WRITE_LINT_USAGE_GUIDE,
      tools: POST_WRITE_LINT_TOOLS_LIST,
    },
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
