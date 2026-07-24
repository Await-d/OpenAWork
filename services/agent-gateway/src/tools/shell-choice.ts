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

function commandExistsOnPath(command: string): boolean {
  const result = spawnSync(
    command,
    ['-NoLogo', '-NoProfile', '-Command', '$PSVersionTable.PSVersion'],
    {
      stdio: 'ignore',
      windowsHide: true,
    },
  );
  return result.status === 0 && !result.error;
}
