/**
 * 260515-team-phase-c · T-02 / T-03 / T-04 / T-05
 *
 * c 层（PM1）产物链生成 + Constitution Check + handoff result 写入 +
 * [NEEDS CLARIFICATION] 解析与推送。
 *
 * 流程：
 *   1. 收到 b→c handoff payload（含 rewrittenIntent / sourceIntent）
 *   2. 生成 spec.md 产物（调 LLM，用 SPEC_TEMPLATE_SYSTEM_INSTRUCTION）
 *   3. 解析 spec 中的 [NEEDS CLARIFICATION] 标记
 *      - 有标记 → 通过 team-events 推送给 b → 等待用户澄清（Phase C MVP 先不阻塞）
 *   4. 生成 plan.md 产物（调 LLM，用 PLAN_SYSTEM_INSTRUCTION + constitution 注入）
 *   5. Constitution Check：解析 plan 中的宪法对齐表，标记冲突（软警告）
 *   6. 生成 tasks.md 产物（调 LLM，用 TASKS_SYSTEM_INSTRUCTION）
 *   7. 把 spec/plan/tasks 三个 artifact id 写入 handoff_records.result_json
 *   8. 完成 handoff
 *
 * Phase C MVP 简化：
 *   - LLM 调用通过 auxiliary-llm-config 复用现有 workflow LLM
 *   - 不做重试（Phase D 加）
 *   - Constitution Check 是软警告（不阻断）
 *   - [NEEDS CLARIFICATION] 推送后不等待回复（Phase D 加阻塞门禁）
 */

import { randomUUID } from 'node:crypto';
import { sqliteRun } from '../db.js';
import { publishTeamEvent } from './team-events-bus.js';
import type { HandoffRecord, HandoffRoleLayer } from './handoff-store.js';
import { getTeamConstitution } from '../team-constitution-store.js';

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
}): string {
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

export async function runArtifactChain(input: ArtifactChainInput): Promise<ArtifactChainResult> {
  const { SPEC_TEMPLATE_SYSTEM_INSTRUCTION } = await import('../team-phase-c-content/index.js');
  const { PLAN_SYSTEM_INSTRUCTION, TASKS_SYSTEM_INSTRUCTION } =
    await import('../team-phase-c-content/index.js');

  // ─── Step 1: 生成 spec ────────────────────────────────────────────────────
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
  });

  // ─── Step 2: 解析 [NEEDS CLARIFICATION] ───────────────────────────────────
  const clarifications = parseClarifications(specContent);
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
  }

  // ─── Step 3: 生成 plan（注入 constitution） ───────────────────────────────
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

  const planUserMessage = `基于以下 spec 生成实施计划：\n\n${specContent}${constitutionBlock}`;
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
  });

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
  });

  // ─── Step 6: 写入 handoff result ──────────────────────────────────────────
  writeHandoffResult(input.handoff.id, {
    specArtifactId,
    planArtifactId,
    tasksArtifactId,
    clarifications,
    constitutionWarnings,
  });

  return {
    specArtifactId,
    planArtifactId,
    tasksArtifactId,
    clarifications,
    constitutionWarnings,
  };
}
