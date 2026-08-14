import { tmpdir } from 'node:os';
import { join as nativeJoin } from 'node:path';
import { join as posixJoin } from 'node:path/posix';
import { getPlatform } from '../platform.js';
import type {
  ShellCommandResult,
  ShellExecOptions,
  ShellProvider,
} from './shell-provider.js';

/**
 * 引号转义工具函数
 */
function quote(args: string[]): string {
  return args.map((arg) => `'${arg.replace(/'/g, "'\\''")}'`).join(' ');
}

/**
 * Windows 路径转 POSIX 路径 (Git Bash 需要)
 * C:\Users\... -> /c/Users/...
 */
function windowsPathToPosixPath(windowsPath: string): string {
  // 处理 UNC 路径 \\server\share -> //server/share
  if (windowsPath.startsWith('\\\\')) {
    return '//' + windowsPath.slice(2).replace(/\\/g, '/');
  }

  // 处理盘符路径 C:\... -> /c/...
  const driveMatch = windowsPath.match(/^([A-Za-z]):[/\\]/);
  if (driveMatch?.[1]) {
    const drive = driveMatch[1].toLowerCase();
    const rest = windowsPath.slice(3).replace(/\\/g, '/');
    return `/${drive}/${rest}`;
  }

  // 相对路径或其他格式，直接转换反斜杠
  return windowsPath.replace(/\\/g, '/');
}

/**
 * 修正 Windows CMD 风格的空设备重定向
 * 2>nul -> 2>/dev/null
 */
function rewriteWindowsNullRedirect(command: string): string {
  // 匹配 >nul 或 2>nul，但不匹配 >null（可能是真实文件名）
  return command.replace(/(\d?>)nul\b/gi, '$1/dev/null');
}

/**
 * 判断命令是否需要添加 stdin 重定向
 * 避免子进程等待标准输入导致挂起
 */
function shouldAddStdinRedirect(command: string): boolean {
  // 如果命令已经有 stdin 重定向，不需要添加
  if (/<\s*\/dev\/null/.test(command) || /<\s*&-/.test(command)) {
    return false;
  }

  // 交互式命令不应该自动重定向
  const interactiveCommands = ['vim', 'nano', 'emacs', 'less', 'more', 'top', 'htop'];
  const firstCommand = command.trim().split(/[|\s]/)[0];
  if (firstCommand && interactiveCommands.includes(firstCommand)) {
    return false;
  }

  return true;
}

/**
 * 对命令进行引号转义，支持 stdin 重定向
 */
function quoteShellCommand(command: string, addStdinRedirect: boolean): string {
  const stdinRedirect = addStdinRedirect ? ' < /dev/null' : '';
  // 使用单引号包裹命令，内部的单引号转义为 '\''
  return `'${command.replace(/'/g, "'\\''")}'${stdinRedirect}`;
}

/**
 * 获取禁用 extglob 的命令
 * 防止通配符安全问题
 */
function getDisableExtglobCommand(shellPath: string): string | null {
  if (shellPath.includes('bash')) {
    return 'shopt -u extglob 2>/dev/null || true';
  } else if (shellPath.includes('zsh')) {
    return 'setopt NO_EXTENDED_GLOB 2>/dev/null || true';
  }
  return null;
}

/**
 * 创建 Bash Shell Provider
 *
 * 支持 bash 和 zsh，自动处理跨平台路径差异
 */
export function createBashShellProvider(shellPath: string): ShellProvider {
  return {
    type: 'bash',
    shellPath,
    detached: true,

    async buildExecCommand(
      command: string,
      options: ShellExecOptions,
    ): Promise<ShellCommandResult> {
      const isWindows = getPlatform() === 'windows';
      const osTmpdir = tmpdir();
      const shellTmpdir = isWindows ? windowsPathToPosixPath(osTmpdir) : osTmpdir;

      // CWD 跟踪文件路径
      // shellCwdFilePath: POSIX 路径，给 bash 内部的 pwd 命令使用
      // cwdFilePath: 原生路径，给 Node.js 的 readFileSync/unlinkSync 使用
      const shellCwdFilePath = options.useSandbox
        ? posixJoin(options.sandboxTmpDir!, `cwd-${options.id}`)
        : posixJoin(shellTmpdir, `openawork-${options.id}-cwd`);

      const cwdFilePath = options.useSandbox
        ? posixJoin(options.sandboxTmpDir!, `cwd-${options.id}`)
        : nativeJoin(osTmpdir, `openawork-${options.id}-cwd`);

      // 修正 Windows 风格的重定向
      const normalizedCommand = rewriteWindowsNullRedirect(command);
      const needsStdinRedirect = shouldAddStdinRedirect(normalizedCommand);
      const quotedCommand = quoteShellCommand(normalizedCommand, needsStdinRedirect);

      const commandParts: string[] = [];

      // 禁用 extglob 防止通配符注入
      const disableExtglobCmd = getDisableExtglobCommand(shellPath);
      if (disableExtglobCmd) {
        commandParts.push(disableExtglobCmd);
      }

      // 执行用户命令
      // 使用 eval 确保别名和函数能正确展开
      commandParts.push(`eval ${quotedCommand}`);

      // 使用 pwd -P 获取物理路径（解析符号链接）
      commandParts.push(`pwd -P >| ${quote([shellCwdFilePath])}`);

      const commandString = commandParts.join(' && ');

      return { commandString, cwdFilePath };
    },

    getSpawnArgs(commandString: string): string[] {
      // -c: 执行命令字符串
      // -l: 作为登录 shell 启动（加载用户配置）
      return ['-c', '-l', commandString];
    },

    async getEnvironmentOverrides(_command: string): Promise<Record<string, string>> {
      const env: Record<string, string> = {};

      // 设置 SHELL 环境变量
      env.SHELL = this.shellPath;

      // 标记这是 OpenAWork 启动的进程
      env.OPENAWORK = '1';

      return env;
    },
  };
}
