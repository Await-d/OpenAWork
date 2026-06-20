/**
 * 260516-team-phase-d · T-02 / T-03 / T-04
 *
 * PM2 Runner：d 层的核心执行体。
 *
 * 职责：
 *   1. 从 c→d handoff 的 result_json 中读取 tasks artifact
 *   2. 解析 tasks.md → 拆分为 dispatch_packages
 *   3. Constitution Check 硬门禁（D29 B3：字面违反退回 c）
 *   4. 为每个 dispatch_package 创建 handoff（d→e/f/g）
 *   5. 有限并行编排（D28：e/f 并行，g 等两者完成）
 *   6. 动态编制（D46：e 数量根据 [P] 标记动态决定，最少 2）
 */

import { randomUUID } from 'node:crypto';
import type { HandoffTaskRunner } from './watcher.js';
import { createHandoff, type HandoffRecord } from '../store/handoff-store.js';
import { publishHandoffEvent } from '../bus/team-events-bus.js';
import { getTeamConstitution } from '../../team/team-constitution-store.js';
import { appendSessionMessageV2 } from '../../message/message-v2-adapter.js';
import {
  getTeamWorkspaceDefaultRoster,
  resolveSessionMemberSlots,
} from '../../team/team-default-roster-store.js';
import { sqliteGet, sqliteRun } from '../../infra/db.js';
import { resolveAuxiliaryLlmConfig } from '../../provider/auxiliary-llm-config.js';
import {
  buildAuxiliaryTeamInstructionPrefix,
  prependAuxiliaryTeamInstructionPrefix,
} from '../../team/team-auxiliary-instruction-stack.js';
import {
  buildTeamRosterManifest,
  resolveMemberModelForSessionLayer,
} from '../bus/resolve-member-model.js';
import { buildDispatchPackages, parseAllTasks } from '../capability/dispatch-package.js';
import { setSubstate, SUBSTATES_D } from '../store/substate-store.js';
import { resolveSessionWorkspacePath } from '../../session/session-workspace-resolution.js';
import { assertCanWriteArtifactPhase } from '../capability/layer-capabilities.js';
import { recordTeamRuntimeIncident } from '../../team/team-runtime-diagnostics-store.js';
import {
  validatePlanOutput,
  validateSpecOutput,
  validateTasksOutput,
} from './artifact-chain.js';

const MIN_EXECUTOR_PARALLEL = 2;
const DEFAULT_MAX_EXECUTOR_PARALLEL = 8;

/**
 * 安全地将 PM2 层的消息写入 message_v2，确保 recovery API 能拉取到
 * PM2 session 的对话历史。PM2 使用辅助 LLM 路径（requestWorkflowLlmCompletion），
 * 消息不会自动持久化——需要显式写入。
 */
