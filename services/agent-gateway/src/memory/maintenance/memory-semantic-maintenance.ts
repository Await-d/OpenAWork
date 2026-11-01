import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { MemoryEntry, MemoryScope } from '@openAwork/agent-core';
import {
  estimateTokenCount,
  evaluateMemoryCandidateForPersistence,
  memoryScopeKey,
} from '@openAwork/agent-core';
import { sqliteTransaction } from '../../infra/db.js';
import { getMemoryById, listActiveMemoriesForScope, readMemorySettings } from '../memory-store.js';
import { scanMemoryWriteContent } from '../memory-security-scanner.js';
import { createMemoryProposal } from '../governance/memory-proposal-store.js';
import {
  generateMemorySemanticSuggestions,
  type MemorySemanticGenerator,
} from './memory-semantic-llm.js';
import {
  claimMemorySemanticAnalysis,
  completeMemorySemanticAnalysis,
  ownsMemorySemanticAnalysis,
  recordMemorySemanticTokens,
  releaseMemorySemanticAnalysis,
} from './memory-semantic-store.js';

const suggestionSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('update'),
      targetId: z.string().min(1).max(200),
      value: z.string().trim().min(1).max(4000),
      reason: z.string().trim().min(1).max(500),
    })
    .strict(),
  z
    .object({
      action: z.literal('archive'),
      targetId: z.string().min(1).max(200),
      reason: z.string().trim().min(1).max(500),
    })
    .strict(),
]);
const responseSchema = z.object({ suggestions: z.array(suggestionSchema).max(10) }).strict();

export interface MemorySemanticResult {
  proposed: number;
  skipped: boolean;
  note: string;
}

function eligibleEntries(userId: string, scope: MemoryScope, now: Date): MemoryEntry[] {
  return listActiveMemoriesForScope(userId, scope).filter((entry) => {
    if (entry.validUntil && !(Date.parse(entry.validUntil) > now.getTime())) return false;
    const decision = evaluateMemoryCandidateForPersistence(
      {
        type: entry.type,
        key: entry.key,
        value: entry.value,
        confidence: entry.confidence,
      },
      { autoWriteMinConfidence: 0, reviewLowConfidence: true },
    );
    return (
      decision.reason !== 'sensitive_information' &&
      scanMemoryWriteContent(entry.key).ok &&
      scanMemoryWriteContent(entry.value).ok
    );
  });
}

function boundedInput(entries: MemoryEntry[]): { entries: MemoryEntry[]; content: string } {
  const selected: MemoryEntry[] = [];
  let content = '[]';
  for (const entry of entries.slice(0, 100)) {
    const next = [...selected, entry];
    const json = JSON.stringify(
      next.map(({ id, revision, type, key, value }) => ({ id, revision, type, key, value })),
    );
    if (estimateTokenCount(json) > 12_000) break;
    selected.push(entry);
    content = json;
  }
  return { entries: selected, content };
}

