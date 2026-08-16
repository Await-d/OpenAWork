/**
 * 工具调用日志记录器
 *
 * 提供详细的工具调用日志记录和分析功能
 */

/**
 * 日志级别
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * 工具调用阶段
 */
export type ToolCallPhase =
  'validation' | 'execution' | 'parsing' | 'retry' | 'fallback' | 'completed' | 'failed';

/**
 * 日志条目
 */
export interface LogEntry {
  /** 时间戳 */
  timestamp: number;
  /** 日志级别 */
  level: LogLevel;
  /** 工具名称 */
  toolName: string;
  /** 调用 ID */
  callId: string;
  /** 调用阶段 */
  phase: ToolCallPhase;
  /** 日志消息 */
  message: string;
  /** 附加数据 */
  data?: Record<string, unknown>;
  /** 错误对象 */
  error?: Error;
  /** 耗时（毫秒） */
  durationMs?: number;
}

/**
 * 工具调用统计
 */
export interface ToolCallStats {
  /** 工具名称 */
  toolName: string;
  /** 总调用次数 */
  totalCalls: number;
  /** 成功次数 */
  successCount: number;
  /** 失败次数 */
  failureCount: number;
  /** 平均耗时（毫秒） */
  avgDurationMs: number;
  /** 最小耗时 */
  minDurationMs: number;
  /** 最大耗时 */
  maxDurationMs: number;
  /** 重试次数 */
  retryCount: number;
  /** 降级次数 */
  fallbackCount: number;
  /** 最后调用时间 */
  lastCallAt: number;
}

/**
 * 日志记录器配置
 */
export interface LoggerConfig {
  /** 是否启用日志 */
  enabled?: boolean;
  /** 日志级别 */
  level?: LogLevel;
  /** 是否记录输入 */
  logInput?: boolean;
  /** 是否记录输出 */
  logOutput?: boolean;
  /** 是否记录错误堆栈 */
  logErrorStack?: boolean;
  /** 最大日志条目数（循环缓冲） */
  maxEntries?: number;
  /** 是否启用统计 */
  enableStats?: boolean;
  /** 输出函数 */
  outputFn?: (entry: LogEntry) => void;
}

/**
 * 工具调用日志记录器
 */
export class ToolCallLogger {
  private readonly config: Required<LoggerConfig>;
  private readonly entries: LogEntry[] = [];
  private readonly stats = new Map<string, ToolCallStats>();
  private readonly callTimings = new Map<string, number>();

  constructor(config: LoggerConfig = {}) {
    this.config = {
      enabled: config.enabled ?? true,
      level: config.level ?? 'info',
      logInput: config.logInput ?? false,
      logOutput: config.logOutput ?? false,
      logErrorStack: config.logErrorStack ?? true,
      maxEntries: config.maxEntries ?? 1000,
      enableStats: config.enableStats ?? true,
      outputFn: config.outputFn ?? this.defaultOutputFn.bind(this),
    };
  }

  /**
   * 开始记录工具调用
   */
  startCall(callId: string, toolName: string, input?: unknown): void {
    if (!this.config.enabled) return;

    this.callTimings.set(callId, Date.now());

    this.log({
      timestamp: Date.now(),
      level: 'debug',
      toolName,
      callId,
      phase: 'validation',
      message: `Starting tool call: ${toolName}`,
      data: this.config.logInput ? { input } : undefined,
    });
  }

  /**
   * 记录工具调用成功
   */
  logSuccess(callId: string, toolName: string, output?: unknown): void {
    if (!this.config.enabled) return;

    const durationMs = this.getDuration(callId);

    this.log({
      timestamp: Date.now(),
      level: 'info',
      toolName,
      callId,
      phase: 'completed',
      message: `Tool call succeeded: ${toolName}`,
      durationMs,
      data: this.config.logOutput ? { output } : undefined,
    });

    this.updateStats(toolName, true, durationMs);
  }

