/**
 * 工具结果解析器
 *
 * 负责解析和标准化工具调用结果
 */

import type { ToolResultValue, ToolOutput, ToolContent } from '../schema/index.js';
import { ToolOutput as ToolOutputClass } from '../schema/index.js';

/**
 * 工具执行结果（原始格式）
 */
export interface RawToolResult {
  toolCallId: string;
  toolName: string;
  output: unknown;
  isError: boolean;
  durationMs?: number;
  metadata?: Record<string, unknown>;
}

/**
 * 解析后的工具结果
 */
export interface ParsedToolResult {
  toolCallId: string;
  toolName: string;
  result: ToolResultValue;
  output?: ToolOutput;
  durationMs: number;
  isError: boolean;
  metadata?: Record<string, unknown>;
}

/**
 * 解析配置
 */
export interface ParserConfig {
  /** 最大输出长度（字符数），超过则截断 */
  maxOutputLength?: number;
  /** 是否保留错误堆栈 */
  preserveErrorStack?: boolean;
  /** 是否启用日志 */
  enableLogging?: boolean;
}

/**
 * 工具结果解析器类
 */
export class ToolResultParser {
  private readonly config: Required<ParserConfig>;

  constructor(config: ParserConfig = {}) {
    this.config = {
      maxOutputLength: config.maxOutputLength ?? 200_000,
      preserveErrorStack: config.preserveErrorStack ?? false,
      enableLogging: config.enableLogging ?? false,
    };
  }

  /**
   * 解析工具执行结果
   */
  parse(raw: RawToolResult): ParsedToolResult {
    if (this.config.enableLogging) {
      this.log('parse', {
        toolName: raw.toolName,
        isError: raw.isError,
        outputType: typeof raw.output,
      });
    }

    // 处理错误结果
    if (raw.isError) {
      return this.parseError(raw);
    }

    // 处理成功结果
    return this.parseSuccess(raw);
  }

  /**
   * 批量解析工具结果
   */
  parseMany(rawResults: RawToolResult[]): ParsedToolResult[] {
    return rawResults.map((raw) => this.parse(raw));
  }

  /**
   * 解析错误结果
   */
  private parseError(raw: RawToolResult): ParsedToolResult {
    const errorMessage = this.extractErrorMessage(raw.output);
    const truncated = this.truncateOutput(errorMessage);

    const result: ToolResultValue = {
      type: 'error',
      value: truncated,
    };

    return {
      toolCallId: raw.toolCallId,
      toolName: raw.toolName,
      result,
      durationMs: raw.durationMs ?? 0,
      isError: true,
      metadata: raw.metadata,
    };
  }

  /**
   * 解析成功结果
   */
  private parseSuccess(raw: RawToolResult): ParsedToolResult {
    const { result, output } = this.normalizeOutput(raw.output);

    return {
      toolCallId: raw.toolCallId,
      toolName: raw.toolName,
      result,
      output,
      durationMs: raw.durationMs ?? 0,
      isError: false,
      metadata: raw.metadata,
    };
  }

  /**
   * 标准化输出格式
   */
  private normalizeOutput(output: unknown): { result: ToolResultValue; output?: ToolOutput } {
    // 处理字符串输出
    if (typeof output === 'string') {
      const truncated = this.truncateOutput(output);
      return {
        result: { type: 'text', value: truncated },
        output: ToolOutputClass.make({}, [{ type: 'text', text: truncated }]),
      };
    }

    // 处理 null/undefined
    if (output === null || output === undefined) {
      return {
        result: { type: 'json', value: output },
      };
    }

    // 处理数组输出（可能是 ToolContent[]）
    if (Array.isArray(output) && this.isToolContentArray(output)) {
      return {
        result: { type: 'content', value: output as ToolContent[] },
        output: ToolOutputClass.make({}, output as ToolContent[]),
      };
    }

    // 处理对象输出
    if (typeof output === 'object') {
      // 检查是否已经是 ToolOutput 格式
      if (this.isToolOutput(output)) {
        const toolOutput = output as ToolOutput;
        return {
          result: ToolOutputClass.toResultValue(toolOutput),
          output: toolOutput,
        };
      }

      // 检查是否已经是 ToolResultValue 格式
      if (this.isToolResultValue(output)) {
        const result = output as ToolResultValue;
        return {
          result,
          output: ToolOutputClass.fromResultValue(result),
        };
      }

      // 普通对象，转换为 JSON
      const serialized = this.safeSerialize(output);
      const truncated = this.truncateOutput(serialized);

      return {
        result: { type: 'json', value: this.safeDeserialize(truncated) ?? output },
      };
    }

    // 其他类型（number, boolean 等）
    return {
      result: { type: 'json', value: output },
    };
  }

