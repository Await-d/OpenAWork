/**
 * 260515-team-phase-c / 260516-team-phase-d / 260518-team-phase-e
 *
 * Watcher → Runner 分发（createPhaseCAwareRunner）
 *
 * 根据 handoff 的 toRoleLayer 分发到对应的 runner：
 *   - pm1 → runArtifactChain（spec/plan/tasks 产物链 + clarification 阻塞门禁）
 *   - pm2 → pm2-runner（constitution check + architecture review + dispatch + quality review）
 *   - executor/reviewer → runExecutionLayer（完整 stream 协议，与 chat 一致）
 */

import type { HandoffTaskRunner } from './watcher.js';
import { runArtifactChain } from './artifact-chain.js';
import { resolveAuxiliaryLlmConfig } from '../../provider/auxiliary-llm-config.js';
import {
  buildAuxiliaryTeamInstructionPrefix,
  prependAuxiliaryTeamInstructionPrefix,
} from '../../team/team-auxiliary-instruction-stack.js';
import {
  buildTeamRosterManifest,
  resolveMemberModelForSessionLayer,
} from '../bus/resolve-member-model.js';
import {
  buildTaskProfilePromptFragment,
  inferTaskProfile,
  taskProfileSchema,
} from '../capability/dispatch-package.js';
import { listSessionMessagesV2 } from '../../message/message-v2-adapter.js';
import { extractLatestChildSessionSummary } from '../../task/task-result-extraction.js';
import { sqliteGet } from '../../infra/db.js';

/**
 * 创建一个 task runner，根据 toRoleLayer 分发。
 */
export function createPhaseCAwareRunner(): HandoffTaskRunner {
  return async (input) => {
    if (input.signal.aborted) return;

    if (input.handoff.toRoleLayer === 'pm1') {
      await runPm1(input);
    } else if (input.handoff.toRoleLayer === 'pm2') {
      const { createPm2Runner } = await import('./pm2-runner.js');
      const pm2Runner = createPm2Runner();
      await pm2Runner(input);
    } else if (
      input.handoff.toRoleLayer === 'executor' ||
      input.handoff.toRoleLayer === 'reviewer'
    ) {
      await runExecutionLayer(input);
    }
  };
}

// ─── Executor / Reviewer Runner（e/f/g 层完整实现） ──────────────────────────
//
// 使用和 chat 完全一样的 stream 协议（runSessionInBackground）：
//   - 完整 7 层注入栈（AGENTS.md + constitution + SOUL + memory 等）
//   - Tool calling（bash / file_edit / search 等）
//   - Streaming（前端通过 /sessions/:id/stream/attach 实时看到）
//   - 消息自动持久化到 message_v2
//
// 流程：
//   1. 从 dispatch_package payload 构建 user message（任务描述）
//   2. 调 runSessionInBackground（内部走完整 stream 管线）
//   3. 检查执行结果：抛异常或 stopReason==='error' → 抛出让 watcher failHandoff
//   4. 成功才设置 substate='completed' 并写入 handoff result_json

