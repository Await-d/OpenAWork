/**
 * 跨平台 Shell 执行模块
 *
 * 提供统一的接口执行 Bash 和 PowerShell 命令
 * 自动处理 Windows/macOS/Linux 平台差异
 */

// 核心类型
export type {
  ShellType,
  ShellProvider,
  ShellExecOptions,
  ShellCommandResult,
} from './shell-provider.js';

// Provider 实现
export { createBashShellProvider } from './bash-provider.js';
export { createPowerShellProvider, buildPowerShellArgs } from './powershell-provider.js';

// Shell 检测
export { findSuitableShell, findPowerShell, isPowerShellAvailable } from './shell-detection.js';

// Shell 执行器
export {
  executeShellCommand,
  getDefaultShellType,
  resetProviderCache,
  type ShellExecuteOptions,
  type ShellExecuteResult,
} from './shell-executor.js';
