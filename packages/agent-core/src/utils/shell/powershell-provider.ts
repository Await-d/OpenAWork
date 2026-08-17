import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { join as posixJoin } from 'node:path/posix';
import type { ShellCommandResult, ShellExecOptions, ShellProvider } from './shell-provider.js';

/**
 * PowerShell 启动参数构建
 * -NoProfile: 不加载用户配置文件（更快、更一致）
 * -NonInteractive: 非交互模式，不提示用户输入
 * -Command: 执行命令
 */
export function buildPowerShellArgs(cmd: string): string[] {
  return ['-NoProfile', '-NonInteractive', '-Command', cmd];
}

/**
 * Base64 编码命令为 UTF-16LE（PowerShell -EncodedCommand 格式）
 *
 * 用于沙箱模式，避免引号转义问题
 */
function encodePowerShellCommand(psCommand: string): string {
  return Buffer.from(psCommand, 'utf16le').toString('base64');
}

/**
 * 创建 PowerShell Provider
 *
 * 支持 Windows PowerShell 5.x 和 PowerShell Core (pwsh)
 */
export function createPowerShellProvider(shellPath: string): ShellProvider {
  let currentSandboxTmpDir: string | undefined;

  return {
    type: 'powershell',
    shellPath,
    detached: false, // Windows 不需要 detached 模式

    async buildExecCommand(
      command: string,
      options: ShellExecOptions,
    ): Promise<ShellCommandResult> {
      // 保存沙箱临时目录供 getEnvironmentOverrides 使用
      currentSandboxTmpDir = options.useSandbox ? options.sandboxTmpDir : undefined;

      // CWD 跟踪文件路径
      const cwdFilePath =
        options.useSandbox && options.sandboxTmpDir
          ? posixJoin(options.sandboxTmpDir, `openawork-pwd-ps-${options.id}`)
          : join(tmpdir(), `openawork-pwd-ps-${options.id}`);

      // PowerShell 中单引号需要转义为两个单引号
      const escapedCwdFilePath = cwdFilePath.replace(/'/g, "''");

      // 退出码捕获逻辑：
      // - 优先使用 $LASTEXITCODE（外部程序的退出码）
      // - 如果为 null（没有运行外部程序），则使用 $?（cmdlet 成功状态）
      // - PowerShell 5.1 中，即使外部程序返回 0，如果有 stderr 输出，$? 可能为 false
      //   因此优先信任 $LASTEXITCODE
      const cwdTracking = `
; $_ec = if ($null -ne $LASTEXITCODE) { $LASTEXITCODE } elseif ($?) { 0 } else { 1 }
; (Get-Location).Path | Out-File -FilePath '${escapedCwdFilePath}' -Encoding utf8 -NoNewline
; [Environment]::ExitCode = $_ec`;

      const psCommand = command + cwdTracking;

      // 沙箱模式：使用 Base64 编码避免引号转义问题
      // 沙箱运行时会将命令包装为 `sh -c '<cmd>'`
      // 需要构建一个能在 sh 中执行的 PowerShell 调用
      const commandString = options.useSandbox
        ? [
            `'${shellPath.replace(/'/g, `'\\''`)}'`, // POSIX 单引号转义
            '-NoProfile',
            '-NonInteractive',
            '-EncodedCommand',
            encodePowerShellCommand(psCommand),
          ].join(' ')
        : psCommand;

      return { commandString, cwdFilePath };
    },

    getSpawnArgs(commandString: string): string[] {
      return buildPowerShellArgs(commandString);
    },

    async getEnvironmentOverrides(_command: string): Promise<Record<string, string>> {
      const env: Record<string, string> = {};

      // 标记这是 OpenAWork 启动的进程
      env.OPENAWORK = '1';

      // 沙箱模式：设置临时目录
      if (currentSandboxTmpDir) {
        // PowerShell 在 Linux/macOS 上会读取 TMPDIR
        env.TMPDIR = currentSandboxTmpDir;
        env.OPENAWORK_TMPDIR = currentSandboxTmpDir;
      }

      return env;
    },
  };
}
