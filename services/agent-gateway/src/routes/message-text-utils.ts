import type { Message } from '@openAwork/shared';
import { stringifyToolResultOutput } from '../tools/tool-result-contract.js';

/**
 * 消息文本提取工具（提取自 commands.ts，拆分轮次 2/4）。
 *
 * 服务于 `/compact` 摘要与 Ralph/ULW loop 的上下文续写：
 * 把 V2 消息流（text / tool_call / tool_result / reasoning /
 * modified_files_summary）归一成单行文本并做截断。
 */

export const MAX_EXTRACTED_TOOL_TEXT_CHARS = 8_000;

export function extractMessageText(message: Message | undefined): string {
  if (!message) return '';
  return message.content
    .map((content) => {
      if (content.type === 'text') return content.text;
      if (content.type === 'tool_call')
        return `${content.toolName}: ${normalizeExtractedToolText(content.input)}`;
      if (content.type === 'tool_result') {
        return normalizeExtractedToolText(content.output);
      }
      if (content.type === 'reasoning') {
        return content.text;
      }
      if (content.type === 'modified_files_summary') {
        return `${content.title}: ${content.summary}`;
      }
      return '';
    })
    .join('\n')
    .trim();
}

export function normalizeExtractedToolText(output: unknown): string {
  const serialized = stringifyToolResultOutput(output);
  if (serialized.length <= MAX_EXTRACTED_TOOL_TEXT_CHARS) {
    return serialized;
  }
  return `${serialized.slice(0, MAX_EXTRACTED_TOOL_TEXT_CHARS - 1)}…`;
}

export function summarizeMessages(messages: Message[]): string {
  const content = messages
    .map((message) => extractMessageText(message))
    .filter((text) => text.length > 0);
  if (content.length === 0) {
    return '当前会话没有足够的上下文可压缩。';
  }
  const joined = content.slice(-8).join('\n');
  return joined.length <= 240 ? joined : `${joined.slice(0, 239)}…`;
}