async function runExecutionLayer(input: Parameters<HandoffTaskRunner>[0]): Promise<void> {
  if (input.handoff.toRoleLayer !== 'executor' && input.handoff.toRoleLayer !== 'reviewer') {
    throw new Error(`runExecutionLayer 收到非法层级：${input.handoff.toRoleLayer}`);
  }
  const payload = input.handoff.payload as Record<string, unknown> | null;
  const taskTitle =
    typeof payload?.['goal'] === 'string'
      ? payload['goal']
      : typeof payload?.['title'] === 'string'
        ? payload['title']
        : '未命名任务';
  const taskContext = typeof payload?.['context'] === 'string' ? payload['context'] : '';
  const role = input.handoff.toRoleLayer as 'executor' | 'reviewer';
  const parsedProfile = taskProfileSchema.safeParse(payload?.['taskProfile']);
  const taskProfile = parsedProfile.success
    ? parsedProfile.data
    : inferTaskProfile({ title: taskTitle, context: taskContext });

  const { setSubstate } = await import('../store/substate-store.js');
  const { runSessionInBackground } = await import('../../routes/stream-runtime.js');
  const { sqliteRun } = await import('../../infra/db.js');

  // 设置 substate
  setSubstate({
    sessionId: input.toSessionId,
    substate: role === 'reviewer' ? 'reviewing' : 'implementing',
    userId: input.handoff.userId,
    roleLayer: role,
  });

  if (input.signal.aborted) return;

  // 构建 user message：把任务描述作为用户输入发给 session
  const roleInstruction =
    role === 'reviewer'
      ? '请对以下任务的实施结果进行代码评审，指出问题并给出改进建议。你必须提交可评审结果，不允许只重复分析。'
      : '请根据以下任务描述进行实施，给出具体的代码实现。你必须留下可交付结果，不允许只重复分析。';

  const completionProtocol =
    role === 'reviewer'
      ? [
          '【完成协议】',
          '1. 先直接读代码/查证据，不要只口头计划。',
          '2. 结束前必须至少满足一项：提交 review artifact、输出结构化评审摘要。',
          '3. 如果连续两轮没有新证据、工具调用或有效结论，必须明确失败原因，不要重复 thinking。',
        ].join('\n')
      : [
          '【完成协议】',
          '1. 需要查文件/跑命令时直接调用工具，不要反复说“先看看结构”。',
          '2. 结束前必须至少满足一项：提交 patch/implementation artifact、或输出结构化实施摘要。',
          '3. 如果连续两轮没有实际产出、工具调用或结论，必须明确失败原因，不要重复 thinking。',
        ].join('\n');

  const userMessage = [
    roleInstruction,
    buildTaskProfilePromptFragment(taskProfile),
    completionProtocol,
    '',
    `**任务**：${taskTitle}`,
    taskContext ? `\n**上下文**：\n${taskContext}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  // 调用完整 stream 管线（和 chat 一样的协议）
  // 这会：
  //   - 拼装 7 层 system prompt（含 constitution / SOUL / memory）
  //   - 调 LLM（streaming）
  //   - 如果 LLM 返回 tool_use → 自动执行工具 → 继续对话
  //   - 所有消息自动写入 message_v2
  //   - 前端通过 /sessions/:id/stream/attach 能实时看到
  // 既要捕获 runSessionInBackground 抛出的异常（基础设施失败），也要检查它
  // 返回的 HandleStreamResult.stopReason —— provider 报错（如上游 5xx / 模型
  // 内部错误）通常**不抛异常**，而是返回 `{ stopReason: 'error', statusCode,
  // errorSummary }`。早期实现只 catch 异常并无脑标 completed，会把"流式失败"
  // 误判为"执行成功"，让 handoff 卡成假完成、上层链路继续派发错误产物。
  let streamResult: Awaited<ReturnType<typeof runSessionInBackground>> | null = null;
  let streamThrew: unknown = null;
  const streamClientRequestId = createHandoffStreamClientRequestId(input.handoff.id);

  // 解析 team root session id，让 stream 管线自动注入 resume context。
  // 执行层（executor/reviewer）需要知道整个任务树的未完成状态，
  // 避免重复执行已完成任务、能感知上下游进度。
  let teamResumeRootSessionId: string | undefined;
  try {
    const { resolveTeamRootSessionId } = await import(
      '../../team/team-resume-context.js'
    );
    const sessionMetaRow = sqliteGet<{ metadata_json: string | null }>(
      `SELECT metadata_json FROM sessions WHERE id = ? LIMIT 1`,
      [input.toSessionId],
    );
    if (sessionMetaRow) {
      const rootId = resolveTeamRootSessionId({
        metadataJson: sessionMetaRow.metadata_json,
        sessionId: input.toSessionId,
        userId: input.handoff.userId,
      });
      if (rootId) {
        teamResumeRootSessionId = rootId;
      }
    }
  } catch (err) {
    console.warn(
      `[${role}-runner] 解析 team root session id 失败：${err instanceof Error ? err.message : String(err)}`,
    );
  }

  try {
    streamResult = await runSessionInBackground({
      sessionId: input.toSessionId,
      userId: input.handoff.userId,
      ...(teamResumeRootSessionId ? { teamResumeRootSessionId } : {}),
      requestData: {
        message: userMessage,
        model: 'default',
        clientRequestId: streamClientRequestId,
        teamTaskThreadId: streamClientRequestId,
      },
    });
  } catch (err) {
    streamThrew = err;
    console.warn(
      `[${role}-runner] stream 执行异常：${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (input.signal.aborted) return;

  // 失败判定：抛异常 或 返回 stopReason==='error'。两者都视为本层执行失败。
  // 对于非 cancelled 的失败，先等 3 秒重试一次（LLM API 偶发 5xx/超时很常见），
  // 重试仍失败才抛异常让 watcher 走 failHandoff。
  const streamFailed = streamThrew !== null || streamResult?.stopReason === 'error';
  if (streamFailed) {
    const reason =
      streamThrew instanceof Error
        ? streamThrew.message
        : typeof streamThrew === 'string'
          ? streamThrew
          : (streamResult?.errorSummary ?? '模型流式执行返回错误（stopReason=error）');

    // 重试一次
    console.warn(`[${role}-runner] stream 首次失败（${reason}），3 秒后重试一次…`);
    await new Promise<void>((resolve) => setTimeout(resolve, 3000));
    if (input.signal.aborted) return;

    const retryStreamClientRequestId = `${streamClientRequestId}:retry`;
    try {
      const retryResult = await runSessionInBackground({
        sessionId: input.toSessionId,
        userId: input.handoff.userId,
        ...(teamResumeRootSessionId ? { teamResumeRootSessionId } : {}),
        requestData: {
          message: userMessage,
          model: 'default',
          clientRequestId: retryStreamClientRequestId,
          teamTaskThreadId: retryStreamClientRequestId,
        },
      });
      if (input.signal.aborted) return;
      if (retryResult.stopReason !== 'error' && retryResult.stopReason !== 'cancelled') {
        // 重试成功
        streamResult = retryResult;
        streamThrew = null;
      } else {
        // 重试也失败 → 抛异常
        const retryReason = retryResult.errorSummary ?? `重试后仍 stopReason=${retryResult.stopReason}`;
        throw new Error(`${role} 层执行失败（重试后仍失败）：${retryReason}`);
      }
    } catch (retryErr) {
      if (input.signal.aborted) return;
      throw new Error(`${role} 层执行失败（重试也失败）：${retryErr instanceof Error ? retryErr.message : String(retryErr)}`);
    }
  }

  // 取消判定：带内 cancel/pause 信号（team-stream-control gate）或用户在前端 stop
  // 都会让 stream 以 stopReason==='cancelled' 收尾。绝不能把它当成功——否则会
  // setSubstate('completed') + 让 watcher completeHandoff，把"被取消的任务"标成
  // "已完成"，上层链路继续基于不完整产物推进。抛出让 watcher 走 failHandoff；
  // 若 handoff 已是 cancelled 终态，failHandoff 是 no-op（幂等），不会破坏状态。
  if (streamResult?.stopReason === 'cancelled') {
    throw new Error(`${role} 层执行被取消（cancelled）`);
  }

  const completionEvidence = collectExecutionCompletionEvidence({
    role,
    sessionId: input.toSessionId,
    userId: input.handoff.userId,
  });
  if (!completionEvidence.ok) {
    throw new Error(`${role} 层执行未产出可评审结果：${completionEvidence.reason}`);
  }

  // 设置完成 substate
  setSubstate({
    sessionId: input.toSessionId,
    substate: 'completed',
    userId: input.handoff.userId,
    roleLayer: role,
  });

  // 写入 handoff result_json
  sqliteRun(
    `UPDATE handoff_records SET result_json = ?, updated_at = datetime('now') WHERE id = ?`,
    [
      JSON.stringify({
        role,
        taskTitle,
        summary: completionEvidence.summary,
        artifactCount: completionEvidence.artifactCount,
        evidenceSource: completionEvidence.source,
        completedAt: new Date().toISOString(),
        protocol: 'stream', // 标记使用了完整 stream 协议
      }),
      input.handoff.id,
    ],
  );
}

function collectExecutionCompletionEvidence(input: {
  role: 'executor' | 'reviewer';
  sessionId: string;
  userId: string;
}):
  | {
      ok: true;
      summary: string;
      artifactCount: number;
      source: 'artifact+summary' | 'artifact' | 'summary';
    }
  | { ok: false; reason: string } {
  const summary = extractLatestChildSessionSummary(
    listSessionMessagesV2({ sessionId: input.sessionId, userId: input.userId }),
  );
  const artifactRows = sqliteGet<{ count: number }>(
    `SELECT COUNT(*) AS count
       FROM artifacts
      WHERE session_id = ?
        AND user_id = ?
        AND phase IN ('patch', 'implementation', 'review_report')`,
    [input.sessionId, input.userId],
  );
  const artifactCount = artifactRows?.count ?? 0;
  const hasSummary = summary.trim().length > 0;
  const hasArtifact = artifactCount > 0;

  if (!hasSummary && !hasArtifact) {
    return { ok: false, reason: '缺少 artifact 且缺少有效 assistant 总结' };
  }

  return {
    ok: true,
    summary: hasSummary ? summary : input.role === 'reviewer' ? '已提交评审 artifact。' : '已提交实现 artifact。',
    artifactCount,
    source: hasSummary && hasArtifact ? 'artifact+summary' : hasArtifact ? 'artifact' : 'summary',
  };
}

function createHandoffStreamClientRequestId(handoffId: string): string {
  return `handoff:${handoffId}`;
}

function taskStatusLabel(status: string): string {
  switch (status) {
    case 'running':
      return '🔄';
    case 'blocked':
      return '🚫';
    case 'pending':
      return '⏳';
    case 'failed':
      return '❌';
    default:
      return status;
  }
}

// ─── PM1 Runner（Phase C artifact chain） ───────────────────────────────────

async function runPm1(input: Parameters<HandoffTaskRunner>[0]): Promise<void> {
  const payload = input.handoff.payload as Record<string, unknown> | null;
  const rewrittenIntent =
    typeof payload?.['rewrittenIntent'] === 'string'
      ? payload['rewrittenIntent']
      : typeof payload?.['intent'] === 'string'
        ? payload['intent']
        : '未提供意图';
  const sourceIntent =
    typeof payload?.['sourceIntent'] === 'string' ? payload['sourceIntent'] : rewrittenIntent;
  const teamWorkspaceId =
    typeof payload?.['teamWorkspaceId'] === 'string' ? payload['teamWorkspaceId'] : null;
  const isResume = payload?.['isResume'] === true;
  const resumeRootSessionId =
    typeof payload?.['resumeRootSessionId'] === 'string'
      ? payload['resumeRootSessionId']
      : null;
  const qualityFeedback =
    typeof payload?.['qualityFeedback'] === 'string'
      ? payload['qualityFeedback']
      : null;
  const isQualityFeedback = payload?.['isQualityFeedback'] === true;
  const escalationRound =
    typeof payload?.['escalationRound'] === 'number' ? payload['escalationRound'] : 0;

  // 防止无限退回循环：如果已退回 ≥4 轮仍不通过，停止重新规划并通知用户
  if (isQualityFeedback && escalationRound >= 4) {
    try {
      const { appendSessionMessageV2 } = await import('../../message/message-v2-adapter.js');
      // 找到 reception session 写消息
      const { sqliteGet } = await import('../../infra/db.js');
      const receptionRow = sqliteGet<{ from_session_id: string }>(
        `SELECT from_session_id FROM handoff_records
         WHERE to_role_layer = 'pm1' AND to_session_id = ?
         ORDER BY created_at DESC LIMIT 1`,
        [input.toSessionId],
      );
      if (receptionRow?.from_session_id) {
        appendSessionMessageV2({
          sessionId: receptionRow.from_session_id,
          userId: input.handoff.userId,
          role: 'assistant',
          agentId: 'interaction-agent',
          content: [
            {
              type: 'text',
              text: `🔴 PM1 已根据反馈重新规划 ${escalationRound} 轮仍未通过 PM2 检查，需要你的帮助。请检查 PM2 的反馈信息并调整需求或手动修正规划产物。\n\n**最新反馈**：\n${qualityFeedback ?? '无'}`,
            },
          ],
          clientRequestId: `pm1:${input.handoff.id}:escalation-limit`,
        });
      }
      appendSessionMessageV2({
        sessionId: input.toSessionId,
        userId: input.handoff.userId,
        role: 'assistant',
        agentId: 'pm1',
        content: [
          { type: 'text', text: `🔴 已退回重新规划 ${escalationRound} 轮仍未通过 PM2 检查，停止自动重试，等待用户介入。` },
        ],
        clientRequestId: `pm1:${input.handoff.id}:escalation-limit-notice`,
      });
    } catch {
      /* best-effort */
    }
    return;
  }

  // 如果是质量评审退回的重新规划，在 PM1 session 写一条明确的标注消息，
  // 让前端对话流能清楚区分"首次规划"和"根据反馈修正的重新规划"。
  if (isQualityFeedback && qualityFeedback) {
    try {
      const { appendSessionMessageV2 } = await import('../../message/message-v2-adapter.js');
      appendSessionMessageV2({
        sessionId: input.toSessionId,
        userId: input.handoff.userId,
        role: 'assistant',
        agentId: 'pm1',
        content: [
          {
            type: 'text',
            text: [
              `🔄 **质量评审退回重新规划（第 ${escalationRound} 轮）**`,
              '',
              '上次规划未通过 PM2 质量评审，以下是评审反馈。我将根据反馈修正 spec/plan/tasks 后重新提交。',
              '',
              qualityFeedback,
            ].join('\n'),
          },
        ],
        clientRequestId: `handoff:${input.handoff.id}:quality-feedback-notice`,
      });
    } catch {
      /* best-effort */
    }
  }

  const pm1MemberModel = resolveMemberModelForSessionLayer({
    sessionId: input.toSessionId,
    layer: 'pm1',
  });
  const llmConfig = await resolveAuxiliaryLlmConfig(input.handoff.userId, pm1MemberModel);
  if (!llmConfig) {
    // 不直接抛异常——写消息让用户知道，然后抛出可重试的错误。
    // watcher catch 块会 failHandoff，但 recovery tick 会 reclaim 重试。
    const { appendSessionMessageV2 } = await import('../../message/message-v2-adapter.js');
    try {
      appendSessionMessageV2({
        sessionId: input.toSessionId,
        userId: input.handoff.userId,
        role: 'assistant',
        agentId: 'pm1',
        content: [
          { type: 'text', text: '⚠️ PM1 暂无可用的辅助 LLM 配置。请检查 AI API Key 设置。系统会自动重试。' },
        ],
        clientRequestId: `handoff:${input.handoff.id}:no-llm`,
      });
    } catch {
      /* best-effort */
    }
    throw new Error('PM1 artifact chain: 无可用 LLM 配置（auxiliary-llm-config 未设置），等待自动重试');
  }

  const { requestWorkflowLlmCompletion } = await import('../../routes/workflow-llm.js');
  // 动态注入「团队编制清单」：PM1 规划时也让它感知当前实时花名册（含自定义角色），
  // 据此把任务拆给真实存在的角色。reception/pm1/pm2 走辅助 LLM 路径，这里手动前置。
  const rosterManifest = buildTeamRosterManifest({
    fromSessionId: input.toSessionId,
    currentLayer: 'pm1',
  });
  const instructionPrefix = await buildAuxiliaryTeamInstructionPrefix({
    userId: input.handoff.userId,
    sessionId: input.toSessionId,
    teamWorkspaceId,
    roleLayer: 'pm1',
  });

  // resume 模式：构建续接上下文系统提示，注入到每次 LLM 调用中，
  // 让 PM1 在生成 spec/plan/tasks 时优先复用已有产物、续接未完成任务，
  // 而非从头重新规划。同时构建任务状态摘要，让 tasks 生成时能标注已完成项。
  let resumeSystemPrompt: string | null = null;
  let taskStatusSummary: string | null = null;
  if (isResume && resumeRootSessionId) {
    try {
      const {
        buildTeamResumeSystemPrompt,
        buildTeamResumeContext,
      } = await import('../../team/team-resume-context.js');
      resumeSystemPrompt = await buildTeamResumeSystemPrompt({
        rootSessionId: resumeRootSessionId,
        userId: input.handoff.userId,
      });

      // 构建任务状态摘要：让 PM1 在生成 tasks 时看到具体的已完成/未完成任务，
      // 能标注哪些已完成、重点规划哪些需要继续推进。
      const resumeContext = await buildTeamResumeContext({
        rootSessionId: resumeRootSessionId,
        userId: input.handoff.userId,
      });
      if (resumeContext) {
        const completedLines = resumeContext.completedTasks
          .slice(0, 8)
          .map(
            (task, index) =>
              `${index + 1}. ✅ ${task.title}（${task.roleLayer ?? 'unknown'}）`,
          );
        const incompleteLines = resumeContext.incompleteTasks
          .slice(0, 10)
          .map(
            (task, index) =>
              `${index + 1}. ${taskStatusLabel(task.status)} ${task.title}（${task.roleLayer ?? 'unknown'}）${task.substate ? `，阶段 ${task.substate}` : ''}`,
          );
        const parts: string[] = [];
        if (completedLines.length > 0) {
          parts.push(
            `已完成任务（${resumeContext.completedTaskCount} 个，不需要重新执行）：\n${completedLines.join('\n')}`,
          );
        }
        if (incompleteLines.length > 0) {
          parts.push(
            `未完成任务（${resumeContext.incompleteTasks.length} 个，需要继续推进）：\n${incompleteLines.join('\n')}`,
          );
        }
        if (parts.length > 0) {
          taskStatusSummary = parts.join('\n\n');
        }
      }
    } catch (err) {
      console.warn(
        `[pm1-runner] 构建 resume 上下文失败，按正常流程处理：${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // 质量反馈系统提示：当 PM2 退回 PM1 重新规划时，把反馈注入到每次 LLM 调用中，
  // 让 spec/plan/tasks 每一步都能看到评审问题并针对性修正。
  const qualityFeedbackSystemPrompt = qualityFeedback
    ? [
        '[QUALITY REVIEW FEEDBACK]',
        '上次的规划未通过质量评审，已退回重新规划。请在整个规划过程中注意以下问题，',
        '确保修正后的 spec/plan/tasks 能解决评审指出的每个问题：',
        '',
        qualityFeedback,
        '[/QUALITY REVIEW FEEDBACK]',
      ].join('\n')
    : null;

  const callLlm = async (systemPrompt: string, userMessage: string): Promise<string> => {
    if (input.signal.aborted) {
      throw new Error('aborted');
    }
    let systemWithExtras = systemPrompt;
    if (rosterManifest) {
      systemWithExtras = `${systemWithExtras}\n\n${rosterManifest}`;
    }
    if (resumeSystemPrompt) {
      systemWithExtras = `${systemWithExtras}\n\n${resumeSystemPrompt}`;
    }
    if (qualityFeedbackSystemPrompt) {
      systemWithExtras = `${systemWithExtras}\n\n${qualityFeedbackSystemPrompt}`;
    }
    const systemWithKnowledge = prependAuxiliaryTeamInstructionPrefix({
      instructionPrefix,
      prompt: systemWithExtras,
    });
    return requestWorkflowLlmCompletion({
      apiBaseUrl: llmConfig.apiBaseUrl,
      apiKey: llmConfig.apiKey,
      model: llmConfig.model,
      ...(llmConfig.providerType ? { providerType: llmConfig.providerType } : {}),
      ...(llmConfig.upstreamProtocol ? { upstreamProtocol: llmConfig.upstreamProtocol } : {}),
      prompt: `${systemWithKnowledge}\n\n---\n\n${userMessage}`,
      temperature: 0.3,
      usageContext: {
        userId: input.handoff.userId,
        sessionId: input.toSessionId,
        layer: 'pm1',
        ...(typeof llmConfig.inputPricePerMillion === 'number'
          ? { inputPricePerMillion: llmConfig.inputPricePerMillion }
          : {}),
        ...(typeof llmConfig.outputPricePerMillion === 'number'
          ? { outputPricePerMillion: llmConfig.outputPricePerMillion }
          : {}),
      },
    });
  };

  // 构建项目上下文摘要：从 session metadata 解析 workingDirectory，
  // 尝试读取 AGENTS.md 的前 2000 字符作为项目结构/技术栈摘要。
  // 让 PM1 在生成 spec/plan/tasks 时能感知实际项目架构。
  let projectContext: string | null = null;
  try {
    const sessionMetaRow = sqliteGet<{ metadata_json: string | null }>(
      `SELECT metadata_json FROM sessions WHERE id = ? LIMIT 1`,
      [input.toSessionId],
    );
    if (sessionMetaRow?.metadata_json) {
      const meta = JSON.parse(sessionMetaRow.metadata_json) as Record<string, unknown>;
      const workingDir = typeof meta['workingDirectory'] === 'string' ? meta['workingDirectory'] : null;
      if (workingDir) {
        const { readFileSync, existsSync } = await import('node:fs');
        const { join } = await import('node:path');
        const agentsPath = join(workingDir, 'AGENTS.md');
        if (existsSync(agentsPath)) {
          const content = readFileSync(agentsPath, 'utf-8');
          // 截取前 2000 字符，避免 prompt 过长
          projectContext = content.slice(0, 2000);
        }
      }
    }
  } catch (ctxErr) {
    console.warn(
      `[pm1-runner] 构建项目上下文失败：${ctxErr instanceof Error ? ctxErr.message : String(ctxErr)}`,
    );
  }

  await runArtifactChain({
    userId: input.handoff.userId,
    sessionId: input.toSessionId,
    handoff: input.handoff,
    sourceIntent,
    rewrittenIntent,
    teamWorkspaceId,
    callLlm,
    signal: input.signal,
    ...(taskStatusSummary ? { taskStatusSummary } : {}),
    ...(projectContext ? { projectContext } : {}),
    ...(qualityFeedback ? { qualityFeedback } : {}),
  });
}