function safeAppendPm2Message(input: Parameters<typeof appendSessionMessageV2>[0]): void {
  try {
    appendSessionMessageV2(input);
  } catch (err) {
    console.warn(
      `[pm2-runner] appendSessionMessageV2 失败：${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** 记录 PM2 层一条 assistant 消息（带 agentId 标识来源）。 */
function persistPm2AssistantMessage(input: {
  userId: string;
  sessionId: string;
  handoffId: string;
  step: string;
  text: string;
}): void {
  safeAppendPm2Message({
    sessionId: input.sessionId,
    userId: input.userId,
    role: 'assistant',
    content: [{ type: 'text', text: input.text }],
    clientRequestId: `pm2:${input.handoffId}:${input.step}`,
    agentId: 'zeus',
  });
}

// D50 全局并发上限：单次 d 层派发最多创建多少个子 handoff（= 子 session）。
// tasks.md 由上游 LLM（PM1）生成，恶意 / 失控的计划可能列出成百上千条任务行；
// 无上限地按任务数 fan-out 子 handoff 会耗尽 PID / FD / DB 行 / LLM 预算。
// 经 OPENAWORK_TEAM_MAX_DISPATCH_PACKAGES 可调，<=0 / 非法值视为关闭上限。
const DEFAULT_MAX_DISPATCH_PACKAGES = 50;
function resolveMaxDispatchPackages(): number {
  const raw = globalThis.process?.env?.['OPENAWORK_TEAM_MAX_DISPATCH_PACKAGES'];
  if (raw === undefined || raw === null || raw.trim() === '') {
    return DEFAULT_MAX_DISPATCH_PACKAGES;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.floor(parsed);
}

type ArchitectureIssueSeverity = 'warning' | 'blocking';
type ArchitectureIssueSource = 'builtin' | 'architecture-md';

interface ArchitectureReviewIssue {
  ruleId: string;
  severity: ArchitectureIssueSeverity;
  source: ArchitectureIssueSource;
  message: string;
}

interface ArchitectureReviewResult {
  passed: boolean;
  issues: ArchitectureReviewIssue[];
  warningCount: number;
  blockingCount: number;
  architectureMdLoaded: boolean;
}

interface PlanningReadinessResult {
  passed: boolean;
  issues: string[];
}

// ─── Constitution Check 硬门禁 ──────────────────────────────────────────────

interface ConstitutionHardCheckResult {
  pass: boolean;
  violations: string[];
}

async function runConstitutionHardCheck(input: {
  planContent: string;
  constitutionBody: string;
  callLlm: (system: string, user: string) => Promise<string>;
}): Promise<ConstitutionHardCheckResult> {
  const systemPrompt = `你是 Constitution Check 硬门禁。你的任务是逐条检查实施计划是否违反团队宪法。

规则：
- 如果计划中有任何条目**字面违反**宪法中的"不接受"/"禁止"条款，输出 VIOLATION: [具体违反内容]
- 如果全部通过，输出 PASS
- 只检查字面违反，不做推测性判断
- 每个违反单独一行

输出格式（严格）：
PASS
或
VIOLATION: [违反描述1]
VIOLATION: [违反描述2]`;

  const userMessage = `<constitution>\n${input.constitutionBody}\n</constitution>\n\n<plan>\n${input.planContent}\n</plan>`;

  const result = await input.callLlm(systemPrompt, userMessage);
  const lines = result
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.some((l) => l === 'PASS') && !lines.some((l) => l.startsWith('VIOLATION:'))) {
    return { pass: true, violations: [] };
  }

  const violations = lines
    .filter((l) => l.startsWith('VIOLATION:'))
    .map((l) => l.replace(/^VIOLATION:\s*/, ''));

  return { pass: violations.length === 0, violations };
}

// ─── PM2 Runner ─────────────────────────────────────────────────────────────

/**
 * 创建退回 PM1 重新规划的 handoff。
 * PM2 在任何检查环节发现 PM1 产物质量不达标时调用：
 *   - Planning Contract 未通过
 *   - Constitution Check 修正后仍不通过
 *   - Architecture Review 有阻断问题
 * 
 * 查找原始 reception session 和 sourceIntent，创建 reception→PM1 handoff，
 * payload 中带质量反馈，PM1 收到后会根据反馈重新生成 spec/plan/tasks。
 */
async function createReturnToPm1Handoff(input: {
  userId: string;
  pm2HandoffId: string;
  pm1SessionId: string;
  sourceIntent: string;
  teamWorkspaceId: string | null;
  feedback: string;
  step: string;
  /** PM2 handoff 的当前重试次数，用于递增 escalationRound */
  pm2RetryCount?: number;
}): Promise<void> {
  try {
    const { createHandoff } = await import('../store/handoff-store.js');
    // 从 DB 读取 PM2 handoff 的 retry_count，用于递增 escalationRound
    const pm2Row = sqliteGet<{ retry_count: number }>(
      `SELECT retry_count FROM handoff_records WHERE id = ? LIMIT 1`,
      [input.pm2HandoffId],
    );
    const effectiveRetryCount = input.pm2RetryCount ?? pm2Row?.retry_count ?? 0;
    // 查找 reception→PM1 handoff 获取原始 sourceIntent 和 reception session
    const receptionHandoffRow = sqliteGet<{ from_session_id: string; payload_json: string }>(
      `SELECT from_session_id, payload_json FROM handoff_records
        WHERE to_role_layer = 'pm1' AND to_session_id = ?
        ORDER BY created_at DESC LIMIT 1`,
      [input.pm1SessionId],
    );
    if (!receptionHandoffRow?.from_session_id) {
      console.warn(`[pm2-runner] 退回 PM1 失败：找不到 reception→PM1 handoff`);
      return;
    }
    const receptionSessionId = receptionHandoffRow.from_session_id;
    const originalPayload = JSON.parse(receptionHandoffRow.payload_json) as Record<string, unknown>;
    const sourceIntent = input.sourceIntent ||
      (typeof originalPayload['sourceIntent'] === 'string' ? originalPayload['sourceIntent'] : '未提供意图');
    const teamWorkspaceId = input.teamWorkspaceId ??
      (typeof originalPayload['teamWorkspaceId'] === 'string' ? originalPayload['teamWorkspaceId'] : null);

    await createHandoff({
      userId: input.userId,
      fromSessionId: receptionSessionId,
      fromRoleLayer: 'reception',
      toRoleLayer: 'pm1',
      idempotencyKey: `pm2-return:${input.step}:${input.pm2HandoffId}`,
      payload: {
        sourceIntent,
        rewrittenIntent: `【${input.step} 退回重新规划】${sourceIntent}\n\n---\n\n## 质量反馈\n${input.feedback}\n\n请根据以上反馈修正 spec/plan/tasks。`,
        recommendedRole: 'planner',
        recommendedNextStep: '根据质量反馈修正产物，确保通过 PM2 的各项检查。',
        teamWorkspaceId,
        isQualityFeedback: true,
        qualityFeedback: input.feedback,
        previousPm2HandoffId: input.pm2HandoffId,
        escalationRound: effectiveRetryCount + 1,
      },
    });

    // 向 reception session 写消息让用户知道团队在自动修正
    try {
      appendSessionMessageV2({
        sessionId: receptionSessionId,
        userId: input.userId,
        role: 'assistant',
        agentId: 'interaction-agent',
        content: [
          {
            type: 'text',
            text: `🔄 PM2 管控层检查发现规划质量问题（${input.step}），已自动退回 PM1 根据反馈重新规划。`,
          },
        ],
        clientRequestId: `pm2:${input.pm2HandoffId}:return-to-pm1:${input.step}`,
      });
    } catch {
      /* best-effort */
    }
  } catch (replanErr) {
    console.warn(
      `[pm2-runner] 退回 PM1 失败（${input.step}）：${replanErr instanceof Error ? replanErr.message : String(replanErr)}`,
    );
  }
}

