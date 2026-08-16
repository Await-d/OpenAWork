/**
 * 工具执行器模块
 *
 * 提供工具调用的核心执行逻辑，支持：
 * - 多工具并行调用
 * - 超时控制
 * - 结果解析
 * - 日志记录
 * - 重试策略
 */

import type { ToolCallPart } from '../schema/index.js';
import type { OpenAWorkToolDefinition } from './adapter.js';
import type { ParsedToolResult, RawToolResult } from './result-parser.js';
import type { RetryConfig, RetryResult } from './retry.js';
import type { LoggerConfig } from './logger.js';
import { ToolResultParser } from './result-parser.js';
import { ToolCallRetry } from './retry.js';
import { ToolCallLogger } from './logger.js';

/**
 * 工具执行请求
 */
export interface ToolExecutionRequest {
  /** 工具调用 ID */
  toolCallId: string;
  /** 工具名称 */
  toolName: string;
  /** 工具输入参数 */
  input: unknown;
}

/**
 * 工具执行结果
 */
export interface ToolExecutionResult {
  /** 工具调用 ID */
  toolCallId: string;
  /** 工具名称 */
  toolName: string;
  /** 执行结果 */
  result: ParsedToolResult;
  /** 是否成功 */
  success: boolean;
  /** 错误信息（如果失败） */
  error?: Error;
  /** 执行耗时（毫秒） */
  durationMs: number;
  /** 是否使用了降级 */
  usedFallback: boolean;
  /** 实际重试次数 */
  attempts: number;
}

/**
 * 批量执行结果
 */
export interface BatchExecutionResult {
  /** 所有执行结果 */
  results: ToolExecutionResult[];
  /** 成功数量 */
  successCount: number;
  /** 失败数量 */
  failureCount: number;
  /** 总耗时（毫秒） */
  totalDurationMs: number;
}

/**
 * 工具执行器配置
 */
export interface ToolExecutorConfig {
  /** 默认超时时间（毫秒） */
  defaultTimeoutMs?: number;
  /** 是否启用并行执行 */
  enableParallel?: boolean;
  /** 最大并行数 */
  maxParallel?: number;
  /** 重试配置 */
  retryConfig?: RetryConfig;
  /** 日志配置 */
  loggerConfig?: LoggerConfig;
  /** 是否验证输入 */
  validateInput?: boolean;
  /** 是否验证输出 */
  validateOutput?: boolean;
  /** AbortSignal（用于取消执行） */
  signal?: AbortSignal;
}

/**
 * 工具执行上下文
 */
interface ExecutionContext {
  request: ToolExecutionRequest;
  tool: OpenAWorkToolDefinition;
  startTime: number;
  signal: AbortSignal;
}

/**
 * 工具执行器类
 *
 * 负责执行工具调用，整合验证、重试、日志等功能
 */
export class ToolExecutor {
  private readonly config: Required<ToolExecutorConfig>;
  private readonly tools: Map<string, OpenAWorkToolDefinition>;
  private readonly resultParser: ToolResultParser;
  private readonly retry: ToolCallRetry;
  private readonly logger: ToolCallLogger;

  constructor(
    tools: OpenAWorkToolDefinition[] | Map<string, OpenAWorkToolDefinition>,
    config: ToolExecutorConfig = {},
  ) {
    this.config = {
      defaultTimeoutMs: config.defaultTimeoutMs ?? 30000,
      enableParallel: config.enableParallel ?? true,
      maxParallel: config.maxParallel ?? 10,
      retryConfig: config.retryConfig ?? {},
      loggerConfig: config.loggerConfig ?? {},
      validateInput: config.validateInput ?? true,
      validateOutput: config.validateOutput ?? true,
      signal: config.signal ?? new AbortController().signal,
    };

    // 初始化工具映射
    this.tools = Array.isArray(tools) ? new Map(tools.map((tool) => [tool.name, tool])) : tools;

    // 初始化子模块
    this.resultParser = new ToolResultParser({
      enableLogging: this.config.loggerConfig.enabled ?? false,
    });

    this.retry = new ToolCallRetry({
      ...this.config.retryConfig,
      enableLogging: this.config.loggerConfig.enabled ?? false,
    });

    this.logger = new ToolCallLogger(this.config.loggerConfig);
  }