  /**
   * 记录工具调用失败
   */
  logFailure(callId: string, toolName: string, error: Error): void {
    if (!this.config.enabled) return;

    const durationMs = this.getDuration(callId);

    this.log({
      timestamp: Date.now(),
      level: 'error',
      toolName,
      callId,
      phase: 'failed',
      message: `Tool call failed: ${toolName}`,
      durationMs,
      error,
      data: this.config.logErrorStack && error.stack ? { stack: error.stack } : undefined,
    });

    this.updateStats(toolName, false, durationMs);
  }

  /**
   * 记录重试
   */
  logRetry(callId: string, toolName: string, attempt: number, error: Error): void {
    if (!this.config.enabled) return;

    this.log({
      timestamp: Date.now(),
      level: 'warn',
      toolName,
      callId,
      phase: 'retry',
      message: `Retrying tool call: ${toolName} (attempt ${attempt})`,
      error,
      data: { attempt },
    });

    this.incrementRetryCount(toolName);
  }

  /**
   * 记录降级
   */
  logFallback(callId: string, toolName: string, fallbackToolName?: string): void {
    if (!this.config.enabled) return;

    this.log({
      timestamp: Date.now(),
      level: 'warn',
      toolName,
      callId,
      phase: 'fallback',
      message: fallbackToolName
        ? `Using fallback tool: ${toolName} -> ${fallbackToolName}`
        : `Using fallback for tool: ${toolName}`,
      data: fallbackToolName ? { fallbackToolName } : undefined,
    });

    this.incrementFallbackCount(toolName);
  }

  /**
   * 记录自定义日志
   */
  logCustom(
    level: LogLevel,
    toolName: string,
    callId: string,
    phase: ToolCallPhase,
    message: string,
    data?: Record<string, unknown>,
  ): void {
    if (!this.config.enabled) return;

    this.log({
      timestamp: Date.now(),
      level,
      toolName,
      callId,
      phase,
      message,
      data,
    });
  }

  /**
   * 获取所有日志条目
   */
  getEntries(): ReadonlyArray<LogEntry> {
    return [...this.entries];
  }

  /**
   * 获取指定工具的日志条目
   */
  getEntriesForTool(toolName: string): ReadonlyArray<LogEntry> {
    return this.entries.filter((entry) => entry.toolName === toolName);
  }

  /**
   * 获取指定调用 ID 的日志条目
   */
  getEntriesForCall(callId: string): ReadonlyArray<LogEntry> {
    return this.entries.filter((entry) => entry.callId === callId);
  }

  /**
   * 获取工具调用统计
   */
  getStats(): ReadonlyArray<ToolCallStats> {
    return Array.from(this.stats.values());
  }

  /**
   * 获取指定工具的统计
   */
  getStatsForTool(toolName: string): ToolCallStats | undefined {
    return this.stats.get(toolName);
  }

  /**
   * 清除所有日志
   */
  clear(): void {
    this.entries.length = 0;
    this.stats.clear();
    this.callTimings.clear();
  }

  /**
   * 清除指定工具的日志
   */
  clearForTool(toolName: string): void {
    // 移除日志条目
    for (let i = this.entries.length - 1; i >= 0; i--) {
      if (this.entries[i]?.toolName === toolName) {
        this.entries.splice(i, 1);
      }
    }

    // 移除统计
    this.stats.delete(toolName);
  }

  /**
   * 记录日志条目
   */
  private log(entry: LogEntry): void {
    // 检查日志级别
    if (!this.shouldLog(entry.level)) {
      return;
    }

    // 添加到缓冲区
    this.entries.push(entry);

    // 限制缓冲区大小（循环缓冲）
    if (this.entries.length > this.config.maxEntries) {
      this.entries.shift();
    }

    // 输出日志
    this.config.outputFn(entry);
  }

