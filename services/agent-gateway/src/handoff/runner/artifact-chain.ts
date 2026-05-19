/**
 * 260515-team-phase-c · T-02 / T-03 / T-04 / T-05
 * 260518-team-l1.3 改造 2/3 · substate 写入 + clarification 阻塞门禁
 *
 * c 层（PM1）产物链生成 + Constitution Check + handoff result 写入 +
 * [NEEDS CLARIFICATION] 解析与推送 + L1.3 wait-for-inbound 阻塞门禁。
 *
 * 流程：
 *   1. 收到 b→c handoff payload（含 rewrittenIntent / sourceIntent）
 *   2. 设置 substate='drafting_spec'，生成 spec.md 产物
 *   3. 设置 substate='spec_ready'；解析 [NEEDS CLARIFICATION]
 *      - 有标记 → 推送 escalation_request 到 reception inbox + 设置
 *        substate='clarifying'，**阻塞等待 clarification_answer**（L1.3 改造 3）
 *      - 收到回答后注入到 plan 输入中
 *   4. 设置 substate='drafting_plan'，生成 plan.md（注入 constitution + 答案）
 *   5. 设置 substate='plan_ready'；Constitution Check（软警告）
 *   6. 设置 substate='drafting_tasks'，生成 tasks.md
 *   7. 设置 substate='tasks_ready' → 'completed'
 *   8. 把 spec/plan/tasks artifact id 写入 handoff_records.result_json
 *   9. 完成 handoff
 *
 * Phase D 补全（260518）：
 *   - 阻塞门禁：wait-for-inbound 实现（默认 30 分钟超时，超时自动回 plan）
 *   - substate 写入贯穿全程
 */

import { randomUUID } from 'node:crypto';
import { sqliteRun } from '../../db.js';
import { publishTeamEvent } from '../bus/team-events-bus.js';
import type { HandoffRecord, HandoffRoleLayer } from '../store/handoff-store.js';
import { getTeamConstitution } from '../../team/team-constitution-store.js';
import { setSubstate, SUBSTATES_C } from '../store/substate-store.js';
import {
  consumePendingInboundMessage,
  hasPendingCancelSignal,
  submitInboundMessage,
} from '../store/inbound-store.js';
import { assertCanWriteArtifactPhase } from '../capability/layer-capabilities.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ArtifactChainInput {
  userId: string;
  sessionId: string;
  handoff: HandoffRecord;
  /** 用户原始意图（从 handoff payload 提取） */
  sourceIntent: string;
  /** 改写后意图 */
  rewrittenIntent: string;
  /** team workspace id（用于读 constitution） */
  teamWorkspaceId: string | null;
  /** LLM 调用函数（由调用方注入，方便测试 mock） */
  callLlm: (systemPrompt: string, userMessage: string) => Promise<string>;
  /** AbortSignal（来自 watcher.taskRunner）；用于长阻塞的 wait-for-inbound 退出 */
  signal?: AbortSignal;
}

export interface ArtifactChainResult {
  specArtifactId: string;
  planArtifactId: string;
  tasksArtifactId: string;
  clarifications: ClarificationItem[];
  constitutionWarnings: ConstitutionWarning[];
}

export interface ClarificationItem {
  id: string;
  question: string;
  context: string;
}

export interface ConstitutionWarning {
  clause: string;
  status: 'pass' | 'warning' | 'conflict';
  note: string;
}

// ─── [NEEDS CLARIFICATION] 解析 ─────────────────────────────────────────────

export function parseClarifications(content: string): ClarificationItem[] {
  const items: ClarificationItem[] = [];
  const re = /\[NEEDS CLARIFICATION:\s*([^\]]+)\]/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    items.push({
      id: randomUUID(),
      question: match[1]?.trim() ?? '',
      context: content.slice(Math.max(0, match.index - 80), match.index + match[0].length + 80),
    });
  }
  return items;
}

// ─── Constitution Check 解析 ─────────────────────────────────────────────────

