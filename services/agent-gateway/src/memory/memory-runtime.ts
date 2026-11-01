import type { Message, MessageContent } from '@openAwork/shared';
import type { MemorySourceProvenance } from '@openAwork/agent-core';
import { buildMemoryInjectionBlock, extractMemoriesFromText } from '@openAwork/agent-core';
import {
  hasExtractionLog,
  insertExtractionLog,
  listEnabledMemoriesForScopeInjection,
  readMemorySettings,
} from './memory-store.js';
import { upsertExtractedMemories } from './memory-extraction-store.js';
import {
  resolveAllowedInjectionScopeObjects,
  resolveAllowedInjectionScopes,
  resolveProposalScopeForSession,
} from './governance/memory-scope-resolver.js';
import { readLatestChannelProvenance } from './governance/memory-provenance-store.js';
import { listMemoryRulesForInjection } from './governance/memory-rule-store.js';
import {
  listSessionMessagesByRequestScope,
  listSessionMessagesV2,
} from '../message/message-v2-adapter.js';
import { logGatewayWarn } from '../infra/gateway-logger.js';

function readWorkspaceRootFromMetadata(metadataJson: string): string | null {
  try {
    const metadata = JSON.parse(metadataJson) as Record<string, unknown>;
    return typeof metadata['workingDirectory'] === 'string' ? metadata['workingDirectory'] : null;
  } catch {
    return null;
  }
}

function extractTextContent(content: MessageContent): string | null {
  if (content.type !== 'text') {
    return null;
  }

  const normalized = content.text.trim();
  return normalized.length > 0 ? normalized : null;
}

/**
 * 会话记忆注入块。
 *
 * 261101 改造：改为**按作用域白名单注入**——先由 `resolveAllowedInjectionScopes`
 * 判定本次会话允许看到哪些作用域，再按作用域拉取启用记忆。渠道会话因此不会再注入
 * owner 的个人记忆（历史实现直接按 user 拉全量，构成越权面）。
 */
export function buildMemoryBlockForSession(
  userId: string,
  metadataJson: string,
  provenance?: MemorySourceProvenance | null,
): string | null {
  const settings = readMemorySettings(userId);
  if (!settings.enabled) {
    return null;
  }

  const scopeInput = { userId, metadataJson, provenance: provenance ?? null };
  // 白名单键（string[]）用于注入块的 allowedScopes 过滤；对象数组用于按作用域查询。
  const allowedScopes = resolveAllowedInjectionScopes(scopeInput);
  if (allowedScopes.length === 0) {
    return null;
  }

  return combineMemoryBlocks(
    buildMemoryEntriesBlock(userId, metadataJson, settings, allowedScopes, scopeInput),
    buildMemoryRulesBlock(userId, allowedScopes, settings.maxTokenBudget),
  );
}

function buildMemoryEntriesBlock(
  userId: string,
  metadataJson: string,
  settings: ReturnType<typeof readMemorySettings>,
  allowedScopes: readonly string[],
  scopeInput: { userId: string; metadataJson: string; provenance: MemorySourceProvenance | null },
): string | null {
  const memories = listEnabledMemoriesForScopeInjection(
    userId,
    resolveAllowedInjectionScopeObjects(scopeInput),
    settings.minConfidence,
  );
  if (memories.length === 0) {
    return null;
  }

  return buildMemoryInjectionBlock(memories, {
    enabled: true,
    maxTokenBudget: settings.maxTokenBudget,
    minConfidence: settings.minConfidence,
    workspaceRoot: readWorkspaceRootFromMetadata(metadataJson),
    allowedScopes,
    userId,
  });
}

/**
 * 已确认规则注入块。
 *
 * 261101：规则原先只落库、没有任何消费方（等于写了不生效）。这里把「已确认且落在
 * 本次允许作用域内」的规则注入上下文，使规则真的起作用；未确认的规则永远不会出现在
 * 这里——确认门是规则唯一的生效路径。
 *
 * 规则正文只做一处必要的加固：剔除任何伪造的 `</user-memory-rules>` / `</user-memory>`
 * 结束标签，避免正文里的标签把注入块提前闭合（正文本身是用户确认的内容，不做转义，
 * 与既有记忆块的处理保持一致）。
 */
