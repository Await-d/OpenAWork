import { createHash } from 'node:crypto';

import type { Message } from '@openAwork/shared';
import { buildTaskToolTerminalMessage } from '../task/delegated-task-display.js';
import { extractLatestChildSessionSummary } from '../task/task-result-extraction.js';

const MAX_CLIENT_REQUEST_ID_LENGTH = 128;
const DIGEST_LENGTH = 32;

function digestPrefix(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, DIGEST_LENGTH);
}

export function buildDelegatedChildClientRequestId(input: {
  childSessionId: string;
  parentClientRequestId?: string;
}): string {
  const parentClientRequestId = input.parentClientRequestId ?? 'child';
  const legacyId = `task:${parentClientRequestId}:child:${input.childSessionId}`;
  if (legacyId.length <= MAX_CLIENT_REQUEST_ID_LENGTH) {
    return legacyId;
  }

  const parentDigest = digestPrefix(`${parentClientRequestId}\u0000${input.childSessionId}`);
  const hashedParentId = `task:${parentDigest}:child:${input.childSessionId}`;
  if (hashedParentId.length <= MAX_CLIENT_REQUEST_ID_LENGTH) {
    return hashedParentId;
  }

  // 最终兜底：childSessionId 本身超长时同样收敛为摘要，保证结果恒 <= 128。
  return `task:${parentDigest}:child:${digestPrefix(input.childSessionId)}`;
}

export function buildCallOmoAgentBackgroundOutput(input: {
  agent: string;
  description: string;
  sessionId: string;
  status: string;
  taskId: string;
}): string {
  return [
    '后台 agent 任务已成功启动。',
    '',
    `任务 ID：${input.taskId}`,
    `会话 ID：${input.sessionId}`,
    `描述：${input.description}`,
    `Agent：${input.agent}（subagent）`,
    `状态：${input.status}`,
    '',
    '任务完成时系统会主动通知你。',
    `检查进度：调 \`background_output\` 并传 task_id="${input.taskId}"：`,
    '- block=false（默认）：立刻检查状态 - 返回完整状态信息',
    '- block=true：等任务完成（一般不需要，系统会主动通知）',
  ].join('\n');
}

export function buildCallOmoAgentSyncOutput(input: {
  fallbackText?: string;
  isError?: boolean;
  messages: Message[];
  sessionId: string;
}): string {
  // 对齐参考库前台路径（`SubagentCompletion.text`）：只取子代理**最后一条有文本的
  // assistant 消息**。旧实现（`collectRelevantMessageText`）会把子会话全部文本与
  // 工具输出全量拼接，被父会话工具结果整体携带——单次任务即可吃掉大量上下文。
  const body = extractLatestChildSessionSummary(input.messages) || buildFallbackText(input);
  return buildTaskToolTerminalMessage({
    agent: 'subagent',
    errorMessage: input.isError ? body : undefined,
    resultText: input.isError ? undefined : body,
    sessionId: input.sessionId,
    status: input.isError ? 'failed' : 'done',
  });
}

function buildFallbackText(input: { fallbackText?: string; isError?: boolean }): string {
  const fallback = input.fallbackText?.trim();
  if (fallback) {
    if (input.isError && !/^error:/iu.test(fallback) && !/^\[(?:错误|error):/iu.test(fallback)) {
      return `Error: ${fallback}`;
    }
    return fallback;
  }

  return '错误：未找到助手或工具响应';
}
