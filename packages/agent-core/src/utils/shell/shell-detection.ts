import { execFileSync } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { getPlatform } from '../platform.js';

/**
 * 检查文件是否可执行
 */
function isExecutable(shellPath: string): boolean {
  try {
    accessSync(shellPath, constants.X_OK);
    return true;
  } catch {
    // Fallback: 尝试执行 --version
    try {
      execFileSync(shellPath, ['--version'], {
        timeout: 1000,
        stdio: 'ignore',
      });
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * 简单的 which 实现
 * 在 PATH 中查找可执行文件
 */
async function which(command: string): Promise<string | null> {
  const PATH = process.env.PATH || '';
  const pathExt = process.env.PATHEXT || '';
  const extensions = pathExt ? pathExt.split(';') : [''];
  const paths = PATH.split(process.platform === 'win32' ? ';' : ':');

  for (const dir of paths) {
    if (!dir) continue;

    for (const ext of extensions) {
      const fullPath = `${dir}/${command}${ext}`;
      try {
        if (isExecutable(fullPath)) {
          return fullPath;
        }
      } catch {
        // 继续尝试下一个
      }
    }
  }

  return null;
}

/**
 * 查找适合的 POSIX shell (bash/zsh)
 *
 * 优先级：
 * 1. 环境变量 OPENAWORK_SHELL
 * 2. 环境变量 SHELL (如果是 bash/zsh)
 * 3. which 查找结果
 * 4. 常见安装路径
 */
export async function findSuitableShell(): Promise<string> {
  // 1. 检查显式覆盖
  const shellOverride = process.env.OPENAWORK_SHELL;
  if (shellOverride) {
    const isSupported = shellOverride.includes('bash') || shellOverride.includes('zsh');
    if (isSupported && isExecutable(shellOverride)) {
      return shellOverride;
    }
  }

  // 2. 检查用户的 SHELL 环境变量
  const envShell = process.env.SHELL;
  const isEnvShellSupported = envShell && (envShell.includes('bash') || envShell.includes('zsh'));
  const preferBash = envShell?.includes('bash');

  // 3. 使用 which 查找
  const [zshPath, bashPath] = await Promise.all([which('zsh'), which('bash')]);

  // 4. 常见安装路径
  const shellPaths = ['/bin', '/usr/bin', '/usr/local/bin', '/opt/homebrew/bin'];
  const shellOrder = preferBash ? ['bash', 'zsh'] : ['zsh', 'bash'];
  const supportedShells = shellOrder.flatMap((shell) =>
    shellPaths.map((path) => `${path}/${shell}`),
  );

  // 将 which 发现的路径添加到搜索列表
  if (preferBash) {
    if (bashPath) supportedShells.unshift(bashPath);
    if (zshPath) supportedShells.push(zshPath);
  } else {
    if (zshPath) supportedShells.unshift(zshPath);
    if (bashPath) supportedShells.push(bashPath);
  }

  // 始终优先使用 SHELL 环境变量（如果支持）
  if (isEnvShellSupported && isExecutable(envShell)) {
    supportedShells.unshift(envShell);
  }

  const shellPath = supportedShells.find((shell) => shell && isExecutable(shell));

  if (!shellPath) {
    throw new Error(
      'No suitable shell found. OpenAWork requires bash or zsh. ' +
        'Please ensure you have a valid shell installed and the SHELL environment variable set.',
    );
  }

  return shellPath;
}

/**
 * 检测 PowerShell 路径
 *
 * 优先级：
 * 1. pwsh (PowerShell Core 7+, 跨平台)
 * 2. powershell (Windows PowerShell 5.x, 仅 Windows)
 */
export async function findPowerShell(): Promise<string | null> {
  // 优先使用 PowerShell Core
  const pwshPath = await which('pwsh');
  if (pwshPath) {
    return pwshPath;
  }

  // Windows 上回退到 Windows PowerShell
  if (getPlatform() === 'windows') {
    const powershellPath = await which('powershell');
    if (powershellPath) {
      return powershellPath;
    }

    // 尝试常见的 Windows PowerShell 路径
    const systemPowerShell = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
    if (isExecutable(systemPowerShell)) {
      return systemPowerShell;
    }
  }

  return null;
}

/**
 * 检测 PowerShell 是否可用
 */
export async function isPowerShellAvailable(): Promise<boolean> {
  const psPath = await findPowerShell();
  return psPath !== null;
}
