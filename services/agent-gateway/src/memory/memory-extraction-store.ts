/**
 * 自动抽取候选 → 待确认提议的兼容壳。
 *
 * 261101-记忆确认写入与周期整理：正式记忆的每一次变更都必须经用户确认。这里**不再**
 * 直接写 `memories`（历史上 `created` / `updated` 语义即为「已写入」），而是逐候选
 * 创建 `MemoryProposal`；`created` / `updated` 保持字段名以兼容旧调用方与既有测试，
 * 但其含义已改为「产生的待确认提议数」。
 *
 * 本文件严禁 import `createMemory` / `updateMemory`——保留同名壳导出的目的只是保住
 * 既有导入路径（`upsert-extracted-memories-resilience.test.ts`），而不是留第二条写库
 * 旁路。真正的写入路径只有 `memory-commit-service` 的确认门。
 */
import type {
  ExtractedMemoryCandidate,
  MemoryCandidateDecision,
  MemoryScope,
  MemorySettings,
  MemorySourceProvenance,
} from '@openAwork/agent-core';
import {
  evaluateMemoryCandidateForPersistence,
  shouldAskForMemoryConfirmation,
} from '@openAwork/agent-core';
import { scanMemoryWriteContent } from './memory-security-scanner.js';
import { logGatewayWarn } from '../infra/gateway-logger.js';
import type { CreateMemoryProposalOutcome } from './governance/memory-proposal-store.js';
import { createMemoryProposal } from './governance/memory-proposal-store.js';

export interface UpsertExtractedMemoriesResult {
  /** 兼容字段：等于 `proposed`（已提交待确认数量）。 */
  readonly created: number;
  /** 兼容字段：自动抽取的候选只会 `create`，恒为 0（不再直接更新正式记忆）。 */
  readonly updated: number;
  /** 本条调用实际产生的待确认提议数。 */
  readonly proposed: number;
  /** 命中重复抑制（同作用域同内容已有 pending 提议）的候选数。 */
  readonly suppressed: number;
  /** 命中瞬时 / 临时语义被跳过（连提议都不建）的候选数。 */
  readonly transient: number;
  readonly duplicates: number;
  readonly blocked: number;
  readonly reviewed: number;
  readonly rejected: number;
  readonly decisions: readonly MemoryCandidateDecision[];
}

/**
 * 兼容壳：签名与历史实现一致（`userId, candidates, workspaceRoot, settings`）。
 *
 * @param workspaceRoot 工作区根；用于解析失败时的作用域兜底。
 * @param settings 抽取持久化策略阈值。
 * @param scope 显式作用域（团队 / 渠道来源调用方传入）；不传则退化为 user 作用域。
 * @param origin 提议来源，缺省 `auto_extract`。
 * @param provenance 渠道来源信息，命中时作用域归入 `channel_chat`。
 */
export function upsertExtractedMemories(
  userId: string,
  candidates: readonly ExtractedMemoryCandidate[],
  workspaceRoot: string | null = null,
  settings: MemorySettings,
  options?: {
    scope?: MemoryScope;
    origin?: 'auto_extract' | 'manual_extract';
    provenance?: MemorySourceProvenance | null;
    forceAsk?: boolean;
  },
): UpsertExtractedMemoriesResult {
  const origin = options?.origin ?? 'auto_extract';
  const provenance = options?.provenance ?? null;
  const scope: MemoryScope =
    options?.scope ??
    (workspaceRoot ? { type: 'workspace', id: workspaceRoot } : { type: 'user', id: userId });

  const decisions: MemoryCandidateDecision[] = [];
  let blocked = 0;
  let reviewed = 0;
  let rejected = 0;
  let transient = 0;
  let proposed = 0;
  let suppressed = 0;

  for (const candidate of candidates) {
    // 安全扫描：命中注入 / 敏感信息时直接丢弃，保留旧 counts 语义（blocked 计数）。
    const scanKey = scanMemoryWriteContent(candidate.key);
    const scanValue = scanMemoryWriteContent(candidate.value);
    if (!scanKey.ok || !scanValue.ok) {
      blocked += 1;
      continue;
    }

    // 「值不值得问」判断：临时 / 一次性语义直接跳过，连提议都不建。这是用户明确
    // 要求「临时操作不留记录」的核心。`manual_extract`（用户点了立即抽取）例外。
    const forceAsk = options?.forceAsk === true || origin === 'manual_extract';
    if (!forceAsk && !shouldAskForMemoryConfirmation(`${candidate.key}\n${candidate.value}`)) {
      transient += 1;
      continue;
    }

    const decision = evaluateMemoryCandidateForPersistence(candidate, settings);
    decisions.push(decision);

    // 策略判定为「拒绝」（疑似凭证 / 敏感个人信息）→ 连提议都不建：这类内容即便
    // 经用户确认也不该长期留存，故不进确认队列。低置信走 `review`，仍允许提议
    //（由用户在确认时把关），保持既有策略语义。
    if (decision.status === 'reject') {
      rejected += 1;
      continue;
    }

    let outcome: CreateMemoryProposalOutcome;
    try {
      outcome = createMemoryProposal({
        userId,
        action: 'create',
        scope,
        payload: {
          type: candidate.type,
          key: candidate.key,
          value: candidate.value,
          priority: 30,
          confidence: candidate.confidence,
          workspaceRoot,
        },
        origin,
        confidence: candidate.confidence,
        provenance,
      }).outcome;
    } catch (err) {
      logGatewayWarn(
        `[memory-extraction-store] 自动抽取提议创建失败，已跳过该条：${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      continue;
    }

    switch (outcome) {
      case 'created':
        proposed += 1;
        break;
      case 'duplicate':
      case 'suppressed':
        suppressed += 1;
        break;
      case 'unsafe':
        blocked += 1;
        break;
      case 'transient':
        transient += 1;
        break;
      default:
        break;
    }

    // 保留旧 reviewed 归类语义：低置信候选进审阅计数（提议已建，交由用户确认）。
    if (decision.status === 'review') {
      reviewed += 1;
    }
  }

  return {
    created: proposed,
    updated: 0,
    proposed,
    suppressed,
    transient,
    duplicates: 0,
    blocked,
    reviewed,
    rejected,
    decisions,
  };
}
