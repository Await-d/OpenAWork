/**
 * Shell 类型定义
 */
export const SHELL_TYPES = ['bash', 'powershell'] as const;
export type ShellType = (typeof SHELL_TYPES)[number];

/**
 * Shell 执行配置
 */
export interface ShellExecOptions {
  /** 命令唯一标识 */
  id: string;
  /** 沙箱临时目录（如果启用沙箱） */
  sandboxTmpDir?: string;
  /** 是否使用沙箱 */
  useSandbox: boolean;
}

/**
 * Shell 命令构建结果
 */
export interface ShellCommandResult {
  /** 构建后的完整命令字符串 */
  commandString: string;
  /** 用于跟踪工作目录的文件路径 */
  cwdFilePath: string;
}

/**
 * Shell Provider 抽象接口
 *
 * 统一不同 shell 类型（bash/zsh/PowerShell）的执行接口
 */
export interface ShellProvider {
  /** Shell 类型标识 */
  type: ShellType;

  /** Shell 可执行文件路径 */
  shellPath: string;

  /** 是否以 detached 模式启动子进程 */
  detached: boolean;

  /**
   * 构建完整的 shell 命令
   *
   * 包含 shell 特定的初始化、环境变量加载、命令包装等
   *
   * @param command 原始命令
   * @param options 执行选项
   * @returns 构建结果，包含完整命令和 cwd 跟踪文件路径
   */
  buildExecCommand(command: string, options: ShellExecOptions): Promise<ShellCommandResult>;

  /**
   * 获取 spawn 子进程时的参数
   *
   * 例如 bash: ['-c', '-l', command]
   * PowerShell: ['-NoProfile', '-NonInteractive', '-Command', command]
   *
   * @param commandString 构建后的命令字符串
   * @returns spawn 参数数组
   */
  getSpawnArgs(commandString: string): string[];

  /**
   * 获取环境变量覆盖
   *
   * 返回需要设置给子进程的额外环境变量
   *
   * @param command 原始命令
   * @returns 环境变量键值对
   */
  getEnvironmentOverrides(command: string): Promise<Record<string, string>>;
}
