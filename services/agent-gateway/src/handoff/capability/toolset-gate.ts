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
  read: ['read', 'list', 'glob', 'grep', 'read_tool_output', 'look_at', 'repo_overview'],
  write: ['write', 'edit', 'multi_edit', 'apply_patch'],
  shell: ['bash', 'run_background_bash', 'interactive_bash'],
  // 实际注册的联网工具规范名是 'websearch' / 'webfetch'（tools/tool-aliases.ts、
  // tools/web-tools.ts），早期写成 'web_search' 与任何已注册工具都对不上，会被
  // filterToolsByAllowedSets 静默过滤掉，导致 reception / executor 选了 web 也拿不到
  // 联网能力。这里改用规范名。
  web: ['websearch', 'webfetch'],
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
  review: ['read', 'list', 'grep', 'glob', 'lsp_goto_definition', 'lsp_find_references', 'lsp_diagnostics'],
  all: [], // 特殊值：不过滤
};

/**
 * 始终放行的内部工具集合——无论 toolset 类别如何门控，这些工具对 team 成员始终可用。
 * 注意：使用实际注册的工具名（todoread/todowrite），而非历史遗留的下划线命名。
 */
const ALWAYS_ALLOWED_INTERNAL_TOOLS = new Set([
  'todoread',
  'todowrite',
  'subtodoread',
  'subtodowrite',
  'task_list',
  'task_get',
  'task_create',
  'task_update',
  'session_list',
  'session_read',
  'session_search',
  'session_info',
]);

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

  return tools.filter(
    (tool) =>
      allowedNames.has(tool.function.name) ||
      ALWAYS_ALLOWED_INTERNAL_TOOLS.has(tool.function.name) ||
      // 动态注入的 MCP 扁平工具（mcp__<server>__<tool>）不在静态类别表里，但它们已在上游
      // 按会话 metadata.requestedMcpServers 白名单过滤过——是「该成员显式绑定授权」的工具，
      // 不应再被层类别表二次拦截（否则 team 各层绑定了 MCP 也调不到）。放行。
      isDynamicallyBoundTool(tool.function.name),
  );
}

/**
 * 判断某工具是否为「动态绑定」工具——这类工具名不在 TOOLSET_TO_TOOL_NAMES 的静态类别表里，
 * 但已在 stream 管道上游按会话级白名单（requestedMcpServers / requestedSkills）过滤授权过，
 * 因此应绕过 toolset 类别门控直接放行：
 *   - MCP 扁平工具：mcp__<server>__<tool>（前缀 MCP_FLAT_TOOL_PREFIX）。
 *
 * 注意：这不放宽安全边界——能到这一步的 MCP 工具一定是该会话 metadata 显式绑定的；
 * 未绑定的 MCP server 在 listMcpToolsForSession 阶段就已被 allowedServerIds 挡掉。
 */
export function isDynamicallyBoundTool(toolName: string): boolean {
  return toolName.startsWith('mcp__');
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