  /**
   * 执行单个工具调用
   */
  async execute(request: ToolExecutionRequest): Promise<ToolExecutionResult> {
    const startTime = Date.now();

    // 查找工具定义
    const tool = this.tools.get(request.toolName);
    if (!tool) {
      return this.createErrorResult(
        request,
        new Error(`Tool not found: ${request.toolName}`),
        Date.now() - startTime,
      );
    }

    // 检查工具是否可执行
    if (!tool.execute) {
      return this.createErrorResult(
        request,
        new Error(`Tool has no execute handler: ${request.toolName}`),
        Date.now() - startTime,
      );
    }

    // 创建执行上下文
    const context: ExecutionContext = {
      request,
      tool,
      startTime,
      signal: this.createTimeoutSignal(tool.timeout ?? this.config.defaultTimeoutMs),
    };

    // 开始记录日志
    this.logger.startCall(request.toolCallId, request.toolName, request.input);

    try {
      // 验证输入
      if (this.config.validateInput) {
        this.validateInput(context);
      }

      // 执行工具调用（带重试）
      const retryResult = await this.executeWithRetry(context);

      // 验证输出
      if (this.config.validateOutput && retryResult.success && retryResult.data) {
        this.validateOutput(context, retryResult.data);
      }

      // 解析结果
      const rawResult: RawToolResult = {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        output: retryResult.data,
        isError: !retryResult.success,
        durationMs: retryResult.totalMs,
      };

      const parsedResult = this.resultParser.parse(rawResult);

      // 记录成功或失败日志
      if (retryResult.success) {
        this.logger.logSuccess(request.toolCallId, request.toolName, retryResult.data);
      } else if (retryResult.error) {
        this.logger.logFailure(request.toolCallId, request.toolName, retryResult.error);
      }

      return {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        result: parsedResult,
        success: retryResult.success,
        error: retryResult.error,
        durationMs: Date.now() - startTime,
        usedFallback: retryResult.usedFallback,
        attempts: retryResult.attempts,
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));

      // 记录失败日志
      this.logger.logFailure(request.toolCallId, request.toolName, err);

      return this.createErrorResult(request, err, Date.now() - startTime);
    }
  }

  /**
   * 批量执行多个工具调用
   */
  async executeMany(requests: ToolExecutionRequest[]): Promise<BatchExecutionResult> {
    const startTime = Date.now();

    let results: ToolExecutionResult[];

    if (this.config.enableParallel) {
      // 并行执行（带并发控制）
      results = await this.executeParallel(requests);
    } else {
      // 串行执行
      results = await this.executeSequential(requests);
    }

    const successCount = results.filter((r) => r.success).length;
    const failureCount = results.length - successCount;

    return {
      results,
      successCount,
      failureCount,
      totalDurationMs: Date.now() - startTime,
    };
  }

  /**
   * 从 ToolCallPart 执行（OpenCode LLM 格式）
   */
  async executeFromToolCall(call: ToolCallPart): Promise<ToolExecutionResult> {
    return this.execute({
      toolCallId: call.id,
      toolName: call.name,
      input: call.input,
    });
  }

  /**
   * 批量执行 ToolCallPart
   */
  async executeManyFromToolCalls(calls: ToolCallPart[]): Promise<BatchExecutionResult> {
    const requests = calls.map((call) => ({
      toolCallId: call.id,
      toolName: call.name,
      input: call.input,
    }));

    return this.executeMany(requests);
  }

  /**
   * 注册新工具
   */
  registerTool(tool: OpenAWorkToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  /**
   * 注销工具
   */
  unregisterTool(toolName: string): void {
    this.tools.delete(toolName);
  }

  /**
   * 获取工具定义
   */
  getTool(toolName: string): OpenAWorkToolDefinition | undefined {
    return this.tools.get(toolName);
  }

  /**
   * 列出所有工具
   */
  listTools(): OpenAWorkToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /**
   * 获取日志记录器
   */
  getLogger(): ToolCallLogger {
    return this.logger;
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return this.logger.getStats();
  }

  /**
   * 清除日志
   */
  clearLogs(): void {
    this.logger.clear();
  }

  /**
   * 执行工具调用（带重试）
   */
  private async executeWithRetry(context: ExecutionContext): Promise<RetryResult<unknown>> {
    const { request, tool, signal } = context;

    return this.retry.execute(request.toolName, request.input, async (input) => {
      // 检查是否已取消
      if (signal.aborted) {
        throw new Error('Tool execution aborted');
      }

      // 执行工具
      return tool.execute!(input, signal);
    });
  }

  /**
   * 并行执行多个工具调用
   */
  private async executeParallel(requests: ToolExecutionRequest[]): Promise<ToolExecutionResult[]> {
    const results: ToolExecutionResult[] = [];
    const batches = this.splitIntoBatches(requests, this.config.maxParallel);

    for (const batch of batches) {
      const batchResults = await Promise.all(batch.map((req) => this.execute(req)));
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * 串行执行多个工具调用
   */
  private async executeSequential(
    requests: ToolExecutionRequest[],
  ): Promise<ToolExecutionResult[]> {
    const results: ToolExecutionResult[] = [];

    for (const request of requests) {
      const result = await this.execute(request);
      results.push(result);
    }

    return results;
  }

  /**
   * 将请求数组分批
   */
  private splitIntoBatches<T>(items: T[], batchSize: number): T[][] {
    const batches: T[][] = [];

    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }

    return batches;
  }

  /**
   * 创建带超时的 AbortSignal
   */
  private createTimeoutSignal(timeoutMs: number): AbortSignal {
    const controller = new AbortController();

    // 合并全局 signal 和超时 signal
    if (AbortSignal.any) {
      const timeoutSignal = AbortSignal.timeout(timeoutMs);
      return AbortSignal.any([this.config.signal, timeoutSignal]);
    }

    // 降级实现（不支持 AbortSignal.any 的环境）
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    this.config.signal.addEventListener('abort', () => {
      clearTimeout(timeoutId);
      controller.abort();
    });

    return controller.signal;
  }

  /**
   * 验证输入参数
   */
  private validateInput(context: ExecutionContext): void {
    const { request, tool } = context;
    const parsed = tool.inputSchema.safeParse(request.input);

    if (!parsed.success) {
      throw new Error(
        `Invalid input for tool "${request.toolName}": ${this.formatValidationError(parsed.error)}`,
      );
    }
  }

  /**
   * 验证输出结果
   */
  private validateOutput(context: ExecutionContext, output: unknown): void {
    const { request, tool } = context;

    if (!tool.outputSchema) {
      return; // 没有输出 schema，跳过验证
    }

    const parsed = tool.outputSchema.safeParse(output);

    if (!parsed.success) {
      throw new Error(
        `Invalid output from tool "${request.toolName}": ${this.formatValidationError(parsed.error)}`,
      );
    }
  }

  /**
   * 格式化验证错误
   */
  private formatValidationError(error: unknown): string {
    if (error && typeof error === 'object' && 'issues' in error) {
      const issues = (error as { issues: Array<{ path: string[]; message: string }> }).issues;
      return issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join(', ');
    }

    return String(error);
  }

  /**
   * 创建错误结果
   */
  private createErrorResult(
    request: ToolExecutionRequest,
    error: Error,
    durationMs: number,
  ): ToolExecutionResult {
    const rawResult: RawToolResult = {
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      output: error.message,
      isError: true,
      durationMs,
    };

    const parsedResult = this.resultParser.parse(rawResult);

    return {
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      result: parsedResult,
      success: false,
      error,
      durationMs,
      usedFallback: false,
      attempts: 1,
    };
  }
}

/**
 * 创建默认的工具执行器实例
 */
export function createToolExecutor(
  tools: OpenAWorkToolDefinition[] | Map<string, OpenAWorkToolDefinition>,
  config?: ToolExecutorConfig,
): ToolExecutor {
  return new ToolExecutor(tools, config);
}
