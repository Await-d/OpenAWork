import { spawnSync } from 'node:child_process';
import path from 'node:path';

export interface ShellChoice {
  shell: string;
  isPowerShell: boolean;
  name: string;
}

export interface ShellSelectionEnv {
  ComSpec?: string;
  OPENAWORK_WINDOWS_SHELL?: string;
  SHELL?: string;
}

export interface ShellSelectionOptions {
  commandExists?: (command: string) => boolean;
}

export function resolveShellChoiceForPlatform(
  platform: NodeJS.Platform,
  env: ShellSelectionEnv = process.env,
  options: ShellSelectionOptions = {},
): ShellChoice {
  if (platform === 'win32') {
    const configuredShell = env.OPENAWORK_WINDOWS_SHELL?.trim();
    const shell =
      configuredShell && configuredShell.length > 0
        ? configuredShell
        : pickDefaultWindowsShell(options.commandExists ?? commandExistsOnPath);
    return {
      shell,
      isPowerShell: /powershell|pwsh/i.test(shell),
      name: path.basename(shell).toLowerCase(),
    };
  }

  const shell = env.SHELL?.trim() || '/bin/bash';
  return {
    shell,
    isPowerShell: false,
    name: path.basename(shell).toLowerCase(),
  };
}

function pickDefaultWindowsShell(commandExists: (command: string) => boolean): string {
  return commandExists('pwsh.exe') ? 'pwsh.exe' : 'powershell.exe';
}

const commandExistsCache = new Map<string, boolean>();

function commandExistsOnPath(command: string): boolean {
  // Windows 上没有配置 OPENAWORK_WINDOWS_SHELL 时，每次 bash preflight 都会走到
  // 这里。spawnSync 会同步阻塞整个网关事件循环，长任务/多会话并发时尤其明显；
  // 按「命令 + PATH」缓存结果，PATH 变化时自然失效。
  const cacheKey = `${command}\0${process.env['PATH'] ?? ''}`;
  const cached = commandExistsCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }
  const result = spawnSync(
    command,
    ['-NoLogo', '-NoProfile', '-Command', '$PSVersionTable.PSVersion'],
    {
      stdio: 'ignore',
      windowsHide: true,
    },
  );
  const exists = result.status === 0 && !result.error;
  commandExistsCache.set(cacheKey, exists);
  return exists;
}

/** Test hook: clear the PATH-probe cache. */
export function __resetShellChoiceCacheForTest(): void {
  commandExistsCache.clear();
}