export async function runMemorySemanticAnalysis(input: {
  userId: string;
  scope: MemoryScope;
  now?: Date;
  generate?: MemorySemanticGenerator;
}): Promise<MemorySemanticResult> {
  const skipped = (note: string): MemorySemanticResult => ({ proposed: 0, skipped: true, note });
  const settings = readMemorySettings(input.userId);
  if (!settings.enabled || settings.semanticMaintenance !== true) return skipped('语义整理未开启');
  const now = input.now ?? new Date();
  const { entries, content } = boundedInput(eligibleEntries(input.userId, input.scope, now));
  if (entries.length < 2) return skipped('可检查记忆少于两条');
  const fingerprint = createHash('sha256').update(content).digest('hex');
  const scopeKey = memoryScopeKey(input.scope);
  const token = claimMemorySemanticAnalysis(input.userId, scopeKey, fingerprint, now);
  if (!token) return skipped('输入未变化、正在处理或每日调用预算已用尽');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  timer.unref?.();
  const startedAt = Date.now();
  const currentTime = () => new Date(now.getTime() + Date.now() - startedAt);
  try {
    const generation = input.generate ?? generateMemorySemanticSuggestions;
    const result = await generation(input.userId, content, controller.signal);
    if (!result || controller.signal.aborted) return skipped('模型未配置或分析已取消');
    recordMemorySemanticTokens(input.userId, now, result.inputTokens, result.outputTokens);
    if (result.text.length > 32_000) return skipped('模型响应超过限制');
    const json = result.text
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '');
    let raw: unknown;
    try {
      raw = JSON.parse(json);
    } catch {
      return skipped('模型未返回合法 JSON，不生成建议');
    }
    const parsed = responseSchema.safeParse(raw);
    if (!parsed.success) return skipped('模型响应不符合建议契约，不生成建议');
    return sqliteTransaction(() => {
      const latestSettings = readMemorySettings(input.userId);
      if (
        !latestSettings.enabled ||
        latestSettings.semanticMaintenance !== true ||
        !ownsMemorySemanticAnalysis(input.userId, scopeKey, token, currentTime())
      ) {
        return skipped('授权或租约已改变，结果已丢弃');
      }
      const changed = entries.some((snapshot) => {
        const target = getMemoryById(input.userId, snapshot.id);
        return (
          !target ||
          target.revision !== snapshot.revision ||
          !target.enabled ||
          target.lifecycle !== 'active' ||
          memoryScopeKey(target.scope) !== scopeKey
        );
      });
      if (changed) return skipped('分析输入已变化，丢弃本次全部结果');
      const snapshots = new Map(entries.map((entry) => [entry.id, entry]));
      const seen = new Set<string>();
      let proposed = 0;
      for (const suggestion of parsed.data.suggestions) {
        if (seen.has(suggestion.targetId)) continue;
        seen.add(suggestion.targetId);
        const snapshot = snapshots.get(suggestion.targetId);
        const target = snapshot ? getMemoryById(input.userId, snapshot.id) : undefined;
        if (
          !snapshot ||
          !target ||
          target.revision !== snapshot.revision ||
          !target.enabled ||
          target.lifecycle !== 'active' ||
          memoryScopeKey(target.scope) !== scopeKey
        )
          continue;
        const safeReason = evaluateMemoryCandidateForPersistence(
          {
            type: 'fact',
            key: 'reason',
            value: suggestion.reason,
            confidence: 1,
          },
          { autoWriteMinConfidence: 0, reviewLowConfidence: true },
        );
        if (
          safeReason.reason === 'sensitive_information' ||
          !scanMemoryWriteContent(suggestion.reason).ok
        )
          continue;
        if (suggestion.action === 'update') {
          if (suggestion.value === target.value) continue;
          const decision = evaluateMemoryCandidateForPersistence(
            {
              type: target.type,
              key: target.key,
              value: suggestion.value,
              confidence: 1,
            },
            { autoWriteMinConfidence: 0, reviewLowConfidence: true },
          );
          if (decision.reason === 'sensitive_information') continue;
        }
        const outcome = createMemoryProposal({
          userId: input.userId,
          scope: input.scope,
          action: suggestion.action,
          targetMemoryId: target.id,
          expectedRevision: target.revision,
          origin: 'maintenance',
          now: currentTime(),
          payload: {
            type: target.type,
            key: target.key,
            value: suggestion.action === 'update' ? suggestion.value : target.value,
            workspaceRoot: target.workspaceRoot,
            teamWorkspaceId: target.teamWorkspaceId,
            roleLayers: target.roleLayers,
          },
          reason: `模型语义整理建议（尚未修改记忆）：${suggestion.reason}`,
        });
        if (outcome.outcome === 'created') proposed += 1;
      }
      completeMemorySemanticAnalysis(input.userId, scopeKey, token, fingerprint);
      return { proposed, skipped: false, note: `语义整理生成 ${proposed} 条待确认建议` };
    });
  } finally {
    clearTimeout(timer);
    releaseMemorySemanticAnalysis(input.userId, scopeKey, token);
  }
}
