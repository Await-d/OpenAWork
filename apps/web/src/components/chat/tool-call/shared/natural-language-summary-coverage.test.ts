import { describe, expect, it } from 'vitest';

import { naturalLanguageSummary } from './natural-language-summary.js';

/**
 * 会由 `naturalLanguageSummary` 给出折叠行标题的工具清单（简化自工具盘点，含 LSP /
 * codegraph / git_bash / 管理类 / 渠道 等各族的代表）。
 *
 * 这些工具**一个都不该**落到通用回退 —— 回退文案是 `已执行了 <工具名>`，会把
 * `memory_manage`、`codegraph_search` 这样的英文名直接展示给用户。这正是本轮
 * 反复踩到的坑：新视图做完了，标题却还漏着。
 *
 * 走专用卡片、标题不由这里出的工具（`subagent` 族 → Task 卡，`generate_image` /
 * `convert_media` / `generate_audio` / `extract_video_frame` → 各自卡片）不在清单里。
 */
const COVERED_TOOL_NAMES: readonly string[] = [
  // 文件与检索
  'list',
  'read',
  'glob',
  'grep',
  'codesearch',
  'write',
  'edit',
  'multi_edit',
  'patch',
  'workspace_review_status',
  'workspace_review_diff',
  'workspace_create_directory',
  'workspace_review_revert',
  'read_tool_output',
  // shell / 桌面
  'bash',
  'interactive_bash',
  'background_output',
  'background_cancel',
  'desktop_automation',
  'desktop_control',
  'computer_use',
  'look_at',
  // 网络
  'webfetch',
  'websearch',
  'google_search',
  'web_search',
  // 计划 / 提问 / 待办 / 任务 / 会话
  'question',
  'askuserquestion',
  'EnterPlanMode',
  'ExitPlanMode',
  'todowrite',
  'todoread',
  'subtodowrite',
  'subtodoread',
  'task_create',
  'task_get',
  'task_list',
  'task_update',
  'session_list',
  'session_read',
  'session_search',
  'session_info',
  'session_rename',
  'session_move',
  // 仓库 / 技能 / MCP
  'repo_clone',
  'repo_overview',
  'skill',
  'skill_mcp',
  'skill_manage',
  'mcp_list_tools',
  'mcp_call',
  'mcp_manage_servers',
  // 折叠入口
  'tool_invoke',
  'tool_search',
  // 媒体
  'extract_media_info',
  // 管理类
  'memory_manage',
  'plugin_manage',
  'schedule_manage',
  'agent_manage',
  'team_workspace_manage',
  // 模型 / 图谱 / git_bash / LSP
  'models',
  'codegraph_status',
  'codegraph_index',
  'codegraph_search',
  'codegraph_node',
  'codegraph_callers',
  'codegraph_impact',
  'git_bash_status',
  'lsp_diagnostics',
  'lsp_touch',
  'lsp_goto_definition',
  'lsp_symbols',
  'lsp_hover',
  'lsp_status',
  // 渠道（发送 + 读取 + 数据表）
  'PluginSendMessage',
  'PluginReplyMessage',
  'PluginGetGroupMessages',
  'PluginListGroups',
  'WeixinSendImage',
  'FeishuSendImage',
  'FeishuAtMember',
  'FeishuSendUrgent',
  'FeishuListChatMembers',
  'FeishuBitableGetRecords',
  'FeishuBitableCreateRecords',
];

describe('naturalLanguageSummary — 覆盖检查', () => {
  it('清单里每个工具都有专属文案，没有落回退（回退 = 英文工具名泄漏）', () => {
    const fallen = COVERED_TOOL_NAMES.filter(
      (toolName) => naturalLanguageSummary(toolName, {}) === `已执行了 ${toolName}`,
    );

    // 失败时直接列出漏掉的工具名，比断言 true 有用得多。
    expect(fallen).toEqual([]);
  });

  it('MCP 扁平名同样不落回退（两条通道一致）', () => {
    const flatNames = [
      'mcp__lsp__diagnostics',
      'mcp__lsp__status',
      'mcp__codegraph__codegraph_search',
      'mcp__git_bash__which_bash',
      'mcp__git_bash__run',
      'mcp__open_websearch__fetch_web',
    ];
    const fallen = flatNames.filter(
      (toolName) => naturalLanguageSummary(toolName, {}) === `已执行了 ${toolName}`,
    );

    expect(fallen).toEqual([]);
  });
});
