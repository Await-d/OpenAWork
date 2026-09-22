export const CHANNEL_PERMISSION_TOOL_NAMES = [
  'PluginSendMessage',
  'PluginReplyMessage',
  'PluginSendImage',
  'PluginGetGroupMessages',
  'PluginListGroups',
  'PluginSummarizeGroup',
  'PluginGetCurrentChatMessages',
  'WeixinSendImage',
  'WeixinSendFile',
  'FeishuSendImage',
  'FeishuSendFile',
  'FeishuListChatMembers',
  'FeishuAtMember',
  'FeishuSendUrgent',
  'FeishuBitableListApps',
  'FeishuBitableListTables',
  'FeishuBitableListFields',
  'FeishuBitableGetRecords',
  'FeishuBitableCreateRecords',
  'FeishuBitableUpdateRecords',
  'FeishuBitableDeleteRecords',
] as const;

const BASE_TOOL_TO_CATEGORY = {
  read: 'read',
  edit: 'edit',
  multi_edit: 'edit',
  patch: 'edit',
  write: 'write',
  workspace_create_directory: 'write',
  bash: 'bash',
  interactive_bash: 'bash',
  // 后台 bash 三件套：run_bash_in_background 能执行任意 shell 命令（与前台 bash
  // 等价），bash_output / bash_kill 操作同一批后台终端。此前未注册导致它们落到
  // “未映射 → 通配符 allow” 的静默放行路径，在 ask 档位下也能无审批拿到 shell。
  run_bash_in_background: 'bash',
  bash_output: 'bash',
  bash_kill: 'bash',
  // lsp_touch 会改写文件时间戳以触发 LSP 重新加载，属于文件副作用，按编辑类审批。
  lsp_touch: 'edit',
  // 媒体生成/转换类工具会写盘（图片、音频、视频帧、转码结果），必须审批。
  generate_image: 'custom',
  generate_audio: 'custom',
  convert_media: 'custom',
  extract_media_info: 'custom',
  extract_video_frame: 'custom',
  // 仓库取回/概览会访问网络并把内容写入本地（clone），属于外部来源写操作，必须审批。
  repo_clone: 'custom',
  repo_overview: 'custom',
  glob: 'glob',
  grep: 'grep',
  task: 'task_run',
  task_create: 'task',
  task_update: 'task',
  call_omo_agent: 'task_run',
  skill: 'skill',
  skill_mcp: 'skill',
  mcp_call: 'mcp_call',
  lsp_rename: 'lsp',
  websearch: 'websearch',
  webfetch: 'webfetch',
  codesearch: 'codesearch',
  workspace_review_revert: 'edit',
  ast_grep_replace: 'edit',
  desktop_automation: 'desktop_automation',
  desktop_control: 'desktop_control',
  // computer_use 与 desktop_control 同属「系统桌面控制」权限类别（默认 ask）：
  // 两者都驱动本机桌面，权限语义必须一致。
  computer_use: 'desktop_control',
  // 会话管理：重命名标题、切换/解绑工作目录。均为会话级副作用，默认 ask。
  session_rename: 'session',
  session_move: 'session',
} as const;

export const TOOL_TO_PERMISSION_CATEGORY: Readonly<Record<string, string>> = {
  ...BASE_TOOL_TO_CATEGORY,
  ...Object.fromEntries(CHANNEL_PERMISSION_TOOL_NAMES.map((toolName) => [toolName, 'channel'])),
};

/**
 * 内置“默认放行”工具名集合（显式枚举，禁止隐式兜底）。
 *
 * 安全背景：网关的 DEFAULT_PERMISSION_RULES 首条是
 * `{ permission: '*', pattern: '*', action: 'allow' }`，而 `resolvePermissionCategory`
 * 曾把未映射工具名原样返回，于是“未注册”等价于“静默放行”——run_bash_in_background
 * 这类有副作用的工具借此在 ask 档位下绕过了审批。现在未映射工具一律回退到
 * `custom`（默认 ask），只有下方显式枚举的工具才保留“原始工具名 → 命中通配符 allow”
 * 的旧语义。
 *
 * 准入标准（必须同时满足）：
 * 1. 只读检查/检索/会话状态查询，或纯委派（子调用各自仍需过权限检查）；
 * 2. 不产生文件系统 / 网络 / 进程副作用（会话内待办与计划模式状态除外）；
 * 3. 作用范围限于当前会话或当前工作区。
 *
 * 新工具若不能确定安全，一律不要加入——让它落到 `custom`（ask），fail-closed。
 */
export const ALLOW_BY_DEFAULT_TOOL_NAMES: ReadonlySet<string> = new Set<string>([
  // 向用户提问：本身即用户交互，无副作用。
  'question',
  // 后台任务输出为只读；取消只作用于本会话自己启动的后台任务。
  'background_output',
  'background_cancel',
  // 会话历史只读查询。
  'session_list',
  'session_read',
  'session_search',
  'session_info',
  // AST 只读搜索（替换走 ast_grep_replace → edit，仍需审批）。
  'ast_grep_search',
  // plan 模式状态切换：ExitPlanMode 自带用户计划审批（question）流程。
  'EnterPlanMode',
  'ExitPlanMode',
  // 读取媒体内容 / 历史工具输出（只读）。
  'look_at',
  'read_tool_output',
  // batch 只是复用沙箱分发器，子调用逐个走各自的权限检查。
  'batch',
  // LSP 只读查询（lsp_rename 已映射到 lsp 类，仍需审批）。
  'lsp_diagnostics',
  'lsp_goto_definition',
  'lsp_goto_implementation',
  'lsp_find_references',
  'lsp_symbols',
  'lsp_prepare_rename',
  'lsp_hover',
  'lsp_call_hierarchy',
  // 任务图只读查询（task_create / task_update 已映射到 task 类，仍需审批）。
  'task_get',
  'task_list',
  // 会话待办读/写：只改当前会话可见的清单，不触碰文件系统与网络。
  'todoread',
  'todowrite',
  'subtodoread',
  'subtodowrite',
  // MCP 工具清单只读（mcp_call 已映射到 mcp_call 类，仍需审批）。
  'mcp_list_tools',
  // codegraph 只读查询 + 缓存索引（索引只写网关数据目录下的代码图谱缓存）。
  'codegraph_status',
  'codegraph_index',
  'codegraph_search',
  'codegraph_node',
  'codegraph_callers',
  'codegraph_impact',
  // 工作区只读列表 / 评审状态与差异。
  'list',
  'workspace_review_status',
  'workspace_review_diff',
  // 模型搜索只读：只列出账号已配置 provider 的模型，无文件/网络副作用。
  'models',
]);
