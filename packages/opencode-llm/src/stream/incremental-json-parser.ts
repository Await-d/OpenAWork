/**
 * 增量 JSON 解析器
 *
 * 处理不完整的 JSON chunk，支持流式解析场景。
 */

import { Effect } from 'effect';
import { LLMError } from '../schema/index.js';
import { streamError, isValidJson } from './utils.js';

/**
 * JSON 解析器状态
 */
interface ParserState {
  /** 累积的文本缓冲区 */
  buffer: string;
  /** 当前嵌套深度 */
  depth: number;
  /** 是否在字符串中 */
  inString: boolean;
  /** 是否在转义字符中 */
  escaped: boolean;
  /** 已解析的完整对象 */
  completed: unknown[];
}

/**
 * 增量 JSON 解析器
 *
 * 支持流式接收 JSON 片段，当检测到完整对象时返回解析结果。
 */
export class IncrementalJsonParser {
  private state: ParserState;

  constructor() {
    this.state = {
      buffer: '',
      depth: 0,
      inString: false,
      escaped: false,
      completed: [],
    };
  }

  /**
   * 添加新的文本片段
   *
   * @param chunk 文本片段
   * @returns 已完成的 JSON 对象数组
   */
  public append(chunk: string): Effect.Effect<unknown[], LLMError> {
    return Effect.try({
      try: () => {
        this.state.buffer += chunk;
        return this.extractComplete();
      },
      catch: (error) =>
        streamError(
          `JSON parser error: ${error instanceof Error ? error.message : String(error)}`,
          this.state.buffer,
        ),
    });
  }

  /**
   * 提取所有完整的 JSON 对象
   */
  private extractComplete(): unknown[] {
    const results: unknown[] = [];
    let startIndex = 0;

    // 跳过前导空白
    while (startIndex < this.state.buffer.length) {
      const char = this.state.buffer[startIndex];
      if (char === ' ' || char === '\n' || char === '\r' || char === '\t') {
        startIndex++;
      } else {
        break;
      }
    }

    if (startIndex === this.state.buffer.length) {
      this.state.buffer = '';
      return results;
    }

    // 尝试解析从 startIndex 开始的每个可能的完整对象
    for (let endIndex = startIndex + 1; endIndex <= this.state.buffer.length; endIndex++) {
      const candidate = this.state.buffer.slice(startIndex, endIndex);

      // 检查是否可能是完整对象
      if (this.isLikelyComplete(candidate)) {
        if (isValidJson(candidate)) {
          try {
            const parsed = JSON.parse(candidate);
            results.push(parsed);

            // 更新 buffer，移除已解析的部分
            this.state.buffer = this.state.buffer.slice(endIndex);
            startIndex = 0;
            endIndex = 0;

            // 跳过后续空白
            while (startIndex < this.state.buffer.length) {
              const char = this.state.buffer[startIndex];
              if (char === ' ' || char === '\n' || char === '\r' || char === '\t') {
                this.state.buffer = this.state.buffer.slice(1);
              } else {
                break;
              }
            }
          } catch {
            // 解析失败，继续尝试更长的候选
          }
        }
      }
    }

    return results;
  }

  /**
   * 检查字符串是否可能是完整的 JSON 对象
   */
  private isLikelyComplete(text: string): boolean {
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = 0; i < text.length; i++) {
      const char = text[i];

      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === '\\') {
        escaped = true;
        continue;
      }

      if (char === '"') {
        inString = !inString;
        continue;
      }

      if (inString) {
        continue;
      }

      if (char === '{' || char === '[') {
        depth++;
      } else if (char === '}' || char === ']') {
        depth--;
        if (depth === 0) {
          // 找到匹配的闭合括号
          return true;
        }
      }
    }

    return depth === 0 && !inString;
  }

  /**
   * 获取当前缓冲区内容
   */
  public getBuffer(): string {
    return this.state.buffer;
  }

  /**
   * 获取缓冲区大小（字节）
   */
  public getBufferSize(): number {
    return Buffer.byteLength(this.state.buffer, 'utf8');
  }

  /**
   * 清空缓冲区
   */
  public clear(): void {
    this.state = {
      buffer: '',
      depth: 0,
      inString: false,
      escaped: false,
      completed: [],
    };
  }

  /**
   * 强制完成解析（用于流结束时）
   *
   * 尝试解析缓冲区中剩余的内容，如果不是有效 JSON 则返回错误。
   */
  public finish(): Effect.Effect<unknown[], LLMError> {
    return Effect.try({
      try: () => {
        const trimmed = this.state.buffer.trim();
        if (trimmed.length === 0) {
          return [];
        }

        if (!isValidJson(trimmed)) {
          throw streamError('Incomplete JSON at end of stream', trimmed);
        }

        const parsed = JSON.parse(trimmed);
        this.clear();
        return [parsed];
      },
      catch: (error) => {
        if (error instanceof LLMError) {
          return error;
        }
        return streamError(
          `Failed to finish parsing: ${error instanceof Error ? error.message : String(error)}`,
          this.state.buffer,
        );
      },
    });
  }

  /**
   * 检查是否有未解析的数据
   */
  public hasBufferedData(): boolean {
    return this.state.buffer.trim().length > 0;
  }
}
