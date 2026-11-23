import type {
  MemoryEntry,
  MemoryProposalAction,
  MemoryProposalPayload,
  MemoryScope,
  MemoryScopeType,
  MemorySourceProvenance,
} from './types.js';
import { normalizeMemoryKey } from './helpers.js';

/**
 * 记忆治理纯函数层（261101-记忆确认写入与周期整理）。
 *
 * 这里只放**无副作用、无 IO、无 Node API** 的判定与归一化逻辑，供 gateway 治理
 * 模块、维护任务与前端共用。所有「是否允许写入」的结论都只是**提案判定**，
 * 不构成授权：正式写入必须经 gateway 的一次性确认门。
 */

export const MEMORY_SCOPE_TYPES: readonly MemoryScopeType[] = [
  'user',
  'workspace',
  'team',
  'channel_chat',
];

const SCOPE_TYPE_SET = new Set<string>(MEMORY_SCOPE_TYPES);

export function isMemoryScopeType(value: unknown): value is MemoryScopeType {
  return typeof value === 'string' && SCOPE_TYPE_SET.has(value);
}

/** 作用域稳定键，用于索引、查重与日志。 */
export function memoryScopeKey(scope: MemoryScope): string {
  return `${scope.type}:${scope.id}`;
}

export function userMemoryScope(userId: string): MemoryScope {
  return { type: 'user', id: userId };
}

/**
 * 规范化工作区作用域 id。
 *
 * 去尾斜杠、折叠重复分隔符、统一分隔符，避免同一目录因写法不同生成两个作用域，
 * 进而让同键记忆互相不可见或互相覆盖。
 */
export function normalizeWorkspaceScopeId(workspaceRoot: string): string {
  const unified = workspaceRoot.trim().replace(/\\/g, '/');
  const collapsed = unified.replace(/\/{2,}/g, '/');
  if (collapsed === '/' || /^[A-Za-z]:\/$/.test(collapsed)) {
    return collapsed;
  }
  return collapsed.replace(/\/+$/, '');
}

export function workspaceMemoryScope(workspaceRoot: string): MemoryScope {
  return { type: 'workspace', id: normalizeWorkspaceScopeId(workspaceRoot) };
}

export function teamMemoryScope(teamWorkspaceId: string): MemoryScope {
  return { type: 'team', id: teamWorkspaceId.trim() };
}

/**
 * 渠道对话作用域键。
 *
 * 必须同时包含渠道实例与 chatId：只用 chatId 会让两个渠道实例上同名 chat 串用。
 */
export function memoryChannelScopeKey(provenance: MemorySourceProvenance): string {
  const instance = provenance.channelInstanceId.trim();
  const chatId = provenance.chatId.trim();
  return `channel:${provenance.platform}:${instance}:chat:${chatId}`;
}

export function channelChatMemoryScope(provenance: MemorySourceProvenance): MemoryScope {
  return { type: 'channel_chat', id: memoryChannelScopeKey(provenance) };
}

/**
 * 渠道来源是否可视为「私聊」。
 *
 * 只有明确私聊才允许把「待确认记忆」通知发到渠道；未知类型按群处理（更保守），
 * 避免把私人记忆的存在感暴露在群里。
 */
export function isPrivateChannelChat(provenance: MemorySourceProvenance): boolean {
  return provenance.chatType === 'private';
}

export interface ResolveProposalScopeInput {
  userId: string;
  provenance?: MemorySourceProvenance | null;
  teamWorkspaceId?: string | null;
  workspaceRoot?: string | null;
}

/**
 * 解析候选记忆应落入的作用域。
 *
 * 顺序即优先级：渠道来源 > 团队 > 工作区 > 用户。渠道优先是刻意的——即使渠道会
 * 话绑定了工作区，群成员的话也默认留在该对话作用域，不直接落进项目/个人记忆。
 */