  /**
   * 判断是否应该记录该级别的日志
   */
  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
    const configLevelIndex = levels.indexOf(this.config.level);
    const entryLevelIndex = levels.indexOf(level);

    return entryLevelIndex >= configLevelIndex;
  }

  /**
   * 获取调用耗时
   */
  private getDuration(callId: string): number {
    const startTime = this.callTimings.get(callId);
    if (!startTime) return 0;

    const durationMs = Date.now() - startTime;
    this.callTimings.delete(callId);

    return durationMs;
  }

  /**
   * 更新统计信息
   */
  private updateStats(toolName: string, success: boolean, durationMs: number): void {
    if (!this.config.enableStats) return;

    let stats = this.stats.get(toolName);

    if (!stats) {
      stats = this.createEmptyStats(toolName);
      this.stats.set(toolName, stats);
    }

    stats.totalCalls++;
    if (success) {
      stats.successCount++;
    } else {
      stats.failureCount++;
    }

    stats.minDurationMs = Math.min(stats.minDurationMs, durationMs);
    stats.maxDurationMs = Math.max(stats.maxDurationMs, durationMs);

    // 更新平均耗时（增量计算）
    stats.avgDurationMs =
      (stats.avgDurationMs * (stats.totalCalls - 1) + durationMs) / stats.totalCalls;

    stats.lastCallAt = Date.now();
  }

  /**
   * 增加重试计数
   */
  private incrementRetryCount(toolName: string): void {
    if (!this.config.enableStats) return;

    let stats = this.stats.get(toolName);
    if (!stats) {
      stats = this.createEmptyStats(toolName);
      this.stats.set(toolName, stats);
    }
    stats.retryCount++;
  }

  /**
   * 增加降级计数
   */
  private incrementFallbackCount(toolName: string): void {
    if (!this.config.enableStats) return;

    let stats = this.stats.get(toolName);
    if (!stats) {
      stats = this.createEmptyStats(toolName);
      this.stats.set(toolName, stats);
    }
    stats.fallbackCount++;
  }

  /**
   * 创建空的统计对象
   */
  private createEmptyStats(toolName: string): ToolCallStats {
    return {
      toolName,
      totalCalls: 0,
      successCount: 0,
      failureCount: 0,
      avgDurationMs: 0,
      minDurationMs: Infinity,
      maxDurationMs: 0,
      retryCount: 0,
      fallbackCount: 0,
      lastCallAt: 0,
    };
  }

  /**
   * 默认日志输出函数
   */
  private defaultOutputFn(entry: LogEntry): void {
    const timestamp = new Date(entry.timestamp).toISOString();
    const prefix = `[${timestamp}] [${entry.level.toUpperCase()}] [${entry.toolName}:${entry.callId}] [${entry.phase}]`;

    let message = `${prefix} ${entry.message}`;

    if (entry.durationMs !== undefined) {
      message += ` (${entry.durationMs}ms)`;
    }

    // 根据级别选择输出方法
    switch (entry.level) {
      case 'debug':
        console.debug(message, entry.data ?? '');
        break;
      case 'info':
        console.info(message, entry.data ?? '');
        break;
      case 'warn':
        console.warn(message, entry.data ?? '', entry.error ?? '');
        break;
      case 'error':
        console.error(message, entry.data ?? '', entry.error ?? '');
        break;
    }
  }
}

/**
 * 创建默认的日志记录器实例
 */
export function createToolCallLogger(config?: LoggerConfig): ToolCallLogger {
  return new ToolCallLogger(config);
}

/**
 * 全局单例日志记录器（可选）
 */
let globalLogger: ToolCallLogger | null = null;

/**
 * 获取全局日志记录器
 */
export function getGlobalLogger(): ToolCallLogger {
  if (!globalLogger) {
    globalLogger = new ToolCallLogger();
  }
  return globalLogger;
}

/**
 * 设置全局日志记录器
 */
export function setGlobalLogger(logger: ToolCallLogger): void {
  globalLogger = logger;
}
