/**
 * Non-Interactive Environment Detector
 *
 * Ported from oh-my-opencode's non-interactive-env hook.
 * Detects when running in a non-interactive environment (CI, pipes, TUI)
 * and makes sure git never blocks on an interactive prompt.
 * Also warns about banned interactive commands (vim, nano, less, etc.).
 *
 * In oh-my-opencode this was a tool.execute.before hook.
 * In OpenAWork it's integrated into the bash tool execution pipeline.
 *
 * **注入方式：子进程 env，而不是命令行前缀。**
 * 历史实现把 `GIT_EDITOR=true VISUAL=true ... ` 直接拼在命令字符串前面
 * （POSIX 的 `VAR=value cmd` 语法）。bash 工具在 Windows 上走
 * PowerShell（`-NoLogo -NoProfile -NonInteractive -Command`），该语法会被
 * 解析成"执行名为 `GIT_EDITOR=true` 的程序"并以 `exitCode 1` 失败，
 * 导致 Windows 上**所有** git 命令 100% 报错。
 * 现在统一改为把这些变量合进 `spawn` 的 `env`，跨平台、与 shell 语法无关。
 */

const BANNED_COMMANDS = [
  'vim',
  'vi',
  'nano',
  'emacs',
  'less',
  'more',
  'tail -f',
  'top',
  'htop',
  'watch',
  'screen',
  'tmux',
  'ssh',
  'telnet',
  'ftp',
  'mysql',
  'psql',
  'python',
  'python3',
  'node',
  'irb',
  'pry',
];

const BANNED_PATTERNS = BANNED_COMMANDS.map((cmd) => ({
  pattern: new RegExp(`\\b${cmd}\\b`),
  command: cmd,
}));

/**
 * 非交互兜底环境变量：让 git / 分页器永不阻塞等待人工输入。
 *
 * 语义上是"兜底"而非"覆盖"——调用方已显式设置的值优先（见
 * {@link withNonInteractiveEnv}），因此用户自己的 `GIT_EDITOR=code -w`
 * 不会被抹掉。
 */
const NON_INTERACTIVE_ENV_VARS: Record<string, string> = {
  GIT_EDITOR: 'true',
  VISUAL: 'true',
  EDITOR: 'true',
  GIT_PAGER: 'cat',
  PAGER: 'cat',
  GIT_TERMINAL_PROMPT: '0',
};

/** 受管的环境变量名（测试与诊断用）。 */
export const NON_INTERACTIVE_ENV_KEYS: readonly string[] = Object.keys(NON_INTERACTIVE_ENV_VARS);

/**
 * 把非交互兜底变量合进子进程 env。
 *
 * - 不修改传入对象（返回新对象）；
 * - 仅填补缺失/空值的键，保留调用方显式配置；
 * - 对 bash 工具的**全部**命令生效而非只对含 `git` 的命令——bash 工具的
 *   stdin 是 `ignore`、PowerShell 侧强制 `-NonInteractive`，任何交互式
 *   程序（编辑器、分页器）本来就无法交互，统一注入可避免"同一台机器
 *   有 TTY 时行为不同"的随机性。
 */
export function withNonInteractiveEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const merged: NodeJS.ProcessEnv = { ...base };

  for (const [key, value] of Object.entries(NON_INTERACTIVE_ENV_VARS)) {
    const current = merged[key];
    if (current === undefined || current === '') {
      merged[key] = value;
    }
  }

  return merged;
}

export interface NonInteractiveCheckResult {
  /** Whether a banned interactive command was detected */
  hasBannedCommand: boolean;
  /** The banned command name if detected */
  bannedCommand?: string;
}

/**
 * Check a bash command for interactive environment issues.
 *
 * 只做"禁用命令"检查；非交互环境变量改由 {@link withNonInteractiveEnv}
 * 在 spawn 时注入（见 `tools/bash-tools.ts`），不再改写命令字符串。
 */
export function checkNonInteractiveBash(command: string): NonInteractiveCheckResult {
  const result: NonInteractiveCheckResult = { hasBannedCommand: false };

  for (const { pattern, command: cmd } of BANNED_PATTERNS) {
    if (pattern.test(command)) {
      result.hasBannedCommand = true;
      result.bannedCommand = cmd;
      break;
    }
  }

  return result;
}

/**
 * Build a warning message for banned interactive commands.
 */
export function buildBannedCommandWarning(bannedCommand: string): string {
  return `[非交互环境警告] '${bannedCommand}' 是交互式命令，在非交互环境中可能会挂起。请使用非交互式替代方案。`;
}
