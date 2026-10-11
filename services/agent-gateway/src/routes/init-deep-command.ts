import type { CommandExecutionResult, Message } from '@openAwork/shared';
import type { AgentTaskManagerImpl } from '@openAwork/agent-core';
import { DirectoryAgentsInjectorImpl } from '@openAwork/agent-core';
import { WORKSPACE_ROOT, sqliteRun } from '../infra/db.js';
import { appendCommandCardArtifacts, mergeMetadata } from './command-executors.js';

export async function executeInitDeepCommand(params: {
  args: string[];
  commandId: string;
  graph: Awaited<ReturnType<AgentTaskManagerImpl['loadOrCreate']>>;
  messages: Message[];
  metadataJson: string;
  rawInput?: string;
  sessionId: string;
  userId: string;
}): Promise<CommandExecutionResult> {
  const injector = new DirectoryAgentsInjectorImpl();
  const entries = await injector.collectAllAgentsFiles(WORKSPACE_ROOT, WORKSPACE_ROOT);
  const injectionBlock = injector.buildInjectionBlock(entries);
  const fileCount = entries.length;
  const summary =
    fileCount > 0
      ? `已注入 ${fileCount} 条 Instructions 上下文到会话。`
      : '未找到可注入的 Instructions 文件，会话上下文未更新。';

  const metadata = mergeMetadata(params.metadataJson, {
    initDeepContext: injectionBlock,
    initDeepFileCount: fileCount,
    initDeepAt: Date.now(),
  });
  const card = {
    type: 'status' as const,
    title: '/init-deep 完成',
    message: `${summary}\n\nInstructions 摘要（前 300 字符）：\n${injectionBlock.slice(0, 300)}${injectionBlock.length > 300 ? '…' : ''}`,
    tone: 'info' as const,
  };
  appendCommandCardArtifacts({
    sessionId: params.sessionId,
    userId: params.userId,
    card,
  });
  sqliteRun(
    "UPDATE sessions SET metadata_json = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
    [JSON.stringify(metadata), params.sessionId, params.userId],
  );
  return {
    sessionId: params.sessionId,
    events: [
      {
        type: 'audit_ref',
        auditLogId: `${params.sessionId}:${params.commandId}:init-deep`,
        eventId: `${params.sessionId}:${params.commandId}:init-deep`,
        runId: `command:${params.sessionId}:${params.commandId}`,
        occurredAt: Date.now(),
      },
    ],
    card,
  };
}
