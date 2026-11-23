/**
 * 将工具调用转换为自然语言过去式摘要（不含具体路径/命令/模式）。
 * 用于折叠态的简洁展示，与截图参考风格一致。
 *
 * 规则：动词短语 + 可选数量（当数量提供信息时）
 * 例：已编辑了文件 / 已运行了命令 / 已查看 4 个文件 / 已调用 MCP 工具
 */

import { parseDirectoryListing } from './directory-listing.js';

/**
 * 后台任务读数的任务信息。
 *
 * `background_output` 的工具输出有两种模板（见
 * `services/agent-gateway/src/task/delegated-task-display.ts`）：
 * - 任务已完成 → `任务结果` 块，含 `描述：<任务名>` 行；
 * - 任务未完成 → `# 任务状态` 表格，含 `| 描述 | <任务名> |` 与 `| 状态 | **running** |` 行。
 *
 * 两个字段都解析不到时返回空对象——宁可只显示动作，也不猜一个错误的归属。
 */
export interface BackgroundTaskReadInfo {
  /** 任务名（描述）。 */
  label?: string;
  /** 读取时刻的任务状态（已完成 / 运行中 / 排队中 / 已失败 / 已取消）。 */
  state?: string;
}

const TASK_STATE_LABELS: Record<string, string> = {
  cancelled: '已取消',
  completed: '已完成',
  done: '已完成',
  failed: '已失败',
  pending: '排队中',
  running: '运行中',
};

export function resolveBackgroundTaskReadInfo(output: unknown): BackgroundTaskReadInfo {
  const text = readBackgroundOutputText(output);
  if (text.length === 0) {
    return {};
  }

  const resultLine = /^描述：(.+)$/m.exec(text)?.[1];
  const tableRow = /^\|\s*描述\s*\|\s*(.+?)\s*\|\s*$/m.exec(text)?.[1];
  const label = (resultLine ?? tableRow)?.trim();

  // `任务结果` 模板只在任务已完成时使用；状态表格模板里显式带状态列。
  const tableState = /^\|\s*状态\s*\|\s*\*{0,2}([A-Za-z_-]+)\*{0,2}\s*\|\s*$/m.exec(text)?.[1];
  const state = text.startsWith('任务结果')
    ? '已完成'
    : tableState
      ? TASK_STATE_LABELS[tableState.trim().toLowerCase()]
      : undefined;

  return {
    ...(label && label.length > 0 ? { label } : {}),
    ...(state ? { state } : {}),
  };
}

function readBackgroundOutputText(output: unknown): string {
  if (typeof output === 'string') {
    return output;
  }

  if (output && typeof output === 'object' && !Array.isArray(output)) {
    const record = output as Record<string, unknown>;
    for (const key of ['message', 'result', 'text']) {
      const value = record[key];
      if (typeof value === 'string') {
        return value;
      }
    }
  }

  return '';
}

