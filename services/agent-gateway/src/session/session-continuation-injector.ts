/**
 * Session Continuation Injector
 *
 * 为中断的对话注入续写消息，使 AI 能够自动继续响应。
 *
 * 参考实现：
 * /home/await/project/OpenAWork/temp/claude-code-sourcemap/restored-src/src/utils/conversationRecovery.ts
 * (行 209-224: 注入续写消息逻辑)
 */

import type { Message, MessageContent } from '@openAwork/shared';
import { randomUUID } from 'node:crypto';

/**
 * 创建续写消息
 *
 * 这是一个特殊的用户消息，标记为 is_continuation，
 * 提示 AI 从中断的地方继续响应。
 *
 * @returns 续写消息
 */
export function createContinuationMessage(): Message {
  const content: MessageContent[] = [
    {
      type: 'text',
      text: 'Continue from where you left off.',
    },
  ];

  return {
    id: randomUUID(),
    role: 'user',
    content,
    createdAt: Date.now(),
    // 扩展字段，数据库已支持，类型暂不包含
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error - 扩展字段
    isMeta: true,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error - 扩展字段
    is_continuation: true,
  };
}

/**
 * 检查消息是否为续写消息
 */
export function isContinuationMessage(message: Message): boolean {
  // @ts-expect-error - 扩展字段
  return message.is_continuation === true;
}

/**
 * 为消息列表注入续写消息
 *
 * 在最后一条相关消息后插入续写提示，跳过尾部的系统消息和进度消息
 *
 * @param messages 原始消息列表
 * @returns 注入续写消息后的新列表
 */
export function injectContinuationMessage(messages: Message[]): Message[] {
  if (messages.length === 0) {
    return [createContinuationMessage()];
  }

  // 找到最后一条非系统/非进度消息的位置
  let insertIdx = messages.length;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!;
    // @ts-expect-error - 可能存在的内部字段
    if (msg.role !== 'system' && !msg.isProgress && !msg.isMeta) {
      insertIdx = i + 1;
      break;
    }
  }

  // 插入续写消息
  const newMessages = [...messages];
  newMessages.splice(insertIdx, 0, createContinuationMessage());
  return newMessages;
}

/**
 * 移除续写消息
 *
 * 用于清理已处理的续写标记
 */
export function removeContinuationMessages(messages: Message[]): Message[] {
  return messages.filter((msg) => !isContinuationMessage(msg));
}
