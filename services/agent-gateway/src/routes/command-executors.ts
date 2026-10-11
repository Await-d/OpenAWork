import { randomUUID } from 'node:crypto';
import type { CommandExecutionResult, Message } from '@openAwork/shared';
import { AgentTaskManagerImpl } from '@openAwork/agent-core';
import { appendSessionMessageV2 as appendSessionMessage } from '../message/message-v2-adapter.js';
import { extractMessageText } from './message-text-utils.js';

/**
 * 命令执行器的共享契约（提取自 commands.ts，拆分轮次 2/4）。
 *
 * 所有命令执行器统一以 `CommandParams` 描述入参；任务图/任务类型
 * 与 `AgentTaskManagerImpl` 的返回值对齐，避免各执行器文件各自
 * 写 `Awaited<ReturnType<...>>` 的内联类型。
 *
 * 跨文件共享的纯工具（`mergeMetadata`、`parseStoredJson`、
 * `appendCommandCardArtifacts`、`extractLatestUserGoal`）集中于此，
 * 避免各执行器重复实现。
 */

export type CommandTaskGraph = Awaited<ReturnType<AgentTaskManagerImpl['loadOrCreate']>>;

export type CommandTask = CommandTaskGraph['tasks'][string];

export interface CommandParams {
  args: string[];
  commandId: string;
  executionId?: string;
  graph: CommandTaskGraph;
  messages: Message[];
  metadataJson: string;
  rawInput?: string;
  sessionId: string;
  userId: string;
}

/**
 * 网关全局唯一的任务管理器实例（原 commands.ts 模块级单例）。
 * 各执行器文件从这里 import，保证仍是同一个实例。
 */
export const taskManager = new AgentTaskManagerImpl();

export function parseStoredJson<T>(value: string | undefined): T | undefined {
  if (!value) {
    return undefined;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

export function mergeMetadata(
  metadataJson: string,
  updates: Record<string, unknown>,
): Record<string, unknown> {
  try {
    const metadata = JSON.parse(metadataJson) as Record<string, unknown>;
    return { ...metadata, ...updates };
  } catch {
    return { ...updates };
  }
}

export function appendCommandCardArtifacts(input: {
  sessionId: string;
  userId: string;
  card: CommandExecutionResult['card'];
}): void {
  if (!input.card || input.card.type === 'compaction') return;

  // V2 single-write path: emit MessageEvents.Created → projector writes
  // `message_v2` and the search index helper upserts FTS. The legacy
  // `sessions.messages_json` column is no longer maintained.
  appendSessionMessage({
    sessionId: input.sessionId,
    userId: input.userId,
    role: 'assistant',
    content: [
      { type: 'text', text: JSON.stringify({ type: input.card.type, payload: input.card }) },
    ],
    clientRequestId: `command-card:${randomUUID()}`,
  });
}

export function extractLatestUserGoal(messages: Message[]): string {
  const latestUserMessage = [...messages]
    .reverse()
    .find((message) => message.role === 'user' && extractMessageText(message).length > 0);
  return extractMessageText(latestUserMessage) || '继续当前实现任务并保持上下文连续。';
}