export function parseConstitutionCheck(planContent: string): ConstitutionWarning[] {
  const warnings: ConstitutionWarning[] = [];
  // 按行匹配 Markdown 表格行：| clause | ✅/⚠️/❌ | note |
  const lines = planContent.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) continue;
    // 跳过分隔行和表头
    if (trimmed.includes('---')) continue;
    const cells = trimmed
      .slice(1, -1)
      .split('|')
      .map((c) => c.trim());
    if (cells.length < 3) continue;
    const clause = cells[0] ?? '';
    const statusRaw = cells[1] ?? '';
    const note = cells[2] ?? '';
    if (clause === '宪法条目' || clause === '') continue;
    let status: ConstitutionWarning['status'] = 'pass';
    if (statusRaw.includes('❌')) status = 'conflict';
    else if (statusRaw.includes('⚠️')) status = 'warning';
    else if (statusRaw.includes('✅')) status = 'pass';
    else continue; // 不含状态 emoji 的行跳过
    warnings.push({ clause, status, note });
  }
  return warnings;
}

// ─── Artifact 写入 ──────────────────────────────────────────────────────────

function createArtifact(input: {
  userId: string;
  sessionId: string;
  type: string;
  title: string;
  content: string;
  phase: string;
  teamWorkspaceId: string | null;
  parentArtifactId: string | null;
  /** 调用方所属层（用于 capability guard）。artifact-chain 内调用统一传 'pm1'。 */
  roleLayer: HandoffRoleLayer;
}): string {
  // L1.4 Guard #4: 检查该层是否允许写入此 phase 的 artifact
  assertCanWriteArtifactPhase({
    roleLayer: input.roleLayer,
    phase: input.phase,
    userId: input.userId,
    sessionId: input.sessionId,
  });

  const id = randomUUID();
  sqliteRun(
    `INSERT INTO artifacts (
       id, session_id, user_id, type, title, content, version,
       phase, team_workspace_id, parent_artifact_id
     ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    [
      id,
      input.sessionId,
      input.userId,
      input.type,
      input.title,
      input.content,
      input.phase,
      input.teamWorkspaceId,
      input.parentArtifactId,
    ],
  );
  return id;
}

// ─── Handoff result 写入 ────────────────────────────────────────────────────

function writeHandoffResult(handoffId: string, result: unknown): void {
  sqliteRun(
    `UPDATE handoff_records SET result_json = ?, updated_at = datetime('now') WHERE id = ?`,
    [JSON.stringify(result), handoffId],
  );
}

// ─── 输出校验 + 重试（风险缓解：不合格重试 1 次） ────────────────────────

interface ValidationRule {
  /** 人类可读的校验名 */
  name: string;
  /** 返回 true 表示通过 */
  check: (content: string) => boolean;
}

const SPEC_VALIDATION_RULES: ValidationRule[] = [
  { name: '包含用户故事', check: (c) => /用户故事|User Story/i.test(c) },
  { name: '包含需求', check: (c) => /需求|Requirements|FR-/i.test(c) },
];

const PLAN_VALIDATION_RULES: ValidationRule[] = [
  { name: '包含技术上下文', check: (c) => /技术|Technical|TypeScript/i.test(c) },
  { name: '包含宪法对齐', check: (c) => /宪法|Constitution|对齐/i.test(c) },
];

const TASKS_VALIDATION_RULES: ValidationRule[] = [
  { name: '包含任务列表', check: (c) => /\[[ x]\]\s*T\d+|Phase \d|阶段/i.test(c) },
];

function validateOutput(
  content: string,
  rules: ValidationRule[],
): { ok: boolean; failed: string[] } {
  const failed = rules.filter((r) => !r.check(content)).map((r) => r.name);
  return { ok: failed.length === 0, failed };
}

/**
 * 带重试的 LLM 调用：校验不通过时追加"格式不合格"提示重试 1 次。
 */
async function callLlmWithRetry(
  callLlm: ArtifactChainInput['callLlm'],
  systemPrompt: string,
  userMessage: string,
  rules: ValidationRule[],
): Promise<string> {
  const first = await callLlm(systemPrompt, userMessage);
  const validation = validateOutput(first, rules);
  if (validation.ok) return first;

  // 重试 1 次，追加格式提示
  const retryHint = `\n\n⚠️ 上一次输出格式不合格（缺少：${validation.failed.join('、')}）。请严格按照模板结构重新输出。`;
  const second = await callLlm(systemPrompt, userMessage + retryHint);
  return second; // 第二次不再校验，直接使用
}

// ─── 主流程 ─────────────────────────────────────────────────────────────────

/**
 * 默认 clarification 阻塞超时（30 分钟，对齐 D51 任务上限）。
 * 超时后回退："视为用户不回答，使用 LLM 默认假设继续"——避免无限挂起。
 */
const DEFAULT_CLARIFICATION_TIMEOUT_MS = 30 * 60 * 1000;
/** 轮询 inbound 的间隔。受 OPENAWORK_TEAM_INBOUND_POLL_MS 控制（测试可调小）。 */
function getInboundPollIntervalMs(): number {
  const raw = globalThis.process?.env['OPENAWORK_TEAM_INBOUND_POLL_MS'];
  const v = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(v) && v > 0 ? v : 500;
}
function getClarificationTimeoutMs(): number {
  const raw = globalThis.process?.env['OPENAWORK_TEAM_CLARIFICATION_TIMEOUT_MS'];
  const v = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_CLARIFICATION_TIMEOUT_MS;
}

interface CollectedClarificationAnswer {
  questionId: string | null;
  answer: string;
  receivedAt: string;
}

/**
 * 阻塞等待 clarification_answer 入库，或超时 / cancel 后退出。
 *
 * 返回所有收到的回答（按时间顺序）。
 *   - clarifications.length 不必等同 answers.length（用户可能合并回答多个问题）
 *   - 收到 cancel_signal → 抛 'cancelled'，由上层转 failed
 *   - 超时 → 返回空数组（上层用 LLM 默认值继续）
 */
async function waitForClarificationAnswers(input: {
  sessionId: string;
  expectedCount: number;
  signal: AbortSignal;
}): Promise<CollectedClarificationAnswer[]> {
  const collected: CollectedClarificationAnswer[] = [];
  const deadline = Date.now() + getClarificationTimeoutMs();
  const pollIntervalMs = getInboundPollIntervalMs();
  let loopIteration = 0;

  while (Date.now() < deadline) {
    if (input.signal.aborted) {
      throw new Error('aborted');
    }
    if (hasPendingCancelSignal(input.sessionId)) {
      // cancel_signal 优先级最高（ORDER BY priority=0），consumePending 一定返回它
      const cancelMsg = consumePendingInboundMessage({ toSessionId: input.sessionId, loopIteration });
      if (cancelMsg && cancelMsg.messageType === 'cancel_signal') {
        throw new Error('cancelled-by-inbound');
      }
      // 极端边缘情况：hasPendingCancelSignal 和 consume 之间被其他线程消费了
      // 此时 cancelMsg 可能是其他类型或 null，继续循环让下一轮重新检测
      if (cancelMsg && cancelMsg.messageType !== 'cancel_signal') {
        // 把非 cancel 消息当作正常消息处理
        if (cancelMsg.messageType === 'clarification_answer') {
          const payload = (cancelMsg.payload ?? {}) as Record<string, unknown>;
          const answerText = typeof payload['answer'] === 'string' ? payload['answer'] : '';
          const questionId = typeof payload['questionId'] === 'string' ? payload['questionId'] : null;
          if (answerText.trim()) {
            collected.push({ questionId, answer: answerText, receivedAt: cancelMsg.createdAt });
          }
          if (collected.length >= input.expectedCount) break;
        } else if (cancelMsg.messageType === 'user_input') {
          const payload = (cancelMsg.payload ?? {}) as Record<string, unknown>;
          const text = typeof payload['text'] === 'string' ? payload['text'] : '';
          if (text.trim()) {
            collected.push({ questionId: null, answer: text, receivedAt: cancelMsg.createdAt });
          }
          if (collected.length >= input.expectedCount) break;
        }
        loopIteration += 1;
        continue;
      }
    }

    const message = consumePendingInboundMessage({
      toSessionId: input.sessionId,
      loopIteration,
    });
    if (message) {
      if (message.messageType === 'clarification_answer') {
        const payload = (message.payload ?? {}) as Record<string, unknown>;
        const answerText = typeof payload['answer'] === 'string' ? payload['answer'] : '';
        const questionId = typeof payload['questionId'] === 'string' ? payload['questionId'] : null;
        if (answerText.trim()) {
          collected.push({
            questionId,
            answer: answerText,
            receivedAt: message.createdAt,
          });
        }
        // 收够预期数量就提前结束等待
        if (collected.length >= input.expectedCount) break;
      } else if (message.messageType === 'user_input') {
        // 用户中途追加输入：把 text 当作整体回答记录下来
        const payload = (message.payload ?? {}) as Record<string, unknown>;
        const text = typeof payload['text'] === 'string' ? payload['text'] : '';
        if (text.trim()) {
          collected.push({
            questionId: null,
            answer: text,
            receivedAt: message.createdAt,
          });
        }
        if (collected.length >= input.expectedCount) break;
      } else if (message.messageType === 'pause_signal') {
        // 暂停信号：当前循环不主动响应（保持等待状态由上层调度处理）
        // 简化：把它视作"继续等"
      }
      // 其他消息类型（escalation_request / progress_report / resume_signal）不影响
      // clarification 等待——直接忽略，下一轮 poll
      loopIteration += 1;
      continue;
    }

    // 无消息 → sleep 后重试
    await new Promise<void>((resolve) => setTimeout(resolve, pollIntervalMs));
    loopIteration += 1;
  }

  return collected;
}

export async function runArtifactChain(input: ArtifactChainInput): Promise<ArtifactChainResult> {
  const { SPEC_TEMPLATE_SYSTEM_INSTRUCTION } = await import('../../team-phase-c-content/index.js');
  const { PLAN_SYSTEM_INSTRUCTION, TASKS_SYSTEM_INSTRUCTION } =
    await import('../../team-phase-c-content/index.js');

  const setC = (substate: (typeof SUBSTATES_C)[keyof typeof SUBSTATES_C]) => {
    setSubstate({
      sessionId: input.sessionId,
      substate,
      userId: input.userId,
      roleLayer: 'pm1',
    });
  };

  // ─── Step 1: 生成 spec ────────────────────────────────────────────────────
  setC(SUBSTATES_C.DRAFTING_SPEC);
  const specUserMessage = `用户意图：${input.rewrittenIntent}\n\n原始表述：${input.sourceIntent}`;
  const specContent = await callLlmWithRetry(
    input.callLlm,
    SPEC_TEMPLATE_SYSTEM_INSTRUCTION,
    specUserMessage,
    SPEC_VALIDATION_RULES,
  );

  const specArtifactId = createArtifact({
    userId: input.userId,
    sessionId: input.sessionId,
    type: 'markdown',
    title: `spec: ${input.rewrittenIntent.slice(0, 60)}`,
    content: specContent,
    phase: 'spec',
    teamWorkspaceId: input.teamWorkspaceId,
    parentArtifactId: null,
    roleLayer: 'pm1',
  });
  setC(SUBSTATES_C.SPEC_READY);

  // ─── Step 2: 解析 [NEEDS CLARIFICATION]，阻塞等待回答（L1.3 改造 3） ──────
  const clarifications = parseClarifications(specContent);
  let clarificationAnswers: CollectedClarificationAnswer[] = [];
  if (clarifications.length > 0) {
    publishTeamEvent({
      type: 'artifact.needs-clarification',
      taskId: input.handoff.id,
      sessionId: input.sessionId,
      layer: 'pm1' as HandoffRoleLayer,
      timestamp: Date.now(),
      payload: {
        clarifications,
        specArtifactId,
      },
      userId: input.userId,
    });

    // 反向写一条 escalation_request 到 reception inbox（让 b 在 UI 渲染问题）。
    // 失败不阻塞主流程（只是少了 UI 推送）。
    try {
      submitInboundMessage({
        userId: input.userId,
        toSessionId: input.handoff.fromSessionId,
        fromRoleLayer: 'pm1',
        messageType: 'escalation_request',
        payload: {
          fromLayer: 'pm1',
          fromSessionId: input.sessionId,
          reason: 'needs_clarification',
          escalationRound: 0,
          context: `c 层在生成 spec 时遇到 ${clarifications.length} 个待澄清问题`,
          questions: clarifications.map((c) => ({
            id: c.id,
            question: c.question,
            context: c.context,
          })),
          suggestedActions: [{ label: '回答澄清问题', action: 'answer' }],
        },
      });
    } catch (err) {
      console.warn(
        `[artifact-chain] escalation_request inbox 写入失败：${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // 进入 clarifying 子状态，阻塞等待 inbound clarification_answer
    setC(SUBSTATES_C.CLARIFYING);
    try {
      clarificationAnswers = await waitForClarificationAnswers({
        sessionId: input.sessionId,
        expectedCount: clarifications.length,
        signal: input.signal ?? new AbortController().signal,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message === 'cancelled-by-inbound' || message === 'aborted') {
        setC(SUBSTATES_C.CANCELLED);
        throw err;
      }
      // 其他异常 → 视为收不到答案，继续走默认假设
      console.warn(`[artifact-chain] clarification 等待异常：${message}`);
    }
    // 回到 spec_ready（澄清结束，准备进入 plan）
    setC(SUBSTATES_C.SPEC_READY);
  }

  // ─── Step 3: 生成 plan（注入 constitution + 用户答案） ────────────────────
  setC(SUBSTATES_C.DRAFTING_PLAN);
  let constitutionBlock = '';
  if (input.teamWorkspaceId) {
    const constitution = getTeamConstitution({
      userId: input.userId,
      teamWorkspaceId: input.teamWorkspaceId,
    });
    if (constitution && constitution.body.trim().length > 0) {
      constitutionBlock = `\n\n<constitution>\n${constitution.body.trim()}\n</constitution>`;
    }
  }

  // 把用户的澄清回答注入到 plan 提示中
  let clarificationBlock = '';
  if (clarificationAnswers.length > 0) {
    const lines = clarificationAnswers
      .map((ans, idx) => {
        const qIdx = idx < clarifications.length ? idx : -1;
        const qText = qIdx >= 0 ? clarifications[qIdx]?.question : '（用户中途追加输入）';
        return `${idx + 1}. 问：${qText ?? '（未知问题）'}\n   答：${ans.answer}`;
      })
      .join('\n');
    clarificationBlock = `\n\n<clarifications>\n以下是用户对 [NEEDS CLARIFICATION] 的回答，请在 plan 中按这些答案细化设计：\n${lines}\n</clarifications>`;
  } else if (clarifications.length > 0) {
    clarificationBlock = `\n\n<clarifications>\n用户未在超时前回答 ${clarifications.length} 个澄清问题。请使用最稳妥的默认假设（保守选择）继续生成 plan。\n</clarifications>`;
  }

  const planUserMessage = `基于以下 spec 生成实施计划：\n\n${specContent}${constitutionBlock}${clarificationBlock}`;
  const planContent = await callLlmWithRetry(
    input.callLlm,
    PLAN_SYSTEM_INSTRUCTION,
    planUserMessage,
    PLAN_VALIDATION_RULES,
  );

  const planArtifactId = createArtifact({
    userId: input.userId,
    sessionId: input.sessionId,
    type: 'markdown',
    title: `plan: ${input.rewrittenIntent.slice(0, 60)}`,
    content: planContent,
    phase: 'plan',
    teamWorkspaceId: input.teamWorkspaceId,
    parentArtifactId: specArtifactId,
    roleLayer: 'pm1',
  });
  setC(SUBSTATES_C.PLAN_READY);

  // ─── Step 4: Constitution Check（软警告） ─────────────────────────────────
  const constitutionWarnings = parseConstitutionCheck(planContent);
  const hasConflict = constitutionWarnings.some((w) => w.status === 'conflict');
  if (hasConflict) {
    publishTeamEvent({
      type: 'artifact.constitution-conflict',
      taskId: input.handoff.id,
      sessionId: input.sessionId,
      layer: 'pm1' as HandoffRoleLayer,
      timestamp: Date.now(),
      payload: {
        warnings: constitutionWarnings.filter((w) => w.status !== 'pass'),
        planArtifactId,
      },
      userId: input.userId,
    });
  }

  // ─── Step 5: 生成 tasks ───────────────────────────────────────────────────
  setC(SUBSTATES_C.DRAFTING_TASKS);
  const tasksUserMessage = `基于以下 plan 和 spec 生成任务清单：\n\nPlan:\n${planContent}\n\nSpec:\n${specContent}`;
  const tasksContent = await callLlmWithRetry(
    input.callLlm,
    TASKS_SYSTEM_INSTRUCTION,
    tasksUserMessage,
    TASKS_VALIDATION_RULES,
  );

  const tasksArtifactId = createArtifact({
    userId: input.userId,
    sessionId: input.sessionId,
    type: 'markdown',
    title: `tasks: ${input.rewrittenIntent.slice(0, 60)}`,
    content: tasksContent,
    phase: 'tasks',
    teamWorkspaceId: input.teamWorkspaceId,
    parentArtifactId: planArtifactId,
    roleLayer: 'pm1',
  });
  setC(SUBSTATES_C.TASKS_READY);

  // ─── Step 6: 写入 handoff result ──────────────────────────────────────────
  writeHandoffResult(input.handoff.id, {
    specArtifactId,
    planArtifactId,
    tasksArtifactId,
    clarifications,
    clarificationAnswers,
    constitutionWarnings,
  });

  setC(SUBSTATES_C.COMPLETED);

  return {
    specArtifactId,
    planArtifactId,
    tasksArtifactId,
    clarifications,
    constitutionWarnings,
  };
}