/** 读取输入里的目标路径（read 工具支持 filePath / path / file_path 三种拼写）。 */ function readTargetPath(
  input: Record<string, unknown>,
): string | undefined {
  for (const key of ['filePath', 'path', 'file_path'] as const) {
    const value = input[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

/** 读取输出里的文件路径（网关 read 输出契约的 `path`）。 */
function readOutputPath(output: unknown): string | undefined {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return undefined;
  const value = (output as Record<string, unknown>).path;
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

/** list 输出里的条目计数（`visitedEntries`）。 */
function readVisitedCount(output: unknown): number | undefined {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return undefined;
  const value = (output as Record<string, unknown>).visitedEntries;
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * `:12-61` 形式的读取行区间（无信息时返回空串）。
 * 输出携带精确的 `lineStart/lineEnd` 时优先；运行中退回输入的 `offset` / `limit`；
 * read 命中目录（文本清单形态）时行区间没有意义，返回空串。
 */
function formatReadRange(input: Record<string, unknown>, output: unknown): string {
  if (output && typeof output === 'object' && !Array.isArray(output)) {
    const record = output as Record<string, unknown>;
    if (typeof record.content === 'string' && parseDirectoryListing(record.content) !== null) {
      return '';
    }
    const lineStart = typeof record.lineStart === 'number' ? record.lineStart : undefined;
    const lineEnd = typeof record.lineEnd === 'number' ? record.lineEnd : undefined;
    if (lineStart !== undefined && lineEnd !== undefined) return `:${lineStart}-${lineEnd}`;
  }
  const offset = typeof input.offset === 'number' && input.offset > 0 ? input.offset : undefined;
  const limit = typeof input.limit === 'number' && input.limit > 0 ? input.limit : undefined;
  if (offset === undefined && limit === undefined) return '';
  const start = offset ?? 1;
  return limit !== undefined ? `:${start}-${start + limit - 1}` : `:${start}-`;
}

/** 摘要展示选项。 */
export interface NaturalLanguageSummaryOptions {
  skillStatus?: string;
  /**
   * 摘要里省略路径与行区间。
   *
   * 用于 read 的**展开态**：路径与行范围已经在预览的 meta 行里（带「点击预览」），
   * 摘要再显示一遍会让同一个路径出现两次（用户口径：两处合成一处，且保留 meta 的点击预览）。
   */
  omitPath?: boolean;
}

export function naturalLanguageSummary(
  toolName: string,
  input: Record<string, unknown>,
  output?: unknown,
  options: NaturalLanguageSummaryOptions = {},
): string {
  const n = toolName.trim().toLowerCase();
  if (!n || n === 'tool') return '工具调用';

  // ── 文件读取 ──
  // 查看类工具直接给出「读了哪个文件、读的是哪几行」：路径 + `:行区间`
  // （优先用输出里的精确 lineStart/lineEnd，运行中则用输入的 offset/limit 估算）。
  if (n === 'read') {
    // 展开态下路径/行区间已经在预览的 meta 行里（带点击预览），摘要不再重复展示。
    if (options.omitPath) return '已查看了文件';
    const path = readTargetPath(input) ?? readOutputPath(output);
    if (!path) return '已查看了文件';
    return `已查看了 ${path}${formatReadRange(input, output)}`;
  }
  if (n === 'list') {
    // 目录工具：路径直接进摘要（界面上要能一眼看到列的是哪个目录）。
    const path = readTargetPath(input) ?? readOutputPath(output);
    const visited = readVisitedCount(output);
    if (!path) return '已列举了目录';
    return visited !== undefined ? `已列举了目录 ${path}（${visited} 项）` : `已列举了目录 ${path}`;
  }
  if (n === 'grep') return '已搜索了内容';
  if (n === 'glob') return '已搜索了文件';
  if (n === 'codesearch') return '已搜索了代码';
  if (n === 'ast_grep_search') return '已执行了 AST 搜索';
  if (n === 'workspace_review_status') return '已查看了工作区状态';
  if (n === 'workspace_review_diff') return '已查看了文件差异';
  if (n === 'read_tool_output') return '已读取了工具输出';
  if (n === 'session_list') return '已列举了会话';
  if (n === 'session_read') return '已读取了会话';
  if (n === 'session_search') return '已搜索了会话';

  // ── 文件编辑 ──
  if (n === 'write') return '已创建了文件';
  if (n === 'edit' || n === 'multi_edit' || n === 'hash_edit') return '已编辑了文件';
  if (n === 'patch') return '已应用了补丁';
  if (n === 'ast_grep_replace') return '已执行了 AST 替换';
  if (n === 'workspace_create_directory') {
    const path = readTargetPath(input) ?? readOutputPath(output);
    return path ? `已创建了目录 ${path}` : '已创建了目录';
  }
  if (n === 'workspace_review_revert') {
    const path = readTargetPath(input) ?? readOutputPath(output);
    return path ? `已还原了文件 ${path}` : '已还原了文件';
  }

  // ── Shell 执行 ──
  if (n === 'bash' || n === 'interactive_bash') return '已运行了命令';
  if (n === 'background_output') {
    // 读的是哪一个后台任务、读到的是什么状态（解析不到时保持旧文案）。
    const { label, state } = resolveBackgroundTaskReadInfo(output);
    const base = label ? `已读取了后台输出 · ${label}` : '已读取了后台输出';
    return state ? `${base}（${state}）` : base;
  }
  if (n === 'background_cancel') return '已取消了后台任务';
  if (n === 'desktop_automation' || n === 'desktop_control') {
    // 动作名是这条调用里信息量最大的部分（点击 / 截图 / 读取控制台…），带上它比
    // 统一的「已执行了桌面操作」更有辨识度；缺省时保持旧文案。
    const action = typeof input.action === 'string' ? input.action.trim() : '';
    return action.length > 0 ? `已执行了桌面操作 · ${action}` : '已执行了桌面操作';
  }
  if (n === 'look_at') return '已查看了图像';

  // ── 网络 ──
  if (n === 'webfetch') return '已抓取了网页';
  if (n === 'websearch' || n === 'google_search' || n === 'web_search') return '已搜索了网络';

  // ── 渠道（插件 / 微信 / 飞书）──
  // 这一族的工具名是英文驼峰（`PluginSendMessage` / `FeishuBitableGetRecords`），
  // 落到通用回退会把英文工具名直接展示给用户。这里按「动作 + 对象」给中文文案：
  // 同一个动作在不同渠道下各有实现，但对用户来说都是同一件事。
  if (n === 'pluginsendmessage') return '已发送了消息';
  if (n === 'pluginreplymessage') return '已回复了消息';
  if (n === 'pluginsendimage' || n === 'weixinsendimage' || n === 'feishusendimage') {
    return '已发送了图片';
  }
  if (n === 'pluginsendfile' || n === 'weixinsendfile' || n === 'feishusendfile') {
    return '已发送了文件';
  }
  if (n === 'feishuatmember') return '已提醒了群成员';
  if (n === 'feishusendurgent') return '已发送了加急提醒';
  // `PluginSummarizeGroup` 的实际返回与 `PluginGetGroupMessages` 完全相同（摘要逻辑
  // 不在这一层），文案也保持一致，避免用户以为拿到了额外的东西。
  if (
    n === 'plugingetgroupmessages' ||
    n === 'pluginsummarizegroup' ||
    n === 'plugingetcurrentchatmessages'
  ) {
    return '已读取了群消息';
  }
  if (n === 'pluginlistgroups') return '已列举了群组';
  if (n === 'feishulistchatmembers') return '已列举了群成员';
  if (n === 'feishubitablelistapps' || n === 'feishubitablelisttables') {
    return '已列举了数据表';
  }
  if (n === 'feishubitablelistfields') return '已列举了数据表字段';
  if (n === 'feishubitablegetrecords') return '已读取了数据表记录';
  if (n === 'feishubitablecreaterecords') return '已创建了数据表记录';
  if (n === 'feishubitableupdaterecords') return '已更新了数据表记录';
  if (n === 'feishubitabledeleterecords') return '已删除了数据表记录';

  // ── 管理类（会话的自查 / 自管工具）──
  // 这一族有两条会翻车的路径，都在这里一并解决：
  // 1. 名字是英文（`memory_manage` / `team_workspace_manage`…），落到通用回退会把
  //    英文工具名直接展示给用户；
  // 2. `mcp_manage_servers` / `mcp_list_tools` 以 `mcp_` 开头，会被下面的通用 MCP
  //    前缀分支吃成「调用了 MCP 工具」——可它们并不是 MCP 通道调用，而是本机的管理工具。
  // 所以整族必须在 `mcp_` 分支**之前**判定。
  const adminSubject = ADMIN_TOOL_SUBJECTS[n];
  if (adminSubject !== undefined) {
    const action = typeof input.action === 'string' ? input.action.trim().toLowerCase() : '';
    return adminActionSummary(action, adminSubject);
  }
  if (n === 'mcp_list_tools') return '已列举了 MCP 工具';
  if (n === 'models') return '已搜索了可用模型';

  // ── 折叠工具入口 ──
  // `tool_invoke` 只会在**解包失败**时到达前端（成功时网关已把它换成内层工具名），
  // 但即便那样，标题也该是中文而不是「已执行了 tool_invoke」。
  if (n === 'tool_invoke') return '调用了折叠工具';
  if (n === 'tool_search') return '已搜索了折叠工具';

  // ── Codegraph / git_bash ──
  // 这两个能力各有「内置名」与「MCP 扁平名」两条通道（`codegraph_search` 与
  // `mcp__codegraph__codegraph_search`）。用**包含**判定而不是前缀判定，让两条通道
  // 落到同一句文案上——否则内置通道显示英文名、MCP 通道显示「调用了 MCP 工具」，
  // 又是同一个能力两套观感。
  if (n.includes('codegraph_')) return codegraphSummary(n);
  if (n.includes('git_bash')) {
    return n.endsWith('__run') || n === 'git_bash_run'
      ? '已运行了 Git Bash 命令'
      : '已检测了 Git Bash 环境';
  }
  if (n === 'extract_media_info') return '已读取了媒体信息';
  if (n === 'computer_use') return '已执行了电脑操作';

  // ── MCP / Skill ──
  // 虚拟 LSP MCP 与内置 `lsp_*` 是同一批能力：必须在通用 `mcp_` 分支**之前**判定，
  // 否则 `mcp__lsp__*` 会被下面的前缀匹配统一吃掉，这条专属文案永远走不到。
  if (n.startsWith('mcp__lsp__')) return '已执行了语言服务操作';
  if (n === 'mcp_call' || n === 'mcp' || n.startsWith('mcp_')) {
    // 其余 MCP 工具统一显示为"调用了 MCP 工具"，不显示具体工具名
    return '调用了 MCP 工具';
  }
  if (n === 'skill_mcp') {
    return '执行了 MCP Skill';
  }
  if (n === 'skill') {
    const name = [input.name, input.skill, input.skillId]
      .find((value): value is string => typeof value === 'string' && value.trim().length > 0)
      ?.trim();
    const labels: Record<string, string> = {
      running: '正在加载技能',
      completed: '已加载技能',
      failed: '技能加载失败',
      cancelled: '已取消加载技能',
      paused: '等待加载技能',
      pending: '等待加载技能',
      idle: '等待加载技能',
    };
    const label = labels[options.skillStatus ?? ''] ?? '加载技能';
    return name ? `${label} ${name}` : label;
  }

  // ── 提问 ──
  if (n === 'question' || n === 'askuserquestion') {
    const questions = input.questions;
    const count = Array.isArray(questions) ? questions.length : 0;
    return count > 0 ? `已向用户提问（${count} 题）` : '已向用户提问';
  }

  // ── 待办 ──
  if (n === 'todowrite' || n === 'subtodowrite') {
    const todos = input.todos;
    const count = Array.isArray(todos) ? todos.length : 0;
    return count > 0 ? `已更新了 ${count} 个待办` : '已更新了待办列表';
  }
  if (n === 'todoread' || n === 'subtodoread') return '已读取了待办列表';

  // ── 计划模式 ──
  if (n === 'enterplanmode') return '已进入计划模式';
  if (n === 'exitplanmode') return '已退出计划模式';

  // ── 任务 ──
  if (n === 'task_create') return '已创建了任务';
  if (n === 'task_get') return '已获取了任务';
  if (n === 'task_list') return '已列举了任务';
  if (n === 'task_update') return '已更新了任务';

  // ── 会话信息 ──
  if (n === 'session_info') return '已获取了会话信息';

  // ── LSP ──
  // 会话标题 / 工作目录变更：输出是 `{ ok, ... }` 确认对象，摘要给一句动作即可。
  if (n === 'session_rename') return '已重命名了会话';
  if (n === 'session_move') return '已移动了会话';
  if (n === 'lsp_touch') return '已同步 LSP 文件状态';

  // 虚拟 LSP MCP（`mcp__lsp__*`）已在上面 MCP 分支之前处理，这里只管内置的 `lsp_*`：
  // 两者是同一批能力，摘要用同一句话。
  if (n.startsWith('lsp_')) return '已执行了语言服务操作';

  // ── 仓库 ──
  if (n === 'repo_clone') return '已克隆了仓库';
  if (n === 'repo_overview') return '已概览了仓库';

  // ── 取消后台 ──
  if (n === 'background_cancel') return '已取消了后台任务';

  // ── 批量 ──
  if (n === 'batch') {
    const raw = input.tool_calls ?? input.calls ?? input.invocations;
    const count = Array.isArray(raw) ? raw.length : 0;
    return count > 0 ? `已并行执行了 ${count} 个工具` : '已并行执行了工具';
  }

  // 通用回退
  return `已执行了 ${toolName}`;
}

/**
 * grouped pill 的分组摘要。
 *
 * `key` 可以是一个具体 toolName（如 'read' / 'bash'），也可以是
 * `resolveGroupKey()` 解析出的粗粒度分组键（如 'mcp' / 'lsp' /
 * 'session' / 'task' / 'todo' / 'web'）——分组键代表"这组调用可能
 * 混合了多个不同的具体工具名，但都归为同一类"，因此不展示任何
 * 具体工具名，只展示这一类的通用描述。
 *
 * 例："读取了 3 个文件" / "运行了 5 次命令" / "调用了 3 次 MCP 工具"
 */
export function naturalLanguageGroupSummary(key: string, count: number): string {
  const n = key.trim().toLowerCase();

  if (n === 'read') return `读取了 ${count} 个文件`;
  if (n === 'grep') return `搜索了 ${count} 次内容`;
  if (n === 'glob') return `搜索了 ${count} 次文件`;
  if (n === 'edit' || n === 'multi_edit' || n === 'multiedit') return `编辑了 ${count} 个文件`;
  if (n === 'write') return `创建了 ${count} 个文件`;
  if (n === 'bash' || n === 'interactive_bash') return `运行了 ${count} 次命令`;
  if (n === 'list') return `列举了 ${count} 个目录`;

  // 粗粒度分组键——一组里可能混合了不同的具体工具名，统一展示为
  // 该类别的通用描述，不暴露任何具体工具名。
  if (n === 'mcp') return `调用了 ${count} 次 MCP 工具`;
  if (n === 'skill') return `执行了 ${count} 次技能`;
  if (n === 'lsp') return `查询了 ${count} 次代码`;
  if (n === 'session') return `查询了 ${count} 次会话`;
  if (n === 'task') return `操作了 ${count} 次任务`;
  if (n === 'todo') return `更新了 ${count} 次待办`;
  if (n === 'web') return `访问了 ${count} 次网络`;

  return `调用了 ${count} 次工具`;
}

/**
 * 管理类工具 → 文案主语。
 *
 * 这一族的输出信封统一是 `{ ok, action, … }`（展开体由 `admin-result-view.ts` 渲染成
 * 行卡），所以摘要能按 `action` 给出「已列举了 / 已创建了 / …」的具体动作——比一句
 * 笼统的「已执行了 X」信息量大得多，也避免了把英文工具名摊给用户。
 */
const ADMIN_TOOL_SUBJECTS: Record<string, string> = {
  agent_manage: '子代理',
  mcp_manage_servers: 'MCP 服务器',
  memory_manage: '记忆',
  plugin_manage: '插件',
  schedule_manage: '定时任务',
  skill_manage: '技能',
  team_workspace_manage: '团队工作区',
};

/** 管理类动作 → 中文摘要。取值覆盖各工具 `action` schema 里的全部枚举。 */
function adminActionSummary(action: string, subject: string): string {
  // 主语以拉丁字母开头时补一个空格：「已列举了 MCP 服务器」而不是「已列举了MCP 服务器」
  // ——与「已查看了 src/a.ts」「已创建了目录 /workspace/…」同一排版惯例。
  const label = /^[A-Za-z]/.test(subject) ? ` ${subject}` : subject;

  switch (action) {
    case 'list':
      return `已列举了${label}`;
    case 'source_list':
      return `已列举了${label}来源`;
    case 'search':
      return `已搜索了${label}`;
    case 'add':
    case 'create':
      return `已创建了${label}`;
    case 'update':
      return `已更新了${label}`;
    case 'reset':
      return `已重置了${label}`;
    case 'remove':
    case 'delete':
      return `已删除了${label}`;
    case 'source_add':
      return `已添加了${label}来源`;
    case 'source_remove':
      return `已移除了${label}来源`;
    case 'enable':
      return `已启用了${label}`;
    case 'disable':
      return `已停用了${label}`;
    case 'install':
      return `已安装了${label}`;
    case 'uninstall':
      return `已卸载了${label}`;
    case 'reload':
      return `已重新加载了${label}`;
    case 'run':
      return `已运行了${label}`;
    case 'history':
      return `已读取了${label}历史`;
    default:
      // 拿不到 action（例如调用还在运行中）：给中性文案，既不猜动作、也绝不回退到英文工具名。
      return `已执行了${label}操作`;
  }
}

/**
 * Codegraph 六个工具的文案。
 *
 * 入参可能是内置名（`codegraph_search`）或 MCP 扁平名
 * （`mcp__codegraph__codegraph_search`），统一按最后一个 `codegraph_` 之后的后缀判别。
 */
function codegraphSummary(toolName: string): string {
  const marker = 'codegraph_';
  const suffix = toolName.slice(toolName.lastIndexOf(marker) + marker.length);
  switch (suffix) {
    case 'status':
      return '已查看了代码图谱状态';
    case 'index':
      return '已索引了代码图谱';
    case 'search':
      return '已搜索了代码图谱';
    case 'node':
      return '已查看了代码节点';
    case 'callers':
      return '已查找了调用方';
    case 'impact':
      return '已分析了改动影响';
    default:
      return '已查询了代码图谱';
  }
}
