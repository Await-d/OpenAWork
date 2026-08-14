import { readFileSync } from 'node:fs';

export type Platform = 'macos' | 'windows' | 'wsl' | 'linux' | 'unknown';

/**
 * 检测当前运行的平台类型
 */
export function getPlatform(): Platform {
  try {
    if (process.platform === 'darwin') {
      return 'macos';
    }

    if (process.platform === 'win32') {
      return 'windows';
    }

    if (process.platform === 'linux') {
      // 检查是否运行在 WSL (Windows Subsystem for Linux)
      try {
        const procVersion = readFileSync('/proc/version', { encoding: 'utf8' });
        if (
          procVersion.toLowerCase().includes('microsoft') ||
          procVersion.toLowerCase().includes('wsl')
        ) {
          return 'wsl';
        }
      } catch {
        // 无法读取 /proc/version，假设是常规 Linux
      }

      return 'linux';
    }

    return 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * 获取 WSL 版本号 (1 或 2)
 */
export function getWslVersion(): string | undefined {
  if (process.platform !== 'linux') {
    return undefined;
  }

  try {
    const procVersion = readFileSync('/proc/version', { encoding: 'utf8' });

    // 检查显式的 WSL 版本标记 (e.g., "WSL2", "WSL3")
    const wslVersionMatch = procVersion.match(/WSL(\d+)/i);
    if (wslVersionMatch?.[1]) {
      return wslVersionMatch[1];
    }

    // 如果包含 Microsoft 但没有显式版本号，假设是 WSL1
    if (procVersion.toLowerCase().includes('microsoft')) {
      return '1';
    }

    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * 检查是否为 Windows 平台（包括原生 Windows 和 WSL）
 */
export function isWindowsEnvironment(): boolean {
  const platform = getPlatform();
  return platform === 'windows' || platform === 'wsl';
}

/**
 * 检查是否支持 POSIX shell
 */
export function supportsPosixShell(): boolean {
  const platform = getPlatform();
  return platform === 'macos' || platform === 'linux' || platform === 'wsl';
}
