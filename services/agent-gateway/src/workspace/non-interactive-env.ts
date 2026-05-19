/**
 * Non-Interactive Environment Detector
 *
 * Ported from oh-my-opencode's non-interactive-env hook.
 * Detects when running in a non-interactive environment (CI, pipes, TUI)
 * and prepends environment variables to git commands to prevent interactive prompts.
 * Also warns about banned interactive commands (vim, nano, less, etc.).
 *
 * In oh-my-opencode this was a tool.execute.before hook.
 * In OpenAWork it's integrated into the bash tool execution pipeline.
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

const NON_INTERACTIVE_ENV_VARS = [
  'GIT_EDITOR=true',
  'VISUAL=true',
  'EDITOR=true',
  'GIT_PAGER=cat',
  'PAGER=cat',
  'GIT_TERMINAL_PROMPT=0',
];

const ENV_PREFIX = NON_INTERACTIVE_ENV_VARS.join(' ');

/**
 * Detect if current environment is non-interactive.
 */
export function isNonInteractive(): boolean {
  if (!process.stdout.isTTY) return true;
  if (process.env.CI === 'true') return true;
  if (process.env.TERM === 'dumb') return true;
  return false;
}

export interface NonInteractiveCheckResult {
  /** Whether a banned interactive command was detected */
  hasBannedCommand: boolean;
  /** The banned command name if detected */
  bannedCommand?: string;
  /** Modified command with non-interactive env prefix (for git commands) */
  modifiedCommand?: string;
}

/**
 * Check a bash command for interactive environment issues.
 * Returns warnings and optionally modified command.
 */
export function checkNonInteractiveBash(command: string): NonInteractiveCheckResult {
  const result: NonInteractiveCheckResult = { hasBannedCommand: false };

  // Check for banned commands
  for (const { pattern, command: cmd } of BANNED_PATTERNS) {
    if (pattern.test(command)) {
      result.hasBannedCommand = true;
      result.bannedCommand = cmd;
      break;
    }
  }

  // Prepend env vars for git commands in non-interactive environments
  if (isNonInteractive() && /\bgit\b/.test(command)) {
    result.modifiedCommand = `${ENV_PREFIX} ${command}`;
  }

  return result;
}

/**
 * Build a warning message for banned interactive commands.
 */
export function buildBannedCommandWarning(bannedCommand: string): string {
  return `[非交互环境警告] '${bannedCommand}' 是交互式命令，在非交互环境中可能会挂起。请使用非交互式替代方案。`;
}
