/**
 * 工具权限申请派生注册表。
 *
 * 背景：历史上所有工具的权限作用域（scope）都在 `tool-sandbox.ts` 的
 * `buildPermissionRequestContext` 巨型 switch 里集中派生，导致新增工具必须回
 * 中心文件改分支、rawInput 字段容易漂移、default 兜底退化为截断 JSON。
 *
 * 现在改为「每个工具声明自己的派生器」——本模块集中登记（注册表模式），派生器
 * 只依赖 `ToolPermissionDerivationContext`，不直接触碰 sandbox 内部状态，因此可以
 * 被单测独立驱动。
 *
 * 职责边界：本模块只负责派生 `scope / reason / riskLevel / previewAction / always`。
 * 规则求值、权限阶梯、审批落库与事件发布仍由 `tool-sandbox.ts` 的
 * `ensurePermissionForTool` 负责，本模块不参与。
 */
import { join } from 'node:path';
import { WORKSPACE_ROOT } from '../infra/db.js';
import { parseFlatMcpToolName } from '../mcp/mcp-tool-naming.js';
import { getConfiguredMcpServerForSession, getMcpServerFingerprint } from '../mcp/mcp-runtime.js';
import { parseMcpCallRawInput } from '../mcp/mcp-tool-input.js';
import { buildApplyPatchPermissionScope } from '../tools/apply-patch-tools.js';
import { buildBashApprovalPatterns, tokenizeCommand } from '../tools/bash-arity.js';
import { readToolPathInput } from '../tools/tool-path-aliases.js';
import { resolveWorkspaceReviewFilePath } from '../tools/workspace-tools.js';
import {
  assertSessionWorkingDirectory,
  getSessionWorkingDirectory,
  requiresBoundSessionWorkspace,
  rewriteUnboundPlaceholderPath,
  validateSessionWorkspacePath,
} from '../workspace/workspace-safety.js';
import type { PermissionRiskLevel } from './permission-contract.js';

/** 权限申请派生的产物；与旧 `tool-sandbox.ts` 内的同名结构逐字段一致。 */
export interface PermissionRequestContext {
  scope: string;
  reason: string;
  riskLevel: PermissionRiskLevel;
  previewAction: string;
  /** Patterns to auto-approve when user selects "always" (matches opencode ctx.ask always). */
  always: string[];
}

/** 派生器的输入。派生器不得依赖除此之外的 sandbox 状态。 */
export interface ToolPermissionDerivationContext {
  sessionId: string;
  /** 规范化后的工具名（已过 legacy / claude-code 归一）。 */
  toolName: string;
  rawInput: Record<string, unknown>;
  sshManaged: boolean;
}

/**
 * 单工具权限派生器。
 *
 * 返回 `null` 表示「本次不派生上下文」（历史上的 not-needed 语义，例如路径校验
 * 失败 / 缺少必要输入字段）——调用方会把它当作免审批处理，随后由工具自身的
 * 输入校验或执行路径给出确定性错误。不要用它来表达「拒绝」。
 */
export type ToolPermissionDeriver = (
  ctx: ToolPermissionDerivationContext,
) => PermissionRequestContext | null;

// ---------------------------------------------------------------------------
// 共享 helper（原 tool-sandbox.ts 私有函数，随派生逻辑一并下沉）
// ---------------------------------------------------------------------------

/**
 * Convert an absolute workspace path to a relative scope string.
 * Matches opencode's `path.relative(worktree, filePath)` pattern so that
 * permission rules are portable and don't depend on the host's absolute path.
 */
