import { spawn, type ChildProcess } from 'node:child_process';
import { getPlatform } from '../platform.js';
import { createBashShellProvider } from './bash-provider.js';
import { createPowerShellProvider } from './powershell-provider.js';
import { findPowerShell, findSuitableShell } from './shell-detection.js';
import type { ShellProvider, ShellType } from './shell-provider.js';

/**
 * Shell 执行选项
 */
export interface ShellExecuteOptions {
  /** 工作目录 */
  cwd?: string;
  /** 超时时间（毫秒） */
  timeout?: number;
  /** 环境变量 */
  env?: Record<string, string>;
  /** 是否使用沙箱 */
  useSandbox?: boolean;
  /** 中止信号 */
  signal?: AbortSignal;
}

/**
 * Shell 执行结果
 */
export interface ShellExecuteResult {
  /** 子进程对象 */
  process: ChildProcess;
  /** CWD 跟踪文件路径 */
  cwdFilePath: string;
  /** 使用的 Provider */
  provider: ShellProvider;
}

/**
 * Shell 配置缓存
 */
let bashProviderCache: ShellProvider | null = null;
let powershellProviderCache: ShellProvider | null = null;

/**
 * 获取 Bash Provider（带缓存）
 */
async function getBashProvider(): Promise<ShellProvider> {
  if (bashProviderCache) {
    return bashProviderCache;
  }

  const shellPath = await findSuitableShell();
  bashProviderCache = createBashShellProvider(shellPath);
  return bashProviderCache;
}

/**
 * 获取 PowerShell Provider（带缓存）
 */
async function getPowerShellProvider(): Promise<ShellProvider> {
  if (powershellProviderCache) {
    return powershellProviderCache;
  }

  const psPath = await findPowerShell();
  if (!psPath) {
    throw new Error('PowerShell is not available on this system');
  }

  powershellProviderCache = createPowerShellProvider(psPath);
  return powershellProviderCache;
}

/**
 * 根据 Shell 类型获取 Provider
 */
async function getProvider(shellType: ShellType): Promise<ShellProvider> {
  switch (shellType) {
    case 'bash':
      return getBashProvider();
    case 'powershell':
      return getPowerShellProvider();
    default:
      throw new Error(`Unsupported shell type: ${shellType}`);
  }
}

/**
 * 执行 Shell 命令
 *
 * @param command 要执行的命令
 * @param shellType Shell 类型 (bash 或 powershell)
 * @param options 执行选项
 * @returns 执行结果，包含子进程对象和 CWD 跟踪文件路径
 */
export async function executeShellCommand(
  command: string,
  shellType: ShellType,
  options: ShellExecuteOptions = {},
): Promise<ShellExecuteResult> {
  const provider = await getProvider(shellType);

  // 生成命令 ID
  const commandId = Math.floor(Math.random() * 0x10000)
    .toString(16)
    .padStart(4, '0');

  // 构建完整命令
  const { commandString, cwdFilePath } = await provider.buildExecCommand(command, {
    id: commandId,
    sandboxTmpDir: options.useSandbox ? '/tmp/openawork-sandbox' : undefined,
    useSandbox: options.useSandbox ?? false,
  });

  // 获取环境变量覆盖
  const envOverrides = await provider.getEnvironmentOverrides(command);

  // 准备 spawn 参数
  const spawnBinary = provider.shellPath;
  const spawnArgs = provider.getSpawnArgs(commandString);
  const spawnEnv = {
    ...process.env,
    ...envOverrides,
    ...(options.env ?? {}),
  };

  // 启动子进程
  const childProcess = spawn(spawnBinary, spawnArgs, {
    cwd: options.cwd ?? process.cwd(),
    env: spawnEnv,
    detached: provider.detached,
    windowsHide: true, // Windows 上隐藏控制台窗口
    stdio: 'pipe',
  });

  // 处理中止信号
  if (options.signal) {
    options.signal.addEventListener('abort', () => {
      if (!childProcess.killed) {
        childProcess.kill('SIGTERM');
      }
    });
  }

  // 处理超时
  if (options.timeout) {
    setTimeout(() => {
      if (!childProcess.killed) {
        childProcess.kill('SIGTERM');
      }
    }, options.timeout);
  }

  return {
    process: childProcess,
    cwdFilePath,
    provider,
  };
}

/**
 * 根据平台自动选择默认 Shell 类型
 */
export function getDefaultShellType(): ShellType {
  const platform = getPlatform();

  // Windows 优先使用 PowerShell
  if (platform === 'windows') {
    return 'powershell';
  }

  // 其他平台使用 bash
  return 'bash';
}

/**
 * 重置 Provider 缓存（主要用于测试）
 */
export function resetProviderCache(): void {
  bashProviderCache = null;
  powershellProviderCache = null;
}