function buildMemoryRulesBlock(
  userId: string,
  allowedScopes: readonly string[],
  maxTokenBudget: number,
): string | null {
  const rules = listMemoryRulesForInjection(userId, allowedScopes);
  if (rules.length === 0) {
    return null;
  }

  const lines: string[] = [];
  for (const rule of rules) {
    const body = rule.body.replace(/<\/(?:user-memory-rules|user-memory)\s*>/gi, '');
    const line = `- ${rule.name}: ${body}`;
    lines.push(line);
  }
  if (lines.length === 0) {
    return null;
  }

  const block = `<user-memory-rules>\n${lines.join('\n')}\n</user-memory-rules>`;
  // 与记忆块共用同一个预算语义：超预算就整体不注入，避免规则把上下文挤爆。
  if (block.length > maxTokenBudget * 4) {
    logGatewayWarn('[memory-runtime] 规则注入块超出预算，已跳过本轮规则注入。');
    return null;
  }
  return block;
}

function combineMemoryBlocks(memoryBlock: string | null, rulesBlock: string | null): string | null {
  if (memoryBlock && rulesBlock) {
    return `${memoryBlock}\n${rulesBlock}`;
  }
  return memoryBlock ?? rulesBlock;
}

export function buildMemoryExtractionTextFromMessages(messages: Message[]): string {
  return messages
    .filter((message) => message.role === 'user')
    .flatMap((message) => message.content.map(extractTextContent))
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join('\n\n');
}

export function buildMemoryExtractionTextForRequest(input: {
  clientRequestId: string;
  sessionId: string;
  userId: string;
}): string {
  return buildMemoryExtractionTextFromMessages(listSessionMessagesByRequestScope(input));
}

export function buildMemoryExtractionTextForSession(input: {
  sessionId: string;
  userId: string;
}): string {
  return buildMemoryExtractionTextFromMessages(
    listSessionMessagesV2({
      sessionId: input.sessionId,
      userId: input.userId,
      statuses: ['final', 'error'],
    }),
  );
}

/**
 * 本轮请求结束后的自动抽取。
 *
 * **不再写正式记忆**：逐候选创建待确认提议（`origin: 'auto_extract'`），候选若命中
 * 临时 / 一次性语义则连提议都不建。返回字段向后兼容：
 * - `created` / `updated` 语义改为「已提交待确认的提议数」（`updated` 恒为 0），
 *   不再假报写入成功；
 * - 新增 `proposed` / `suppressed` / `transient` 便于上游区分。
 */
export function autoExtractMemoriesForRequest(input: {
  clientRequestId: string;
  metadataJson: string;
  sessionId: string;
  userId: string;
  provenance?: MemorySourceProvenance | null;
}): {
  blocked: number;
  created: number;
  duplicates: number;
  proposed: number;
  rejected: number;
  reviewed: number;
  skipped: boolean;
  suppressed: number;
  transient: number;
  updated: number;
} {
  const empty = {
    blocked: 0,
    created: 0,
    duplicates: 0,
    proposed: 0,
    rejected: 0,
    reviewed: 0,
    suppressed: 0,
    transient: 0,
    updated: 0,
  };

  const settings = readMemorySettings(input.userId);
  if (!settings.enabled || !settings.autoExtract) {
    return { ...empty, skipped: true };
  }

  if (hasExtractionLog(input.userId, input.sessionId, input.clientRequestId)) {
    return { ...empty, skipped: true };
  }

  const text = buildMemoryExtractionTextForRequest(input);
  if (text.trim().length === 0) {
    insertExtractionLog(input.userId, input.sessionId, input.clientRequestId, 0);
    return { ...empty, skipped: true };
  }

  const workspaceRoot = readWorkspaceRootFromMetadata(input.metadataJson);
  const provenance =
    input.provenance !== undefined
      ? input.provenance
      : (readLatestChannelProvenance(input.sessionId) ?? null);
  const scope = resolveProposalScopeForSession({
    userId: input.userId,
    metadataJson: input.metadataJson,
    provenance,
  });
  const candidates = extractMemoriesFromText(text);
  const result = upsertExtractedMemories(input.userId, candidates, workspaceRoot, settings, {
    scope,
    origin: 'auto_extract',
    provenance,
  });
  insertExtractionLog(input.userId, input.sessionId, input.clientRequestId, result.proposed);
  return {
    blocked: result.blocked,
    created: result.created,
    duplicates: result.duplicates,
    proposed: result.proposed,
    rejected: result.rejected,
    reviewed: result.reviewed,
    skipped: false,
    suppressed: result.suppressed,
    transient: result.transient,
    updated: result.updated,
  };
}
