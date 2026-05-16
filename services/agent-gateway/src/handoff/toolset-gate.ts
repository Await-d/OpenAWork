/**
 * 260516-team-phase-d · T-08
 *
 * Toolset 门控基础实现。
 *
 * 设计：
 *   - dispatch_package 中声明 `toolsets: ToolsetCategory[]`
 *   - executor 层 session 创建时，把 toolsets 写入 session metadata
 *   - stream 路由在构建 enabledTools 时读取 metadata 中的 toolsets 白名单
 *   - 不在白名单内的工具被过滤掉（executor 看不到也调不了）
 *
 * Phase D 实现范围：
 *   - 提供 `filterToolsByAllowedSets` 函数
 *   - 提供 `TOOLSET_TO_TOOL_NAMES` 映射表
 *   - 由 stream.ts 在 `getEnabledTools` 后调用（Phase D 先不改 stream.ts，
 *     只提供函数；Phase E 接入时改一行即可）
 */

import type { ToolsetCategory } from './dispatch-package.js';

/**
 * 工具类别 → 工具名列表的映射。
 *
 * 这个映射表是 D43 能力类别表的代码化。
 * 当 dispatch_package 声明 toolsets: ['read', 'write'] 时，
 * executor 只能看到这两个类别下的工具。
 */
export const TOOLSET_TO_TOOL_NAMES: Record<ToolsetCategory, readonly string[]> = {
  read: ['read', 'glob', 'grep', 'read_tool_output', 'look_at', 'repo_overview'],
  write: ['write', 'edit', 'multi_edit', 'apply_patch'],
  shell: ['bash', 'run_background_bash', 'interactive_bash'],
  web: ['web_search'],
  lsp: [
    'lsp_goto_definition',
    'lsp_goto_implementation',
    'lsp_find_references',
    'lsp_symbols',
    'lsp_hover',
    'lsp_call_hierarchy',
    'lsp_diagnostics',
    'lsp_rename',
    'lsp_prepare_rename',
  ],
  test: [
    'bash', // 测试通过 bash 执行
  ],
  review: ['read', 'grep', 'glob', 'lsp_goto_definition', 'lsp_find_references', 'lsp_diagnostics'],
  all: [], // 特殊值：不过滤
};

/**
 * 根据允许的 toolset 类别过滤工具列表。
 *
 * @param tools 完整工具列表（每个工具有 function.name）
 * @param allowedSets 允许的类别列表
 * @returns 过滤后的工具列表
 */
export function filterToolsByAllowedSets<T extends { function: { name: string } }>(
  tools: T[],
  allowedSets: ToolsetCategory[],
): T[] {
  // 'all' 表示不限制
  if (allowedSets.includes('all')) return tools;

  const allowedNames = new Set<string>();
  for (const category of allowedSets) {
    const names = TOOLSET_TO_TOOL_NAMES[category];
    for (const name of names) {
      allowedNames.add(name);
    }
  }

  // 始终允许的基础工具（不受门控影响）
  const alwaysAllowed = new Set(['AskUserQuestion', 'todo_read', 'todo_write']);

  return tools.filter(
    (tool) => allowedNames.has(tool.function.name) || alwaysAllowed.has(tool.function.name),
  );
}

/**
 * 从 session metadata 中提取 toolsets 白名单。
 * 如果 metadata 中没有 toolsets 字段，返回 null（不做门控）。
 */
export function extractToolsetsFromMetadata(metadataJson: string): ToolsetCategory[] | null {
  try {
    const meta = JSON.parse(metadataJson) as Record<string, unknown>;
    const toolsets = meta['toolsets'];
    if (!Array.isArray(toolsets)) return null;
    return toolsets.filter((t): t is ToolsetCategory => typeof t === 'string');
  } catch (_err) {
    void _err;
    return null;
  }
}