export function resolveProposalScope(input: ResolveProposalScopeInput): MemoryScope {
  if (input.provenance) {
    return channelChatMemoryScope(input.provenance);
  }
  const teamWorkspaceId = input.teamWorkspaceId?.trim();
  if (teamWorkspaceId) {
    return teamMemoryScope(teamWorkspaceId);
  }
  const workspaceRoot = input.workspaceRoot?.trim();
  if (workspaceRoot) {
    return workspaceMemoryScope(workspaceRoot);
  }
  return userMemoryScope(input.userId);
}

const TRANSIENT_CONTEXT_PATTERNS: readonly RegExp[] = [
  /(?:今天|明天|昨天|这次|本次|当前|临时|刚刚|马上|稍后|这轮|这一轮|这个会话|本轮|这次对话|先这样|先试试)/,
  /\b(?:today|tomorrow|yesterday|this time|current|temporary|temp|right now|for now|for this|this session|this chat|just this once)\b/i,
  /(?:报错|错误日志|stack trace|traceback|调试|临时分支|当前分支)/i,
  // 明确的一次性执行描述：工具输出 / 执行流水不应沉淀为长期记忆。
  /(?:重启了一下|重跑了|跑了一次|手工执行|刚执行过|执行了以下命令)/,
  /^```/,
];

const LONG_TERM_INTENT_PATTERNS: readonly RegExp[] = [
  /(?:以后|默认|一直|永远|每次|后续|今后|统一|一律|都使用|都走|规范|约定|记住|请记下|别再|不要再)/,
  /\b(?:always|default|from now on|never|remember|going forward|henceforth|convention|standard)\b/i,
];

/**
 * 是否含一次性/临时语义。
 *
 * 命中即**不生成提议**（连询问都不做）：临时操作如果被记下来，就是用户明确要避免
 * 的「没有作用的记录」。注意这里只做「值不值得问」的判断，不产生写入权限。
 */
export function hasTransientContext(text: string): boolean {
  return TRANSIENT_CONTEXT_PATTERNS.some((pattern) => pattern.test(text));
}

/** 是否含明确的长期语义（“以后/默认/记住”等）。 */
export function hasLongTermIntent(text: string): boolean {
  return LONG_TERM_INTENT_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * 是否值得就这条候选询问用户。
 *
 * 规则（保守）：
 * - 有临时语义 → 不问；
 * - 有长期语义 → 问；
 * - 其余（普通陈述）→ 不问，除非调用方显式要求（`forceAsk`：例如用户在界面上
 *   点了「立即抽取」）。
 */
export function shouldAskForMemoryConfirmation(
  text: string,
  options?: { forceAsk?: boolean },
): boolean {
  if (hasTransientContext(text)) {
    return false;
  }
  if (options?.forceAsk) {
    return true;
  }
  return hasLongTermIntent(text);
}

/** 规范化候选指纹：同一内容在同一作用域下的稳定标识，用于抑制重复询问。 */
export function memoryCandidateFingerprint(input: {
  type: string;
  key: string;
  value: string;
}): string {
  return `${input.type}:${normalizeMemoryKey(input.key)}:${normalizeMemoryKey(input.value)}`;
}

export function memoryProposalPayloadFingerprint(payload: MemoryProposalPayload): string {
  return memoryCandidateFingerprint({
    type: payload.type ?? 'fact',
    key: payload.key ?? payload.name ?? '',
    value: payload.value ?? payload.body ?? '',
  });
}

export interface MemoryDuplicateGroup {
  normalizedKey: string;
  entries: MemoryEntry[];
}

/**
 * 精确重复分组：同一作用域内 type + 规范化 key 相同、规范化 value 相同。
 *
 * 只做「完全重复」检测——语义相近由人工判断，避免自动把条件不同的两条合并。
 */
export function detectExactDuplicateGroups(
  entries: readonly MemoryEntry[],
): MemoryDuplicateGroup[] {
  const byKey = new Map<string, MemoryEntry[]>();
  for (const entry of entries) {
    const normalizedKey = JSON.stringify([
      memoryScopeKey(entry.scope),
      entry.type,
      normalizeMemoryKey(entry.key),
      entry.workspaceRoot,
      entry.teamWorkspaceId,
      entry.roleLayers === null ? null : [...entry.roleLayers].sort(),
      entry.validUntil,
    ]);
    const bucket = byKey.get(normalizedKey);
    if (bucket) {
      bucket.push(entry);
    } else {
      byKey.set(normalizedKey, [entry]);
    }
  }

  const groups: MemoryDuplicateGroup[] = [];
  for (const [normalizedKey, bucket] of byKey) {
    if (bucket.length < 2) continue;
    const byValue = new Map<string, MemoryEntry[]>();
    for (const entry of bucket) {
      const normalizedValue = normalizeMemoryKey(entry.value);
      const valueBucket = byValue.get(normalizedValue);
      if (valueBucket) {
        valueBucket.push(entry);
      } else {
        byValue.set(normalizedValue, [entry]);
      }
    }
    for (const valueBucket of byValue.values()) {
      if (valueBucket.length >= 2) {
        groups.push({ normalizedKey, entries: valueBucket });
      }
    }
  }
  return groups;
}

export interface MemoryConflictGroup {
  normalizedKey: string;
  entries: MemoryEntry[];
}

/**
 * 同键不同值：可能的新旧冲突，也可能只是适用条件不同。
 *
 * 这里只识别、不裁决——绝不按「更新时间更新」「置信度更高」自动覆盖旧值。
 */
export function detectValueConflicts(entries: readonly MemoryEntry[]): MemoryConflictGroup[] {
  const byKey = new Map<string, MemoryEntry[]>();
  for (const entry of entries) {
    const normalizedKey = `${entry.type}:${normalizeMemoryKey(entry.key)}`;
    const bucket = byKey.get(normalizedKey);
    if (bucket) {
      bucket.push(entry);
    } else {
      byKey.set(normalizedKey, [entry]);
    }
  }

  const groups: MemoryConflictGroup[] = [];
  for (const [normalizedKey, bucket] of byKey) {
    if (bucket.length < 2) continue;
    const distinctValues = new Set(bucket.map((entry) => normalizeMemoryKey(entry.value)));
    if (distinctValues.size >= 2) {
      groups.push({ normalizedKey, entries: bucket });
    }
  }
  return groups;
}

/** 疑似临时信息误入：正式记忆里出现一次性语义 → 建议归档（需确认）。 */
export function detectTransientEntries(entries: readonly MemoryEntry[]): MemoryEntry[] {
  return entries.filter((entry) => hasTransientContext(`${entry.key}\n${entry.value}`));
}

/** 提议是否已过确认期。 */
export function isProposalExpired(expiresAt: string, now: Date): boolean {
  const parsed = Date.parse(expiresAt);
  if (!Number.isFinite(parsed)) {
    // 解析不了的过期时间按「已过期」处理：宁可让用户重新确认一次，
    // 也不要让一条无法判定有效期的提议长期挂着。
    return true;
  }
  return parsed <= now.getTime();
}

export const MEMORY_PROPOSAL_DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** 提议过期时间。 */
export function memoryProposalExpiry(
  createdAt: Date,
  ttlMs = MEMORY_PROPOSAL_DEFAULT_TTL_MS,
): string {
  return new Date(createdAt.getTime() + ttlMs).toISOString();
}

const PROPOSAL_ACTIONS = new Set<string>([
  'create',
  'update',
  'archive',
  'restore',
  'merge',
  'rule',
]);

export function isMemoryProposalAction(value: unknown): value is MemoryProposalAction {
  return typeof value === 'string' && PROPOSAL_ACTIONS.has(value);
}

/**
 * 该动作是否改变正式记忆内容/生效状态。
 *
 * `merge` 与 `archive` 都算：合并会改写正文，归档会改变注入范围，两者都必须由用户
 * 确认，不能由后台任务自行执行。
 */
export function proposalActionChangesContent(action: MemoryProposalAction): boolean {
  return action !== 'rule';
}