  /**
   * 提取错误消息
   */
  private extractErrorMessage(error: unknown): string {
    if (typeof error === 'string') {
      return error;
    }

    if (error instanceof Error) {
      if (this.config.preserveErrorStack && error.stack) {
        return error.stack;
      }
      return error.message;
    }

    if (error && typeof error === 'object') {
      // 尝试提取常见的错误字段
      const errorObj = error as Record<string, unknown>;
      if ('message' in errorObj && typeof errorObj.message === 'string') {
        return errorObj.message;
      }
      if ('error' in errorObj && typeof errorObj.error === 'string') {
        return errorObj.error;
      }
    }

    return String(error);
  }

  /**
   * 截断输出（防止过长）
   */
  private truncateOutput(output: string): string {
    if (output.length <= this.config.maxOutputLength) {
      return output;
    }

    const truncated = output.slice(0, this.config.maxOutputLength);
    const notice = '\n\n[输出已截断 — 原始输出超过最大长度]';

    return truncated + notice;
  }

  /**
   * 安全序列化对象
   */
  private safeSerialize(value: unknown): string {
    const seen = new WeakSet<object>();

    try {
      return JSON.stringify(value, (_key, val) => {
        // 处理 BigInt
        if (typeof val === 'bigint') {
          return val.toString();
        }

        // 处理循环引用
        if (val && typeof val === 'object') {
          if (seen.has(val)) {
            return '[Circular]';
          }
          seen.add(val);
        }

        return val;
      });
    } catch {
      return String(value);
    }
  }

  /**
   * 安全反序列化 JSON
   */
  private safeDeserialize(json: string): unknown {
    try {
      return JSON.parse(json);
    } catch {
      return null;
    }
  }

  /**
   * 检查是否为 ToolContent 数组
   */
  private isToolContentArray(value: unknown): boolean {
    if (!Array.isArray(value) || value.length === 0) {
      return false;
    }

    return value.every(
      (item) =>
        item &&
        typeof item === 'object' &&
        'type' in item &&
        (item.type === 'text' || item.type === 'file'),
    );
  }

  /**
   * 检查是否为 ToolOutput
   */
  private isToolOutput(value: unknown): boolean {
    return (
      value !== null &&
      typeof value === 'object' &&
      'structured' in value &&
      'content' in value &&
      Array.isArray((value as Record<string, unknown>).content)
    );
  }

  /**
   * 检查是否为 ToolResultValue
   */
  private isToolResultValue(value: unknown): boolean {
    return (
      value !== null &&
      typeof value === 'object' &&
      'type' in value &&
      'value' in value &&
      ((value as Record<string, unknown>).type === 'json' ||
        (value as Record<string, unknown>).type === 'text' ||
        (value as Record<string, unknown>).type === 'error' ||
        (value as Record<string, unknown>).type === 'content')
    );
  }

  /**
   * 记录日志
   */
  private log(action: string, data: unknown): void {
    if (this.config.enableLogging) {
      console.log(`[ToolResultParser:${action}]`, data);
    }
  }
}

/**
 * 创建默认的结果解析器实例
 */
export function createToolResultParser(config?: ParserConfig): ToolResultParser {
  return new ToolResultParser(config);
}
