/**
 * 将工具调用转换为自然语言过去式摘要（不含具体路径/命令/模式）。
 * 用于折叠态的简洁展示，与截图参考风格一致。
 *
 * 规则：动词短语 + 可选数量（当数量提供信息时）
 * 例：已编辑了文件 / 已运行了命令 / 已查看 4 个文件 / 已调用 MCP 工具
 */

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

export function naturalLanguageSummary(
  toolName: string,
  input: Record<string, unknown>,
  output?: unknown,
): string {
  const n = toolName.trim().toLowerCase();

  // ── 文件读取 ──
  if (n === 'read') return '已查看了文件';
  if (n === 'list') return '已列举了目录';
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
  if (n === 'workspace_create_directory') return '已创建了目录';
  if (n === 'workspace_review_revert') return '已还原了文件';

  // ── Shell 执行 ──
  if (n === 'bash' || n === 'interactive_bash') return '已运行了命令';
  if (n === 'background_output') {
    // 读的是哪一个后台任务、读到的是什么状态（解析不到时保持旧文案）。
    const { label, state } = resolveBackgroundTaskReadInfo(output);
    const base = label ? `已读取了后台输出 · ${label}` : '已读取了后台输出';
    return state ? `${base}（${state}）` : base;
  }
  if (n === 'background_cancel') return '已取消了后台任务';
  if (n === 'desktop_automation') return '已执行了桌面操作';
  if (n === 'look_at') return '已查看了图像';

  // ── 网络 ──
  if (n === 'webfetch') return '已抓取了网页';
  if (n === 'websearch' || n === 'google_search') return '已搜索了网络';

  // ── MCP / Skill ──
  if (n === 'mcp_call' || n === 'mcp' || n.startsWith('mcp_')) {
    // 所有 MCP 工具统一显示为"调用了 MCP 工具"，不显示具体工具名
    return '调用了 MCP 工具';
  }
  if (n === 'skill_mcp') {
    return '执行了 MCP Skill';
  }
  if (n === 'skill') {
    const skillId = typeof input.skillId === 'string' ? input.skillId.trim() : '';
    return skillId ? `执行了 ${skillId}` : '执行了技能';
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
