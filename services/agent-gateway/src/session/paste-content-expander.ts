/**
 * Paste Content Expander — 自动展开消息中的 PasteReference
 *
 * 核心功能：
 * - 检测 MessageContent 中的 PasteReference
 * - 自动从数据库检索原始内容
 * - 处理嵌套 JSON content 结构
 * - 保持消息结构不变
 *
 * 参考实现：temp/claude-code-sourcemap/restored-src/src/history.ts (行 363-394)
 */

import type { Message, MessageContent } from '@openAwork/shared';
import { retrievePasteContent } from './paste-content-store.js';

/**
 * PasteReference 类型定义
 * 当文本内容超过阈值时，存储引用而非原始内容
 */
export interface PasteReference {
  type: 'paste_reference';
  hash: string;
  size: number;
  preview?: string;
}

/**
 * 检查对象是否为 PasteReference
 */
export function isPasteReference(value: unknown): value is PasteReference {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const obj = value as Record<string, unknown>;
  return (
    obj['type'] === 'paste_reference' &&
    typeof obj['hash'] === 'string' &&
    typeof obj['size'] === 'number'
  );
}

/**
 * 展开单个 MessageContent 中的 PasteReference
 *
 * @param sessionId - 会话 ID
 * @param content - 消息内容块
 * @returns 展开后的内容块
 */
function expandContentPasteReferences(sessionId: string, content: MessageContent): MessageContent {
  // 处理 text 类型的内容
  if (content.type === 'text') {
    // 检查 text 字段是否为嵌套的 PasteReference
    if (typeof content.text === 'object' && isPasteReference(content.text)) {
      const pasteRef = content.text as PasteReference;
      const expandedText = retrievePasteContent(sessionId, pasteRef.hash);

      if (expandedText !== null) {
        return {
          ...content,
          text: expandedText,
        };
      }

      // 展开失败，使用预览文本（如果有）
      return {
        ...content,
        text: pasteRef.preview ?? `[Paste content not found: ${pasteRef.hash.slice(0, 8)}...]`,
      };
    }

    // 尝试解析 JSON 字符串中的 PasteReference
    if (typeof content.text === 'string') {
      try {
        const parsed = JSON.parse(content.text);
        if (isPasteReference(parsed)) {
          const expandedText = retrievePasteContent(sessionId, parsed.hash);
          if (expandedText !== null) {
            return {
              ...content,
              text: expandedText,
            };
          }
        }
      } catch {
        // 不是 JSON，保持原样
      }
    }
  }

  // 处理 tool_call 的 input 字段
  if (content.type === 'tool_call') {
    const input = content.input;
    if (typeof input === 'object' && input !== null) {
      const expandedInput = expandObjectPasteReferences(sessionId, input) as Record<
        string,
        unknown
      >;
      if (expandedInput !== input) {
        return {
          ...content,
          input: expandedInput,
        };
      }
    }
  }

  // 处理 tool_result 的 output 字段
  if (content.type === 'tool_result') {
    const output = content.output;
    if (typeof output === 'string') {
      // 尝试解析 JSON 字符串
      try {
        const parsed = JSON.parse(output);
        if (isPasteReference(parsed)) {
          const expandedText = retrievePasteContent(sessionId, parsed.hash);
          if (expandedText !== null) {
            return {
              ...content,
              output: expandedText,
            };
          }
        }
      } catch {
        // 不是 JSON，保持原样
      }
    } else if (typeof output === 'object' && output !== null) {
      const expandedOutput = expandObjectPasteReferences(sessionId, output);
      if (expandedOutput !== output) {
        return {
          ...content,
          output: expandedOutput,
        };
      }
    }
  }

  return content;
}

/**
 * 递归展开对象中的 PasteReference
 *
 * @param sessionId - 会话 ID
 * @param obj - 任意对象
 * @returns 展开后的对象
 */
function expandObjectPasteReferences(sessionId: string, obj: unknown): unknown {
  if (isPasteReference(obj)) {
    const expandedText = retrievePasteContent(sessionId, obj.hash);
    return expandedText ?? obj.preview ?? `[Paste content not found: ${obj.hash.slice(0, 8)}...]`;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => expandObjectPasteReferences(sessionId, item));
  }

  if (obj && typeof obj === 'object') {
    const expanded: Record<string, unknown> = {};
    let changed = false;

    for (const [key, value] of Object.entries(obj)) {
      const expandedValue = expandObjectPasteReferences(sessionId, value);
      expanded[key] = expandedValue;
      if (expandedValue !== value) {
        changed = true;
      }
    }

    return changed ? expanded : obj;
  }

  return obj;
}

/**
 * 展开消息中的所有 PasteReference
 *
 * @param sessionId - 会话 ID
 * @param message - 原始消息
 * @returns 展开后的消息（不修改原始消息）
 *
 * @example
 * ```ts
 * const messages = await loadSessionMessages(sessionId);
 * const expanded = messages.map(msg => expandPasteReferences(sessionId, msg));
 * ```
 */
export function expandPasteReferences(sessionId: string, message: Message): Message {
  const expandedContent = message.content.map((content) =>
    expandContentPasteReferences(sessionId, content),
  );

  // 检查是否有内容被展开
  const hasChanges = expandedContent.some((expanded, index) => expanded !== message.content[index]);

  if (!hasChanges) {
    return message;
  }

  return {
    ...message,
    content: expandedContent,
  };
}

/**
 * 批量展开多条消息
 *
 * @param sessionId - 会话 ID
 * @param messages - 消息数组
 * @returns 展开后的消息数组
 */
export function expandPasteReferencesInMessages(sessionId: string, messages: Message[]): Message[] {
  return messages.map((message) => expandPasteReferences(sessionId, message));
}

/**
 * 从消息中提取所有 PasteReference 的哈希值
 * 用于垃圾回收时确定哪些内容仍在使用
 *
 * @param messages - 消息数组
 * @returns 哈希值集合
 */
export function extractPasteReferencesFromMessages(messages: Message[]): Set<string> {
  const hashes = new Set<string>();

  function extractFromContent(content: MessageContent): void {
    if (content.type === 'text' && typeof content.text === 'object') {
      if (isPasteReference(content.text)) {
        hashes.add((content.text as PasteReference).hash);
      }
    }

    if (content.type === 'text' && typeof content.text === 'string') {
      try {
        const parsed = JSON.parse(content.text);
        if (isPasteReference(parsed)) {
          hashes.add(parsed.hash);
        }
      } catch {
        // 不是 JSON，忽略
      }
    }

    if (content.type === 'tool_call' && typeof content.input === 'object' && content.input) {
      extractFromObject(content.input);
    }

    if (content.type === 'tool_result') {
      if (typeof content.output === 'string') {
        try {
          const parsed = JSON.parse(content.output);
          if (isPasteReference(parsed)) {
            hashes.add(parsed.hash);
          }
        } catch {
          // 不是 JSON，忽略
        }
      } else if (typeof content.output === 'object' && content.output) {
        extractFromObject(content.output);
      }
    }
  }

  function extractFromObject(obj: unknown): void {
    if (isPasteReference(obj)) {
      hashes.add(obj.hash);
      return;
    }

    if (Array.isArray(obj)) {
      obj.forEach(extractFromObject);
      return;
    }

    if (obj && typeof obj === 'object') {
      Object.values(obj).forEach(extractFromObject);
    }
  }

  for (const message of messages) {
    message.content.forEach(extractFromContent);
  }

  return hashes;
}