export function createPm2Runner(): HandoffTaskRunner {
  return async (input) => {
    if (input.signal.aborted) return;
    if (input.handoff.toRoleLayer !== 'pm2') return;

    const setD = (substate: (typeof SUBSTATES_D)[keyof typeof SUBSTATES_D]) => {
      setSubstate({
        sessionId: input.toSessionId,
        substate,
        userId: input.handoff.userId,
        roleLayer: 'pm2',
      });
    };

    setD(SUBSTATES_D.CONSTITUTION_CHECK);

    // 1. 从 c→d handoff 的 result_json 读取产物 ID
    const payload = input.handoff.payload as Record<string, unknown> | null;
    const resultJson =
      (payload?.['resultJson'] as Record<string, unknown> | null) ??
      readHandoffResultJson(input.handoff.id);

    const tasksArtifactId = (resultJson?.['tasksArtifactId'] as string) ?? null;
    const planArtifactId = (resultJson?.['planArtifactId'] as string) ?? null;
    const specArtifactId = (resultJson?.['specArtifactId'] as string) ?? null;
    const teamWorkspaceId = (payload?.['teamWorkspaceId'] as string) ?? null;

    // tasksArtifactId 缺失时，尝试从 PM1 session 的 artifacts 表直接查最新 tasks 产物
    // （可能 PM1 在写 result_json 前崩溃但 tasks artifact 已落库）
    let effectiveTasksArtifactId = tasksArtifactId;
    if (!effectiveTasksArtifactId) {
      const fallbackTasksRow = sqliteGet<{ id: string }>(
        `SELECT id FROM artifacts
          WHERE session_id = ? AND phase = 'tasks'
          ORDER BY updated_at DESC LIMIT 1`,
        [input.handoff.fromSessionId],
      );
      if (fallbackTasksRow?.id) {
        effectiveTasksArtifactId = fallbackTasksRow.id;
        persistPm2AssistantMessage({
          userId: input.handoff.userId,
          sessionId: input.toSessionId,
          handoffId: input.handoff.id,
          step: 'tasks-artifact-fallback',
          text: `⚠️ handoff result 中缺少 tasksArtifactId，已从 PM1 session 产物中恢复（artifact: ${fallbackTasksRow.id.slice(0, 8)}）。`,
        });
      } else {
        // 完全找不到 tasks 产物——PM1 可能在 tasks 生成前就失败了。
        // 用 plan 内容创建一个降级 tasks artifact，让流程能继续。
        const planContentForFallback = planRow?.content ?? '';
        const specContentForFallback = specRow?.content ?? '';
        if (!planContentForFallback && !specContentForFallback) {
          throw new Error('PM2 runner: 无法获取 tasks 产物，且 spec/plan 也不存在');
        }
        const fallbackTasksContent = [
          '# 任务清单（PM2 降级生成）',
          '',
          'PM1 在生成 tasks 前失败，以下任务基于 plan 内容自动生成：',
          '',
          `## Phase 1: 综合执行`,
          `- [ ] T001 [KIND:build] [SURFACE:cross-cutting] 根据 plan 实施所有规划内容 - 完成所有计划中的开发任务`,
          '',
          '**检查点**',
          '- 所有 plan 中的功能点均已实现',
          '',
          '---',
          '',
          `**Plan 参考内容**：`,
          planContentForFallback.slice(0, 2000),
        ].join('\n');
        const fallbackArtifactId = randomUUID();
        sqliteRun(
          `INSERT INTO artifacts (id, session_id, user_id, type, title, content, version, phase, team_workspace_id, parent_artifact_id)
           VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, NULL)`,
          [
            fallbackArtifactId,
            input.toSessionId,
            input.handoff.userId,
            'markdown',
            'tasks: 降级生成（PM1 tasks 缺失）',
            fallbackTasksContent,
            'tasks',
            teamWorkspaceId ?? null,
          ],
        );
        effectiveTasksArtifactId = fallbackArtifactId;
        persistPm2AssistantMessage({
          userId: input.handoff.userId,
          sessionId: input.toSessionId,
          handoffId: input.handoff.id,
          step: 'tasks-artifact-generated',
          text: `⚠️ PM1 未生成 tasks 产物，PM2 已基于 plan 内容降级生成默认任务清单。`,
        });
      }
    }

    // 2. 读取 tasks.md 内容
    const tasksRow = sqliteGet<{ content: string }>(`SELECT content FROM artifacts WHERE id = ?`, [
      effectiveTasksArtifactId,
    ]);
    if (!tasksRow) {
      throw new Error(`PM2 runner: tasks artifact ${effectiveTasksArtifactId} 不存在`);
    }

    const specRow = specArtifactId
      ? sqliteGet<{ content: string }>(`SELECT content FROM artifacts WHERE id = ?`, [specArtifactId])
      : null;
    const planRow = planArtifactId
      ? sqliteGet<{ content: string }>(`SELECT content FROM artifacts WHERE id = ?`, [planArtifactId])
      : null;

    const readiness = validatePlanningReadiness({
      specContent: specRow?.content ?? '',
      planContent: planRow?.content ?? '',
      tasksContent: tasksRow.content,
    });
    if (!readiness.passed) {
      const errorMessage = `Planning Contract 未通过：${readiness.issues.join('；')}`;
      persistPm2AssistantMessage({
        userId: input.handoff.userId,
        sessionId: input.toSessionId,
        handoffId: input.handoff.id,
        step: 'planning-contract-failed',
        text: `⚠️ ${errorMessage}\n\n已自动退回 PM1 重新规划，PM1 将根据反馈修正产物后重新提交。`,
      });
      await createReturnToPm1Handoff({
        userId: input.handoff.userId,
        pm2HandoffId: input.handoff.id,
        pm1SessionId: input.handoff.fromSessionId,
        sourceIntent: '',
        teamWorkspaceId,
        feedback: `Planning Contract 未通过：\n${readiness.issues.map((s, i) => `${i + 1}. ${s}`).join('\n')}`,
        step: 'planning-contract',
      });
      return;
    }

    // 3. 解析 tasks
    let tasks = parseAllTasks(tasksRow.content);
    if (tasks.length === 0) {
      // tasks.md 格式不标准导致解析为空——把整个内容作为一个综合任务
      persistPm2AssistantMessage({
        userId: input.handoff.userId,
        sessionId: input.toSessionId,
        handoffId: input.handoff.id,
        step: 'tasks-parse-empty',
        text: `⚠️ tasks.md 解析出 0 个任务，将把整个内容作为一个综合任务执行（降级模式）。`,
      });
      tasks = [{
        id: 'fallback-0',
        title: tasksRow.content.slice(0, 100) || '综合执行任务',
        kind: 'build' as const,
        surface: 'cross-cutting' as const,
        parallel: false,
        rawLine: `- [ ] T001 [KIND:build] [SURFACE:cross-cutting] ${tasksRow.content.slice(0, 100)}`,
      }];
    }

    // 4. Constitution Check 硬门禁
    if (teamWorkspaceId) {
      const constitution = getTeamConstitution({
        userId: input.handoff.userId,
        teamWorkspaceId,
      });
      if (constitution && constitution.body.trim().length > 0) {
        const planContent = planRow?.content ?? '';

        if (planContent.length > 0) {
          const pm2MemberModel = resolveMemberModelForSessionLayer({
            sessionId: input.toSessionId,
            layer: 'pm2',
          });
          const llmConfig = await resolveAuxiliaryLlmConfig(input.handoff.userId, pm2MemberModel);
          if (llmConfig) {
            const { requestWorkflowLlmCompletion } = await import('../../routes/workflow-llm.js');
            // 动态注入「团队编制清单」：让 PM2 管控/派发判断也感知当前实时花名册。
            const rosterManifest = buildTeamRosterManifest({
              fromSessionId: input.toSessionId,
              currentLayer: 'pm2',
            });
            const instructionPrefix = await buildAuxiliaryTeamInstructionPrefix({
              userId: input.handoff.userId,
              sessionId: input.toSessionId,
              teamWorkspaceId,
              roleLayer: 'pm2',
            });
            const callLlm = async (system: string, user: string): Promise<string> => {
              let systemWithExtras = rosterManifest ? `${system}\n\n${rosterManifest}` : system;

              // 注入 resume context：让 PM2 在 Constitution Check 时也能感知
              // 未完成任务状态，避免重复派发已完成任务。
              try {
                const {
                  buildTeamResumeSystemPrompt,
                  resolveTeamRootSessionId,
                } = await import('../../team/team-resume-context.js');
                const sessionMetaRow = sqliteGet<{ metadata_json: string | null }>(
                  `SELECT metadata_json FROM sessions WHERE id = ? LIMIT 1`,
                  [input.toSessionId],
                );
                const rootSessionId = sessionMetaRow
                  ? resolveTeamRootSessionId({
                      metadataJson: sessionMetaRow.metadata_json,
                      sessionId: input.toSessionId,
                      userId: input.handoff.userId,
                    })
                  : null;
                if (rootSessionId) {
                  const resumePrompt = await buildTeamResumeSystemPrompt({
                    rootSessionId,
                    userId: input.handoff.userId,
                  });
                  if (resumePrompt) {
                    systemWithExtras = `${systemWithExtras}\n\n${resumePrompt}`;
                  }
                }
              } catch (resumeErr) {
                console.warn(
                  `[pm2-runner] 注入 resume context 失败：${resumeErr instanceof Error ? resumeErr.message : String(resumeErr)}`,
                );
              }

              const systemWithKnowledge = prependAuxiliaryTeamInstructionPrefix({
                instructionPrefix,
                prompt: systemWithExtras,
              });

              // 网络重试：对可重试错误（503/429/网络错误）做指数退避重试
              const isRetryable = (err: unknown): boolean => {
                const msg = err instanceof Error ? err.message : String(err);
                return /429|too many requests|rate.?limit|503|502|500|service.*unavailable|temporarily.*unavailable|bad gateway|overloaded|invalid.*json|ECONNRESET|ETIMEDOUT|fetch.*failed|network/i.test(msg);
              };
              const delays = [5_000, 10_000, 20_000];
              for (let attempt = 0; ; attempt++) {
                try {
                  return await requestWorkflowLlmCompletion({
                    apiBaseUrl: llmConfig.apiBaseUrl,
                    apiKey: llmConfig.apiKey,
                    model: llmConfig.model,
                    ...(llmConfig.providerType ? { providerType: llmConfig.providerType } : {}),
                    ...(llmConfig.upstreamProtocol
                      ? { upstreamProtocol: llmConfig.upstreamProtocol }
                      : {}),
                    prompt: `${systemWithKnowledge}\n\n---\n\n${user}`,
                    temperature: 0.1,
                    usageContext: {
                      userId: input.handoff.userId,
                      sessionId: input.toSessionId,
                      layer: 'pm2',
                      ...(typeof llmConfig.inputPricePerMillion === 'number'
                        ? { inputPricePerMillion: llmConfig.inputPricePerMillion }
                        : {}),
                      ...(typeof llmConfig.outputPricePerMillion === 'number'
                        ? { outputPricePerMillion: llmConfig.outputPricePerMillion }
                        : {}),
                    },
                  });
                } catch (err) {
                  if (!isRetryable(err) || attempt >= delays.length) throw err;
                  const reason = err instanceof Error ? err.message : String(err);
                  console.warn(
                    `[pm2-runner] LLM 调用失败（${reason}），${delays[attempt]! / 1000} 秒后重试（第 ${attempt + 1}/${delays.length} 次）…`,
                  );
                  await new Promise<void>((resolve) => setTimeout(resolve, delays[attempt]!));
                }
              }
            };

            let checkResult = await runConstitutionHardCheck({
              planContent,
              constitutionBody: constitution.body,
              callLlm,
            });

            // 持久化 constitution check 结果到 message_v2
            persistPm2AssistantMessage({
              userId: input.handoff.userId,
              sessionId: input.toSessionId,
              handoffId: input.handoff.id,
              step: 'constitution-check',
              text: checkResult.pass
                ? '✅ Constitution Check 硬门禁已通过，计划符合宪法约束。'
                : `⚠️ Constitution Check 未通过，正在尝试自动修正…\n违反项：\n${checkResult.violations.map((v) => `- ${v}`).join('\n')}`,
            });

            if (!checkResult.pass) {
              // 自动修正：让 LLM 根据违反项修正 plan 内容，再 check 一次。
              // 避免"宪法违反"直接退回 PM1 导致整个链路重来（耗时长、用户体验差）。
              try {
                const fixPrompt = `以下 plan 未通过 Constitution Check，请修正违反项后重新输出完整的 plan。\n\n违反项：\n${checkResult.violations.map((v) => `- ${v}`).join('\n')}\n\n宪法内容：\n${constitution.body}\n\n原始 plan：\n${planContent}\n\n请输出修正后的完整 plan（保持原有格式和章节结构，只修正违反项）：`;
                const fixedPlan = await callLlm(
                  '你是 PM2 管控层。请根据 Constitution Check 的违反项修正 plan，确保修正后能通过检查。',
                  fixPrompt,
                );
                // 重新 check
                checkResult = await runConstitutionHardCheck({
                  planContent: fixedPlan,
                  constitutionBody: constitution.body,
                  callLlm,
                });
                if (checkResult.pass) {
                  // 修正成功：更新 planRow 和 artifact
                  persistPm2AssistantMessage({
                    userId: input.handoff.userId,
                    sessionId: input.toSessionId,
                    handoffId: input.handoff.id,
                    step: 'constitution-check-fixed',
                    text: '✅ Constitution Check 自动修正成功，已通过二次检查。',
                  });
                  // 更新 plan artifact 内容
                  if (planArtifactId) {
                    sqliteRun(
                      `UPDATE artifacts SET content = ?, updated_at = datetime('now') WHERE id = ?`,
                      [fixedPlan, planArtifactId],
                    );
                  }
                  // 用修正后的 plan 继续后续流程
                  planRow!.content = fixedPlan;
                } else {
                  // 修正后仍不通过 → 退回 PM1 重新规划
                  const ccFeedback = `Constitution Check 未通过（已尝试自动修正仍失败）：\n${checkResult.violations.map((v, i) => `${i + 1}. ${v}`).join('\n')}`;
                  persistPm2AssistantMessage({
                    userId: input.handoff.userId,
                    sessionId: input.toSessionId,
                    handoffId: input.handoff.id,
                    step: 'constitution-check-failed',
                    text: `⚠️ Constitution Check 修正后仍未通过，退回 PM1 重新规划。违反项：${checkResult.violations.join('；')}`,
                  });
                  await createReturnToPm1Handoff({
                    userId: input.handoff.userId,
                    pm2HandoffId: input.handoff.id,
                    pm1SessionId: input.handoff.fromSessionId,
                    sourceIntent: '',
                    teamWorkspaceId,
                    feedback: ccFeedback,
                    step: 'constitution-check',
                  });
                  return;
                }
              } catch (fixErr) {
                // 修正过程本身出错 → 退回 PM1 重新规划
                console.warn(
                  `[pm2-runner] Constitution Check 自动修正失败，退回 PM1：${fixErr instanceof Error ? fixErr.message : String(fixErr)}`,
                );
                const ccFeedback = `Constitution Check 自动修正失败：${fixErr instanceof Error ? fixErr.message : String(fixErr)}`;
                persistPm2AssistantMessage({
                  userId: input.handoff.userId,
                  sessionId: input.toSessionId,
                  handoffId: input.handoff.id,
                  step: 'constitution-check-fix-failed',
                  text: `⚠️ Constitution Check 自动修正失败，退回 PM1 重新规划。`,
                });
                await createReturnToPm1Handoff({
                  userId: input.handoff.userId,
                  pm2HandoffId: input.handoff.id,
                  pm1SessionId: input.handoff.fromSessionId,
                  sourceIntent: '',
                  teamWorkspaceId,
                  feedback: ccFeedback,
                  step: 'constitution-check-fix',
                });
                return;
              }
            }
          }
        }
      }
    }

    if (input.signal.aborted) return;

    setD(SUBSTATES_D.ARCHITECTURE_REVIEW);

    // 5. d.2 Architecture Review（规则代码，不用 LLM）
    // 检查 plan 中是否违反基本架构规则（如：不允许直接操作 DB、必须通过 API 层等）
    // 增强：如果 workspace 有 architecture.md，从中提取禁止条款做对比。
    let architectureReviewResult: ArchitectureReviewResult | null = null;
    let architectureReviewArtifactId: string | null = null;
    if (planArtifactId) {
      if (planRow?.content) {
        // 尝试读取 workspace 的 architecture.md
        let architectureContent: string | null = null;
        let architectureMdLoaded = false;
        if (teamWorkspaceId) {
          try {
            const { readFileSync } = await import('node:fs');
            const { join, resolve } = await import('node:path');
            const sessionRow = sqliteGet<{ metadata_json: string }>(
              `SELECT metadata_json FROM sessions WHERE id = ? AND user_id = ? LIMIT 1`,
              [input.toSessionId, input.handoff.userId],
            );
            const workspaceRoot = sessionRow
              ? resolveSessionWorkspacePath({
                  metadataJson: sessionRow.metadata_json,
                  sessionId: input.toSessionId,
                  userId: input.handoff.userId,
                })
              : null;
            if (workspaceRoot) {
              const archPath = resolve(join(workspaceRoot, 'architecture.md'));
              architectureContent = readFileSync(archPath, 'utf-8');
              architectureMdLoaded = architectureContent.trim().length > 0;
            }
          } catch (err) {
            console.warn(
              `[pm2-runner] 读取 architecture.md 失败：${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
        architectureReviewResult = runArchitectureLint(planRow.content, architectureContent, {
          architectureMdLoaded,
        });
        architectureReviewArtifactId = createReviewArtifact({
          sessionId: input.toSessionId,
          userId: input.handoff.userId,
          teamWorkspaceId,
          result: architectureReviewResult,
        });
        if (architectureReviewResult.issues.length > 0) {
          console.warn(
            `[pm2-runner] d.2 architecture review 发现 ${architectureReviewResult.issues.length} 个问题：${architectureReviewResult.issues.map((issue) => issue.message).join('；')}`,
          );
        }
        if (!architectureReviewResult.passed) {
          recordTeamRuntimeIncident({
            category: 'architecture_review',
            code: 'architecture-review-blocked',
            context: {
              blockingCount: architectureReviewResult.blockingCount,
              warningCount: architectureReviewResult.warningCount,
              sessionId: input.toSessionId,
            },
            message: architectureReviewResult.issues
              .filter((issue) => issue.severity === 'blocking')
              .map((issue) => issue.message)
              .join('；'),
            severity: 'error',
            timestamp: Date.now(),
            userId: input.handoff.userId,
          });
          writeArchitectureReviewResult(input.handoff.id, {
            architectureReview: architectureReviewResult,
            architectureReviewArtifactId,
            qualityReviewPending: false,
          });
          try {
            appendSessionMessageV2({
              sessionId: input.toSessionId,
              userId: input.handoff.userId,
              role: 'assistant',
              agentId: 'zeus',
              content: [
                {
                  type: 'text',
                  text: `⚠️ Architecture Review 发现 ${architectureReviewResult.blockingCount} 个阻断问题，但降级继续派发（质量问题将在后续质量评审中收口）：\n${architectureReviewResult.issues.filter((issue) => issue.severity === 'blocking').map((issue) => issue.message).join('；')}`,
                },
              ],
            });
          } catch (err) {
            console.warn(
              `[pm2-runner] 写 architecture review 警告消息失败：${err instanceof Error ? err.message : String(err)}`,
            );
          }
          // Architecture Review 有阻断问题 → 退回 PM1 重新规划
          const archFeedback = `Architecture Review 未通过：\n${architectureReviewResult.issues.filter((issue) => issue.severity === 'blocking').map((issue, i) => `${i + 1}. ${issue.message}`).join('\n')}`;
          persistPm2AssistantMessage({
            userId: input.handoff.userId,
            sessionId: input.toSessionId,
            handoffId: input.handoff.id,
            step: 'architecture-review-failed',
            text: `⚠️ Architecture Review 发现 ${architectureReviewResult.blockingCount} 个阻断问题，退回 PM1 重新规划。`,
          });
          await createReturnToPm1Handoff({
            userId: input.handoff.userId,
            pm2HandoffId: input.handoff.id,
            pm1SessionId: input.handoff.fromSessionId,
            sourceIntent: '',
            teamWorkspaceId,
            feedback: archFeedback,
            step: 'architecture-review',
          });
          return;
        } else {

        // Architecture review 通过时记录消息
        persistPm2AssistantMessage({
          userId: input.handoff.userId,
          sessionId: input.toSessionId,
          handoffId: input.handoff.id,
          step: 'architecture-review',
          text: `✅ Architecture Review 已通过${architectureReviewResult.warningCount > 0 ? `（${architectureReviewResult.warningCount} 个警告）` : '，无警告'}。`,
        });
        }
      }
    }

    setD(SUBSTATES_D.DISPATCHING);

    // 6. 构建 dispatch_packages
    // 构建 dispatch context：包含 spec/plan 摘要 + 任务清单概览 + 上轮质量反馈（如果是重试），
    // 让 executor 在执行时能看到整体设计意图，而非只看到自己的任务标题。
    const specSummary = specRow?.content
      ? specRow.content.slice(0, 800)
      : '';
    const planSummary = planRow?.content
      ? planRow.content.slice(0, 1200)
      : '';
    // 如果是重试（payload 中有 reviewDisposition），把上轮质量反馈注入 context
    const reviewDisposition = payload?.['reviewDisposition'] as Record<string, unknown> | undefined;
    const lastReviewReason =
      typeof reviewDisposition?.['reason'] === 'string' ? reviewDisposition['reason'] : null;
    const qualityFeedbackBlock = lastReviewReason
      ? `\n\n⚠️ **上轮质量评审反馈（请在本轮执行中修正）**：\n${lastReviewReason}`
      : '';
    const context = [
      `来自 PM1 的任务清单，共 ${tasks.length} 个任务。`,
      specSummary ? `\n**Spec 摘要**：\n${specSummary}` : '',
      planSummary ? `\n**Plan 摘要**：\n${planSummary}` : '',
      qualityFeedbackBlock,
    ].join('');
    // 派发打分优先用「会话实际运行的花名册」（teamDefinition 快照，含用户在模板/会话
    // 里设的 routingKeywords / dispatchPriority），仅在会话无快照时回退 workspace 默认。
    const assignedMemberRoster =
      resolveSessionMemberSlots(input.toSessionId) ??
      (teamWorkspaceId
        ? getTeamWorkspaceDefaultRoster({
            userId: input.handoff.userId,
            teamWorkspaceId,
          })?.memberSlots
        : undefined);
    const maxDispatchPackages = resolveMaxDispatchPackages();
    const packages = buildDispatchPackages({
      tasks,
      artifactRefs: {
        specId: specArtifactId ?? undefined,
        planId: planArtifactId ?? undefined,
        tasksId: tasksArtifactId,
      },
      context,
      ...(maxDispatchPackages > 0 ? { maxPackages: maxDispatchPackages } : {}),
      ...(assignedMemberRoster ? { assignedMemberRoster } : {}),
    });

    // packages 为空时的处理：如果 buildDispatchPackages 没有解析出任何包
    // （tasks.md 格式不标准或任务标题校验不通过），退回 PM1 重新生成 tasks。
    if (packages.length === 0 && tasks.length > 0) {
      // 获取具体的校验问题，让 PM1 知道哪里需要修正
      const { validateParsedTasks } = await import('../capability/dispatch-package.js');
      const validationIssues = validateParsedTasks(tasks);
      const dispatchFeedback = [
        'tasks.md 无法派发：任务格式不标准或标题校验不通过。',
        '',
        '具体问题：',
        ...validationIssues.map((issue, i) => `${i + 1}. ${issue}`),
        '',
        '请确保每个任务标题严格使用以下格式：',
        '[文件/模块路径] 动作描述 - 预期结果',
        '',
        '正确示例：',
        '[apps/web/src/pages/login.tsx] 新增登录表单组件 - 用户可输入凭据并提交',
        '[services/agent-gateway/src/modules/order-store.ts] 写入订单与菜品明细 - 下单后可查询完整记录',
        '',
        '禁止以下写法：',
        '- 标题只是描述性文字（如"描述交互流程"→应改为"[docs/flow.md] 编写交互流程文档 - 包含完整状态图"）',
        '- 标题过于笼统（如"优化代码""完善逻辑"）',
        '- 缺少文件路径前缀',
        '- 缺少"动作 - 预期结果"结构',
      ].join('\n');
      persistPm2AssistantMessage({
        userId: input.handoff.userId,
        sessionId: input.toSessionId,
        handoffId: input.handoff.id,
        step: 'dispatch-empty',
        text: `⚠️ tasks.md 无法派发（格式不标准），退回 PM1 重新生成 tasks。\n\n${dispatchFeedback}`,
      });
      await createReturnToPm1Handoff({
        userId: input.handoff.userId,
        pm2HandoffId: input.handoff.id,
        pm1SessionId: input.handoff.fromSessionId,
        sourceIntent: '',
        teamWorkspaceId,
        feedback: dispatchFeedback,
        step: 'dispatch-empty',
      });
      return;
    } else if (packages.length === 0) {
      // packages 为空但 tasks 也为空（或其它原因），降级为单个综合 executor 任务
      persistPm2AssistantMessage({
        userId: input.handoff.userId,
        sessionId: input.toSessionId,
        handoffId: input.handoff.id,
        step: 'dispatch-fallback',
        text: `⚠️ 标准派发解析出 0 个包，将整个任务清单作为一个综合任务派发给 executor（降级模式）。`,
      });
      const fallbackTasksContent = tasksRow.content;
      packages.push({
        role: 'executor' as const,
        goal: `根据任务清单执行所有任务`,
        title: `综合执行任务（降级派发）`,
        context: `${context}\n\n**完整任务清单**：\n${fallbackTasksContent}`,
        taskMarkers: { parallel: false, kind: 'build', surface: 'cross-cutting' },
        artifactRefs: {
          specId: specArtifactId ?? undefined,
          planId: planArtifactId ?? undefined,
          tasksId: tasksArtifactId,
        },
      } as typeof packages[number]);
    }

    // D50 全局并发上限：当解析出的任务数超过派发上限时，buildDispatchPackages
    // 只保留前 maxDispatchPackages 个（按文档顺序，保留依赖前缀）。这里把截断
    // 作为一条 runtime incident 留痕，便于运维发现「计划过大被截断」。
    if (maxDispatchPackages > 0 && tasks.length > packages.length) {
      recordTeamRuntimeIncident({
        category: 'handoff_failure',
        code: 'pm2-dispatch-packages-capped',
        context: {
          handoffId: input.handoff.id,
          parsedTaskCount: tasks.length,
          dispatchedCount: packages.length,
          cap: maxDispatchPackages,
        },
        message: `tasks.md 解析出 ${tasks.length} 个任务，超过派发上限 ${maxDispatchPackages}，仅派发前 ${packages.length} 个`,
        severity: 'warning',
        timestamp: Date.now(),
        userId: input.handoff.userId,
      });
    }

    // 6. D46 动态编制：确保 executor 并行数 ≥ MIN_EXECUTOR_PARALLEL
    const parallelExecutors = packages.filter(
      (p) => p.role === 'executor' && p.taskMarkers.parallel,
    );
    const _effectiveParallel = Math.max(parallelExecutors.length, MIN_EXECUTOR_PARALLEL);
    // 上限检查（D50 全局并发上限）
    const _maxParallel = DEFAULT_MAX_EXECUTOR_PARALLEL;

    // 7. 为每个 package 创建 handoff（d→e/f/g）
    const createdHandoffs: HandoffRecord[] = [];
    for (const pkg of packages) {
      const toRoleLayer = pkg.role === 'reviewer' ? ('reviewer' as const) : ('executor' as const);
      const handoff = createHandoff({
        userId: input.handoff.userId,
        fromSessionId: input.toSessionId,
        fromRoleLayer: 'pm2',
        toRoleLayer,
        payload: pkg,
      });
      createdHandoffs.push(handoff);
      publishHandoffEvent({ type: 'handoff.created', record: handoff });
    }

    setD(SUBSTATES_D.AWAITING_EG);

    // 持久化 dispatch 决策到 message_v2
    const dispatchSummary = packages
      .map(
        (pkg, idx) =>
          `${idx + 1}. [${pkg.role}] ${pkg.goal}${pkg.taskMarkers.parallel ? ' (并行)' : ''}`,
      )
      .join('\n');
    persistPm2AssistantMessage({
      userId: input.handoff.userId,
      sessionId: input.toSessionId,
      handoffId: input.handoff.id,
      step: 'dispatch',
      text: `📋 已派发 ${packages.length} 个子任务：\n${dispatchSummary}\n\n_等待 executor/reviewer 完成后进行 Quality Review_`,
    });

    // 8. 写入 d 层 handoff 的 result_json（记录派发了哪些子 handoff）
    writeArchitectureReviewResult(input.handoff.id, {
      dispatchedHandoffIds: createdHandoffs.map((h) => h.id),
      packageCount: packages.length,
      parallelCount: parallelExecutors.length,
      architectureReview: architectureReviewResult,
      architectureReviewArtifactId,
      qualityReviewPending: true,
    });
  };
}

function validatePlanningReadiness(input: {
  specContent: string;
  planContent: string;
  tasksContent: string;
}): PlanningReadinessResult {
  const issues: string[] = [];
  const spec = validateSpecOutput(input.specContent);
  const plan = validatePlanOutput(input.planContent);
  const tasks = validateTasksOutput(input.tasksContent);

  if (!spec.ok) {
    issues.push(`spec 缺少：${spec.failed.join('、')}`);
  }
  if (!plan.ok) {
    issues.push(`plan 缺少：${plan.failed.join('、')}`);
  }
  if (!tasks.ok) {
    issues.push(`tasks 缺少：${tasks.failed.join('、')}`);
  }

  return {
    passed: issues.length === 0,
    issues,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * d.2 Architecture Review（规则代码实现，L1.2 要求不用 LLM）。
 *
 * 两阶段检查：
 *   1. 内置关键词 lint 规则（硬编码，覆盖常见架构违反）
 *   2. 项目 architecture.md 规则提取（如果 workspace 有 architecture.md，
 *      从中提取"不允许"/"禁止"/"must not"条款做关键词匹配）
 *
 * 返回结构化 review 结果。
 */
function runArchitectureLint(
  planContent: string,
  architectureContent?: string | null,
  options?: { architectureMdLoaded?: boolean },
): ArchitectureReviewResult {
  const issues: ArchitectureReviewIssue[] = [];
  const lintTarget = stripArchitecturePolicySections(planContent);
  const lower = lintTarget.toLowerCase();
  const pushIssue = (issue: ArchitectureReviewIssue) => {
    issues.push(issue);
  };

  // ─── 阶段 1：内置规则 ─────────────────────────────────────────────────

  // 规则 1：不允许直接操作数据库（应通过 store/repository 层）
  if (/直接.*sql|raw.*query|直接操作.*数据库/i.test(lintTarget)) {
    pushIssue({
      ruleId: 'builtin-no-direct-sql',
      severity: 'blocking',
      source: 'builtin',
      message: '计划中包含直接 SQL 操作，应通过 store/repository 层',
    });
  }

  // 规则 2：不允许在前端直接调后端内部接口
  if (/前端.*直接调.*内部|bypass.*gateway|绕过.*网关/i.test(lintTarget)) {
    pushIssue({
      ruleId: 'builtin-no-bypass-gateway',
      severity: 'blocking',
      source: 'builtin',
      message: '计划中包含绕过 gateway 的直接调用',
    });
  }

  // 规则 3：不允许硬编码密钥/token
  if (/硬编码.*key|hardcode.*secret|明文.*密码/i.test(lintTarget)) {
    pushIssue({
      ruleId: 'builtin-no-hardcoded-secret',
      severity: 'blocking',
      source: 'builtin',
      message: '计划中包含硬编码密钥/密码',
    });
  }

  // 规则 4：不允许全局可变状态（应使用 store/context）
  if (/全局变量|global.*mutable|window\.\w+\s*=/i.test(lower)) {
    pushIssue({
      ruleId: 'builtin-no-global-mutable',
      severity: 'warning',
      source: 'builtin',
      message: '计划中使用全局可变状态',
    });
  }

  // 规则 5：不允许同步阻塞 I/O（应使用 async）
  if (/同步.*读取|readFileSync|同步.*请求|synchronous.*io/i.test(lintTarget)) {
    pushIssue({
      ruleId: 'builtin-no-sync-io',
      severity: 'warning',
      source: 'builtin',
      message: '计划中包含同步阻塞 I/O 操作',
    });
  }

  // 规则 6：不允许跨层直接调用（应通过 handoff 协议）
  if (/直接调用.*executor|直接调用.*reviewer|跳过.*pm2|bypass.*handoff/i.test(lintTarget)) {
    pushIssue({
      ruleId: 'builtin-no-cross-layer-bypass',
      severity: 'blocking',
      source: 'builtin',
      message: '计划中包含跨层直接调用，应通过 handoff 协议',
    });
  }

  // ─── 阶段 2：从 architecture.md 提取禁止条款 ─────────────────────────

  if (architectureContent && architectureContent.trim().length > 0) {
    // 提取"不允许"/"禁止"/"must not"/"不得"条款
    const prohibitionPatterns = [
      /(?:不允许|禁止|不得|不可以|must not|shall not|do not|never)\s*[:：]?\s*(.+)/gi,
      /[-*]\s*(?:禁止|不允许|不得)\s*[:：]?\s*(.+)/gi,
    ];

    const prohibitions: string[] = [];
    for (const pattern of prohibitionPatterns) {
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(architectureContent)) !== null) {
        const clause = match[1]?.trim();
        if (clause && clause.length > 4 && clause.length < 200) {
          prohibitions.push(clause);
        }
      }
    }

    // 对每条禁止条款，检查 plan 中是否包含相关关键词
    for (const prohibition of prohibitions) {
      // 提取禁止条款中的关键名词（去掉停用词）
      const keywords = prohibition
        .replace(/[，。、；：""''（）[\]{}]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length >= 2)
        .filter(
          (w) => !['使用', '进行', '操作', '任何', '所有', '相关', '直接', '间接'].includes(w),
        )
        .slice(0, 5);

      if (keywords.length === 0) continue;

      // 如果 plan 中包含该条款的多个关键词，视为潜在违反
      const matchCount = keywords.filter((kw) => lower.includes(kw.toLowerCase())).length;
      if (matchCount >= Math.ceil(keywords.length * 0.6)) {
        pushIssue({
          ruleId: 'architecture-md-prohibition',
          severity: 'warning',
          source: 'architecture-md',
          message: `可能违反 architecture.md 条款：「${prohibition.slice(0, 80)}」`,
        });
      }
    }
  }

  const blockingCount = issues.filter((issue) => issue.severity === 'blocking').length;
  const warningCount = issues.filter((issue) => issue.severity === 'warning').length;
  return {
    passed: blockingCount === 0,
    issues,
    warningCount,
    blockingCount,
    architectureMdLoaded: options?.architectureMdLoaded === true,
  };
}

function stripArchitecturePolicySections(planContent: string): string {
  const lines = planContent.split('\n');
  const stripped: string[] = [];
  let skipSection = false;

  for (const line of lines) {
    if (/^##\s+/.test(line)) {
      skipSection = /^##\s+(架构守卫|宪法对齐检查)/.test(line.trim());
    }
    if (!skipSection) {
      stripped.push(line);
    }
  }

  return stripped.join('\n');
}

function buildArchitectureReviewMarkdown(result: ArchitectureReviewResult): string {
  const lines: string[] = [
    '# Architecture Review',
    '',
    `**总体判定**：${result.passed ? '✅ 通过' : '❌ 未通过'}`,
    `**阻断问题数**：${result.blockingCount}`,
    `**警告数**：${result.warningCount}`,
    `**加载 architecture.md**：${result.architectureMdLoaded ? '是' : '否'}`,
    '',
  ];

  const blockingIssues = result.issues.filter((issue) => issue.severity === 'blocking');
  const warnings = result.issues.filter((issue) => issue.severity === 'warning');

  lines.push('## Blocking Issues', '');
  if (blockingIssues.length === 0) {
    lines.push('无');
  } else {
    for (const issue of blockingIssues) {
      lines.push(`- [${issue.source}] ${issue.message}`);
    }
  }

  lines.push('', '## Warnings', '');
  if (warnings.length === 0) {
    lines.push('无');
  } else {
    for (const issue of warnings) {
      lines.push(`- [${issue.source}] ${issue.message}`);
    }
  }

  return lines.join('\n');
}

function createReviewArtifact(input: {
  sessionId: string;
  userId: string;
  teamWorkspaceId: string | null;
  result: ArchitectureReviewResult;
}): string {
  assertCanWriteArtifactPhase({
    roleLayer: 'pm2',
    phase: 'review_report',
    userId: input.userId,
    sessionId: input.sessionId,
  });

  const artifactId = randomUUID();
  sqliteRun(
    `INSERT INTO artifacts (
       id, session_id, user_id, type, title, content, version,
       phase, team_workspace_id, parent_artifact_id
     ) VALUES (?, ?, ?, 'markdown', 'Architecture Review', ?, 1, 'review_report', ?, NULL)`,
    [
      artifactId,
      input.sessionId,
      input.userId,
      buildArchitectureReviewMarkdown(input.result),
      input.teamWorkspaceId,
    ],
  );
  return artifactId;
}

function writeArchitectureReviewResult(handoffId: string, result: Record<string, unknown>): void {
  sqliteRun(
    `UPDATE handoff_records SET result_json = ?, updated_at = datetime('now') WHERE id = ?`,
    [JSON.stringify(result), handoffId],
  );
}

function readHandoffResultJson(handoffId: string): Record<string, unknown> | null {
  // 读取上游（pm1→pm2）handoff 的 result_json。
  // 上游 handoff 是：to_role_layer='pm1' 且 to_session_id = 当前 handoff 的 from_session_id。
  // 先尝试通过 from_session_id 关联找到上游 pm1 handoff。
  const currentHandoff = sqliteGet<{ from_session_id: string }>(
    `SELECT from_session_id FROM handoff_records WHERE id = ? LIMIT 1`,
    [handoffId],
  );
  if (!currentHandoff) return null;

  // 上游 pm1 handoff 的 to_session_id === 当前 pm2 handoff 的 from_session_id
  const upstreamRow = sqliteGet<{ result_json: string | null }>(
    `SELECT result_json FROM handoff_records
     WHERE to_session_id = ? AND to_role_layer = 'pm1' AND state = 'completed'
     ORDER BY completed_at DESC LIMIT 1`,
    [currentHandoff.from_session_id],
  );
  if (!upstreamRow?.result_json) return null;
  try {
    return JSON.parse(upstreamRow.result_json) as Record<string, unknown>;
  } catch (_err) {
    void _err;
    return null;
  }
}