function toRelativeScope(absolutePath: string): string {
  if (absolutePath.startsWith(WORKSPACE_ROOT)) {
    const rel = absolutePath.slice(WORKSPACE_ROOT.length).replace(/^\//, '');
    return rel || '.';
  }
  return absolutePath;
}

/**
 * Threshold (in characters) beyond which a bash command is considered "long"
 * and should be summarised in the permission prompt instead of shown verbatim.
 */
const BASH_COMMAND_SUMMARY_THRESHOLD = 120;

/**
 * Produce a human-friendly summary of a bash command for use in the permission
 * prompt's `previewAction` field.
 *
 * The `scope` field is kept as the full original command (needed for correct
 * permission matching on the gateway side), but `previewAction` only shows a
 * summary so the permission popup stays compact.
 */
function summarizeBashCommand(command: string): string {
  const trimmed = command.trim();
  const lines = trimmed.split('\n');

  if (lines.length <= 1 && trimmed.length <= BASH_COMMAND_SUMMARY_THRESHOLD) {
    return trimmed;
  }

  const firstLine = (lines[0] ?? '').trim();
  const firstLineClipped =
    firstLine.length > BASH_COMMAND_SUMMARY_THRESHOLD
      ? `${firstLine.slice(0, BASH_COMMAND_SUMMARY_THRESHOLD)}…`
      : firstLine;

  if (lines.length > 1) {
    return `${firstLineClipped} …(共 ${lines.length} 行)`;
  }

  return `${firstLineClipped}…`;
}

function parseReadOnlyGitBashCatCommand(command: string): string | null {
  if (/[;&|<>`$()]/.test(command)) {
    return null;
  }
  const tokens = tokenizeCommand(command.trim());
  if (tokens.length === 2 && tokens[0] === 'cat') {
    return tokens[1] ?? null;
  }
  if (tokens.length === 3 && tokens[0] === 'cat' && tokens[1] === '--') {
    return tokens[2] ?? null;
  }
  return null;
}

function isAutoAllowedGitBashRead(input: {
  rawInput: Record<string, unknown>;
  sessionId: string;
}): boolean {
  const command = typeof input.rawInput.command === 'string' ? input.rawInput.command.trim() : '';
  const filePath = command ? parseReadOnlyGitBashCatCommand(command) : null;
  if (!filePath) {
    return false;
  }
  return validateSessionWorkspacePath({
    path: rewriteUnboundPlaceholderPath(input.sessionId, filePath),
    sessionId: input.sessionId,
  }).ok;
}

/**
 * 文件类工具（write / edit / multi_edit）的权限作用域构造。
 *
 * 本地路径校验失败时：若会话运行在 SSH 远程模式，则用远端路径原文作为作用域，
 * 保证远端编辑同样受可配置的 'ask' 规则管辖；否则返回 null（与既有行为一致 ——
 * 无有效路径时不要求审批）。
 */
function buildFileToolPermissionContext(input: {
  sessionId: string;
  pathValue: string | undefined;
  sshManaged: boolean;
  reason: string;
  remoteReason: string;
  previewVerb: string;
}): PermissionRequestContext | null {
  const effectivePath = input.pathValue
    ? rewriteUnboundPlaceholderPath(input.sessionId, input.pathValue)
    : null;
  const validation = effectivePath
    ? validateSessionWorkspacePath({ path: effectivePath, sessionId: input.sessionId })
    : null;
  const safePath = validation?.ok ? validation.safePath : null;

  if (!safePath) {
    const remotePath = input.pathValue?.trim();
    if (input.sshManaged && remotePath && remotePath.length > 0) {
      return {
        scope: remotePath,
        reason: input.remoteReason,
        riskLevel: 'medium',
        previewAction: `${input.previewVerb} SSH 远端 ${remotePath}`,
        always: ['*'],
      };
    }
    return null;
  }

  return {
    scope: toRelativeScope(safePath),
    reason: input.reason,
    riskLevel: 'medium',
    previewAction: `${input.previewVerb} ${safePath}`,
    always: ['*'],
  };
}

// ---------------------------------------------------------------------------
// 逐工具派生器
// ---------------------------------------------------------------------------

function flatMcpPermissionDeriver(
  ctx: ToolPermissionDerivationContext,
): PermissionRequestContext | null {
  // Flat MCP tools (PR-C): `mcp__<serverId>__<toolName>` is dynamic and
  // cannot be matched by the static table below, so we intercept it up
  // front. The permission scope mirrors the legacy `mcp_call` path
  // (`serverId:toolName:fingerprint`) so users who already granted
  // "always allow serverId:*" in the legacy UI don't see a second
  // prompt after the flattening rollout.
  const flatMcp = parseFlatMcpToolName(ctx.toolName);
  if (!flatMcp) {
    return null;
  }
  if (
    flatMcp.serverId === 'git_bash' &&
    flatMcp.toolName === 'run' &&
    isAutoAllowedGitBashRead({ rawInput: ctx.rawInput, sessionId: ctx.sessionId })
  ) {
    return null;
  }
  try {
    const server = getConfiguredMcpServerForSession(ctx.sessionId, flatMcp.serverId);
    const serverFingerprint = getMcpServerFingerprint(server);
    const previewArguments = JSON.stringify(ctx.rawInput).slice(0, 240);
    return {
      scope: `${flatMcp.serverId}:${flatMcp.toolName}:${serverFingerprint}`,
      reason: '需要调用 MCP 工具',
      riskLevel: 'high',
      previewAction: `调用 ${flatMcp.serverId}/${flatMcp.toolName} ${previewArguments}`,
      always: [`${flatMcp.serverId}:${flatMcp.toolName}:*`, `${flatMcp.serverId}:*`],
    };
  } catch {
    // If the server is no longer configured (user removed it mid-turn),
    // fall through to the generic permission prompt so the LLM gets a
    // deterministic error rather than a silent null.
    return null;
  }
}

const writePermissionDeriver: ToolPermissionDeriver = (ctx) =>
  buildFileToolPermissionContext({
    sessionId: ctx.sessionId,
    pathValue: readToolPathInput(ctx.rawInput),
    sshManaged: ctx.sshManaged,
    reason: '需要写入工作区文件',
    remoteReason: '需要写入 SSH 远端文件',
    previewVerb: '写入',
  });

const editPermissionDeriver: ToolPermissionDeriver = (ctx) =>
  buildFileToolPermissionContext({
    sessionId: ctx.sessionId,
    pathValue: readToolPathInput(ctx.rawInput),
    sshManaged: ctx.sshManaged,
    reason: '需要编辑工作区文件',
    remoteReason: '需要编辑 SSH 远端文件',
    previewVerb: '编辑',
  });

const multiEditPermissionDeriver: ToolPermissionDeriver = (ctx) =>
  buildFileToolPermissionContext({
    sessionId: ctx.sessionId,
    pathValue: readToolPathInput(ctx.rawInput),
    sshManaged: ctx.sshManaged,
    reason: '需要批量编辑工作区文件',
    remoteReason: '需要批量编辑 SSH 远端文件',
    previewVerb: '批量编辑',
  });

const taskCreatePermissionDeriver: ToolPermissionDeriver = (ctx) => {
  const subject = typeof ctx.rawInput.subject === 'string' ? ctx.rawInput.subject.trim() : '';
  return {
    scope: subject ? `task:${subject}` : 'task:*',
    reason: '需要创建子任务',
    riskLevel: 'medium',
    previewAction: subject ? `创建子任务: ${subject}` : '创建子任务',
    always: ['*'],
  };
};

const taskUpdatePermissionDeriver: ToolPermissionDeriver = (ctx) => {
  const id = typeof ctx.rawInput.id === 'string' ? ctx.rawInput.id.trim() : '';
  return {
    scope: id ? `task:${id}` : 'task:*',
    reason: '需要更新子任务',
    riskLevel: 'low',
    previewAction: id ? `更新子任务 ${id}` : '更新子任务',
    always: ['*'],
  };
};

const callOmoAgentPermissionDeriver: ToolPermissionDeriver = (ctx) => {
  const agentDesc =
    typeof ctx.rawInput.description === 'string' ? ctx.rawInput.description.trim() : '';
  return {
    scope: agentDesc ? `agent:${agentDesc}` : 'agent:*',
    reason: '需要调用子 Agent',
    riskLevel: 'high',
    previewAction: agentDesc ? `调用子 Agent: ${agentDesc}` : '调用子 Agent',
    always: ['*'],
  };
};

const channelSendPermissionDeriver: ToolPermissionDeriver = (ctx) => {
  const pluginId = typeof ctx.rawInput.plugin_id === 'string' ? ctx.rawInput.plugin_id.trim() : '';
  const chatId = typeof ctx.rawInput.chat_id === 'string' ? ctx.rawInput.chat_id.trim() : '';
  return {
    scope: `channel:${pluginId || '*'}:${chatId || '*'}:send`,
    reason: '需要向消息渠道发送内容',
    riskLevel: 'high',
    previewAction: `向消息渠道发送 ${ctx.toolName}`,
    always: ['*'],
  };
};

const channelReplyPermissionDeriver: ToolPermissionDeriver = (ctx) => {
  const pluginId = typeof ctx.rawInput.plugin_id === 'string' ? ctx.rawInput.plugin_id.trim() : '';
  const messageId =
    typeof ctx.rawInput.message_id === 'string' ? ctx.rawInput.message_id.trim() : '';
  return {
    scope: `channel:${pluginId || '*'}:reply:${messageId || '*'}`,
    reason: '需要回复消息渠道中的指定消息',
    riskLevel: 'high',
    previewAction: `回复消息渠道消息 ${messageId || '*'}`,
    always: ['*'],
  };
};

const channelReadPermissionDeriver: ToolPermissionDeriver = (ctx) => {
  const pluginId = typeof ctx.rawInput.plugin_id === 'string' ? ctx.rawInput.plugin_id.trim() : '';
  const chatId = typeof ctx.rawInput.chat_id === 'string' ? ctx.rawInput.chat_id.trim() : '';
  return {
    scope: `channel:${pluginId || '*'}:${chatId || '*'}:read`,
    reason: '需要读取消息渠道会话信息',
    riskLevel: 'medium',
    previewAction: `读取消息渠道 ${ctx.toolName}`,
    always: ['*'],
  };
};

const skillPermissionDeriver: ToolPermissionDeriver = (ctx) => {
  const name = typeof ctx.rawInput.name === 'string' ? ctx.rawInput.name.trim() : '';
  if (!name) return null;
  return {
    scope: name,
    reason: '需要加载技能内容并注入会话上下文',
    riskLevel: 'medium',
    previewAction: `加载技能 ${name}`,
    always: [name],
  };
};

const skillMcpPermissionDeriver: ToolPermissionDeriver = (ctx) => {
  const mcpName = typeof ctx.rawInput.mcp_name === 'string' ? ctx.rawInput.mcp_name.trim() : '';
  const operation =
    typeof ctx.rawInput.tool_name === 'string'
      ? ctx.rawInput.tool_name.trim()
      : typeof ctx.rawInput.resource_name === 'string'
        ? ctx.rawInput.resource_name.trim()
        : typeof ctx.rawInput.prompt_name === 'string'
          ? ctx.rawInput.prompt_name.trim()
          : '';
  if (!mcpName || !operation) return null;
  return {
    scope: `${mcpName}:${operation}`,
    reason: '需要调用技能内嵌的 MCP 能力',
    riskLevel: 'high',
    previewAction: `调用 skill MCP ${mcpName}/${operation}`,
    always: ['*'],
  };
};

/**
 * bash 类工具的公共派生：命令即作用域，always 为 arity 通配模式。
 *
 * 同时用于前台 `bash`、交互式 `interactive_bash` 与后台
 * `run_bash_in_background`（三者都执行任意 shell，权限语义必须一致）。
 */
function buildBashLikePermissionContext(input: {
  ctx: ToolPermissionDerivationContext;
  command: string;
  reason: string;
  previewPrefix: string;
}): PermissionRequestContext | null {
  const { ctx, command, reason, previewPrefix } = input;
  const sessionWorkingDirectory = getSessionWorkingDirectory(ctx.sessionId);
  if (!sessionWorkingDirectory && requiresBoundSessionWorkspace(ctx.sessionId)) return null;
  // 未绑定：回退桌面端默认目录；已绑定：只用会话路径。禁止静默落到盘符根。
  const rawWorkdir =
    typeof ctx.rawInput.workdir === 'string'
      ? ctx.rawInput.workdir
      : (sessionWorkingDirectory ?? assertSessionWorkingDirectory(ctx.sessionId));
  const workdirValue = rewriteUnboundPlaceholderPath(ctx.sessionId, rawWorkdir);
  const validation = validateSessionWorkspacePath({ path: workdirValue, sessionId: ctx.sessionId });
  const safeWorkdir = validation.ok ? validation.safePath : null;
  if (!command || !safeWorkdir) return null;
  return {
    scope: command,
    reason,
    riskLevel: 'high',
    previewAction: `${previewPrefix}: ${summarizeBashCommand(command)}`,
    always: buildBashApprovalPatterns(command),
  };
}

const bashPermissionDeriver: ToolPermissionDeriver = (ctx) =>
  buildBashLikePermissionContext({
    ctx,
    command: typeof ctx.rawInput.command === 'string' ? ctx.rawInput.command.trim() : '',
    reason: '需要执行工作区命令',
    previewPrefix: '执行命令',
  });

const interactiveBashPermissionDeriver: ToolPermissionDeriver = (ctx) =>
  buildBashLikePermissionContext({
    ctx,
    command: typeof ctx.rawInput.tmux_command === 'string' ? ctx.rawInput.tmux_command.trim() : '',
    reason: '需要执行 tmux 交互式命令',
    previewPrefix: '执行 tmux 命令',
  });

const runBashInBackgroundPermissionDeriver: ToolPermissionDeriver = (ctx) =>
  buildBashLikePermissionContext({
    ctx,
    command: typeof ctx.rawInput.command === 'string' ? ctx.rawInput.command.trim() : '',
    reason: '需要在后台执行工作区命令',
    previewPrefix: '后台执行命令',
  });

const bashOutputPermissionDeriver: ToolPermissionDeriver = (ctx) => {
  const terminalId =
    typeof ctx.rawInput.terminal_id === 'string' ? ctx.rawInput.terminal_id.trim() : '';
  return {
    scope: terminalId || 'terminal:*',
    reason: '需要读取后台命令输出',
    riskLevel: 'low',
    previewAction: terminalId ? `读取后台命令输出 ${terminalId}` : '读取后台命令输出',
    always: ['*'],
  };
};

const bashKillPermissionDeriver: ToolPermissionDeriver = (ctx) => {
  const terminalId =
    typeof ctx.rawInput.terminal_id === 'string' ? ctx.rawInput.terminal_id.trim() : '';
  return {
    scope: terminalId || 'terminal:*',
    reason: '需要终止后台命令',
    riskLevel: 'medium',
    previewAction: terminalId ? `终止后台命令 ${terminalId}` : '终止后台命令',
    always: ['*'],
  };
};

const astGrepReplacePermissionDeriver: ToolPermissionDeriver = (ctx) => {
  if (!getSessionWorkingDirectory(ctx.sessionId) && requiresBoundSessionWorkspace(ctx.sessionId)) {
    return null;
  }
  const pattern = typeof ctx.rawInput.pattern === 'string' ? ctx.rawInput.pattern.trim() : '';
  const lang = typeof ctx.rawInput.lang === 'string' ? ctx.rawInput.lang.trim() : '';
  if (!pattern) return null;
  return {
    scope: `ast:${lang}:${pattern}`.slice(0, 200),
    reason: '需要执行 AST 级代码重写',
    riskLevel: 'high',
    previewAction: `AST 替换 ${lang} "${pattern}"`,
    always: ['*'],
  };
};

const applyPatchPermissionDeriver: ToolPermissionDeriver = (ctx) => {
  if (!getSessionWorkingDirectory(ctx.sessionId) && requiresBoundSessionWorkspace(ctx.sessionId)) {
    return null;
  }
  const patchText = typeof ctx.rawInput.patchText === 'string' ? ctx.rawInput.patchText : '';
  if (!patchText.trim()) return null;
  return {
    scope: buildApplyPatchPermissionScope(patchText),
    reason: '需要批量修改工作区文件',
    riskLevel: 'high',
    previewAction: '应用结构化补丁到工作区文件',
    always: ['*'],
  };
};

const taskPermissionDeriver: ToolPermissionDeriver = (ctx) => {
  const description =
    typeof ctx.rawInput.description === 'string' ? ctx.rawInput.description.trim() : '';
  if (!description) return null;
  return {
    scope: `task:${description}`,
    reason: '需要创建子任务和子会话',
    riskLevel: 'high',
    previewAction: `创建子任务 ${description}`,
    always: ['*'],
  };
};

const workspaceCreateDirectoryPermissionDeriver: ToolPermissionDeriver = (ctx) => {
  const pathValue = readToolPathInput(ctx.rawInput);
  const effectivePath = pathValue ? rewriteUnboundPlaceholderPath(ctx.sessionId, pathValue) : null;
  const validation = effectivePath
    ? validateSessionWorkspacePath({ path: effectivePath, sessionId: ctx.sessionId })
    : null;
  const safePath = validation?.ok ? validation.safePath : null;
  if (!safePath) return null;
  return {
    scope: toRelativeScope(safePath),
    reason: '需要在工作区中新建目录',
    riskLevel: 'medium',
    previewAction: `创建目录 ${safePath}`,
    always: ['*'],
  };
};

const workspaceReviewRevertPermissionDeriver: ToolPermissionDeriver = (ctx) => {
  const pathValue = readToolPathInput(ctx.rawInput);
  const effectivePath = pathValue ? rewriteUnboundPlaceholderPath(ctx.sessionId, pathValue) : null;
  const validation = effectivePath
    ? validateSessionWorkspacePath({ path: effectivePath, sessionId: ctx.sessionId })
    : null;
  const safeWorkspacePath = validation?.ok ? validation.safePath : null;
  const filePath = typeof ctx.rawInput.filePath === 'string' ? ctx.rawInput.filePath : null;
  if (!safeWorkspacePath || !filePath) return null;
  const relativeFilePath = resolveWorkspaceReviewFilePath(safeWorkspacePath, filePath);
  const absoluteFilePath = join(safeWorkspacePath, relativeFilePath);
  return {
    scope: toRelativeScope(absoluteFilePath),
    reason: '需要回滚工作区文件改动',
    riskLevel: 'high',
    previewAction: `回滚 ${absoluteFilePath}`,
    always: ['*'],
  };
};

const lspRenamePermissionDeriver: ToolPermissionDeriver = (ctx) => {
  if (!getSessionWorkingDirectory(ctx.sessionId) && requiresBoundSessionWorkspace(ctx.sessionId)) {
    return null;
  }
  const pathValue = readToolPathInput(ctx.rawInput);
  const effectivePath = pathValue ? rewriteUnboundPlaceholderPath(ctx.sessionId, pathValue) : null;
  const validation = effectivePath
    ? validateSessionWorkspacePath({ path: effectivePath, sessionId: ctx.sessionId })
    : null;
  const safePath = validation?.ok ? validation.safePath : null;
  const newName = typeof ctx.rawInput.newName === 'string' ? ctx.rawInput.newName.trim() : '';
  if (!safePath || !newName) return null;
  return {
    scope: `${toRelativeScope(safePath)}:${newName}`,
    reason: '需要通过 LSP 跨文件重命名符号',
    riskLevel: 'high',
    previewAction: `LSP 重命名 ${safePath} → ${newName}`,
    always: ['*'],
  };
};

const mcpCallPermissionDeriver: ToolPermissionDeriver = (ctx) => {
  const parsed = parseMcpCallRawInput(ctx.rawInput);
  if (!parsed.ok) {
    return null;
  }
  try {
    const server = getConfiguredMcpServerForSession(ctx.sessionId, parsed.serverId);
    const serverFingerprint = getMcpServerFingerprint(server);
    const previewArguments = JSON.stringify(parsed.arguments).slice(0, 240);
    return {
      scope: `${parsed.serverId}:${parsed.toolName}:${serverFingerprint}`,
      reason: '需要调用 MCP 工具',
      riskLevel: 'high',
      previewAction: `调用 ${parsed.serverId}/${parsed.toolName} ${previewArguments}`,
      always: [`${parsed.serverId}:${parsed.toolName}:*`, `${parsed.serverId}:*`],
    };
  } catch {
    // 服务器已不再配置（用户在本轮中途删除 / 禁用）时返回 null，与 flat-MCP 分支
    // 保持一致：这是有意为之，不是漏判——无法运行的工具不该弹审批框（yolo / 后台
    // team 会话也无人可批），后续执行路径会重新解析服务器并给出确定性错误，比在
    // 权限阶段抛异常更可靠。
    return null;
  }
};

const desktopAutomationPermissionDeriver: ToolPermissionDeriver = (ctx) => {
  const action =
    typeof ctx.rawInput.action === 'string' ? ctx.rawInput.action.trim().toLowerCase() : '';
  if (!action) {
    return null;
  }
  const target =
    typeof ctx.rawInput.url === 'string'
      ? ctx.rawInput.url.trim()
      : typeof ctx.rawInput.selector === 'string'
        ? ctx.rawInput.selector.trim()
        : '';
  return {
    scope: target ? `${action}:${target}` : action,
    reason: '需要操作桌面 sidecar 的浏览器自动化能力',
    riskLevel: 'high',
    previewAction: target ? `桌面自动化 ${action}: ${target}` : `桌面自动化 ${action}`,
    always: ['*'],
  };
};

const desktopControlPermissionDeriver: ToolPermissionDeriver = (ctx) => {
  const action =
    typeof ctx.rawInput.action === 'string' ? ctx.rawInput.action.trim().toLowerCase() : '';
  if (!action) {
    return null;
  }
  const target =
    typeof ctx.rawInput.x === 'number' && typeof ctx.rawInput.y === 'number'
      ? `${ctx.rawInput.x},${ctx.rawInput.y}`
      : typeof ctx.rawInput.key === 'string'
        ? ctx.rawInput.key.trim()
        : Array.isArray(ctx.rawInput.keys)
          ? ctx.rawInput.keys.join('+')
          : '';
  return {
    scope: target ? `${action}:${target}` : action,
    reason: '需要控制本机系统桌面',
    riskLevel: 'high',
    previewAction: target ? `系统桌面控制 ${action}: ${target}` : `系统桌面控制 ${action}`,
    always: ['*'],
  };
};

/**
 * 未登记工具的兜底派生：保持历史行为，永远走 ask（而不是静默放行）。
 *
 * 注意：工具是否需要审批由 `ensurePermissionForTool` 的规则引擎决定，本兜底只
 * 提供「一旦需要审批时展示什么」。历史上未映射工具会在类别层落到 `custom`（ask），
 * 因此这里不会成为绕过审批的通道。
 */
function defaultPermissionDeriver(ctx: ToolPermissionDerivationContext): PermissionRequestContext {
  const genericScope = `${ctx.toolName}:${JSON.stringify(ctx.rawInput).slice(0, 200)}`;
  return {
    scope: genericScope,
    reason: `需要执行工具 "${ctx.toolName}"`,
    riskLevel: 'medium',
    previewAction: `执行 ${ctx.toolName}`,
    always: ['*'],
  };
}

/** 渠道发送类工具（渠道 + 飞书 / 微信 + plugin 系列）。 */
const CHANNEL_SEND_TOOL_NAMES = [
  'PluginSendMessage',
  'PluginSendImage',
  'WeixinSendImage',
  'WeixinSendFile',
  'FeishuSendImage',
  'FeishuSendFile',
  'FeishuAtMember',
  'FeishuSendUrgent',
  'FeishuBitableCreateRecords',
  'FeishuBitableUpdateRecords',
  'FeishuBitableDeleteRecords',
] as const;

/** 渠道读取类工具。 */
const CHANNEL_READ_TOOL_NAMES = [
  'PluginGetGroupMessages',
  'PluginListGroups',
  'PluginSummarizeGroup',
  'PluginGetCurrentChatMessages',
  'FeishuListChatMembers',
  'FeishuBitableListApps',
  'FeishuBitableListTables',
  'FeishuBitableListFields',
  'FeishuBitableGetRecords',
] as const;

const TOOL_PERMISSION_DERIVERS: Readonly<Record<string, ToolPermissionDeriver>> = {
  write: writePermissionDeriver,
  edit: editPermissionDeriver,
  multi_edit: multiEditPermissionDeriver,
  task_create: taskCreatePermissionDeriver,
  task_update: taskUpdatePermissionDeriver,
  call_omo_agent: callOmoAgentPermissionDeriver,
  PluginReplyMessage: channelReplyPermissionDeriver,
  ...Object.fromEntries(
    CHANNEL_SEND_TOOL_NAMES.map((name) => [name, channelSendPermissionDeriver]),
  ),
  ...Object.fromEntries(
    CHANNEL_READ_TOOL_NAMES.map((name) => [name, channelReadPermissionDeriver]),
  ),
  skill: skillPermissionDeriver,
  skill_mcp: skillMcpPermissionDeriver,
  bash: bashPermissionDeriver,
  interactive_bash: interactiveBashPermissionDeriver,
  run_bash_in_background: runBashInBackgroundPermissionDeriver,
  bash_output: bashOutputPermissionDeriver,
  bash_kill: bashKillPermissionDeriver,
  ast_grep_replace: astGrepReplacePermissionDeriver,
  apply_patch: applyPatchPermissionDeriver,
  task: taskPermissionDeriver,
  workspace_create_directory: workspaceCreateDirectoryPermissionDeriver,
  workspace_review_revert: workspaceReviewRevertPermissionDeriver,
  lsp_rename: lspRenamePermissionDeriver,
  mcp_call: mcpCallPermissionDeriver,
  desktop_automation: desktopAutomationPermissionDeriver,
  desktop_control: desktopControlPermissionDeriver,
};

/**
 * 权限上下文派生的唯一入口。
 *
 * 顺序与历史实现保持一致：flat MCP 优先拦截（动态工具名无法查表），随后按工具名
 * 查注册表，未登记则走 default 兜底。
 */
export function buildToolPermissionRequestContext(
  ctx: ToolPermissionDerivationContext,
): PermissionRequestContext | null {
  if (parseFlatMcpToolName(ctx.toolName)) {
    return flatMcpPermissionDeriver(ctx);
  }
  const deriver = TOOL_PERMISSION_DERIVERS[ctx.toolName];
  return deriver ? deriver(ctx) : defaultPermissionDeriver(ctx);
}

/** 供测试与诊断使用：列出已登记派生器的工具名。 */
export function listToolPermissionDeriverNames(): string[] {
  return Object.keys(TOOL_PERMISSION_DERIVERS);
}
