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
import {
  getResultProtocol,
  resolveSubmitProtocolMode,
  SUBMIT_EXECUTION_RESULT_PROTOCOL,
  SUBMIT_REVIEW_REPORT_PROTOCOL,
} from '../capability/completion-protocol-contract.js';
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
  const role = input.handoff.toRoleLayer;
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
  // 合并角色指令和完成协议，去除重复项（roleInstruction 的 1/2/5 与 completionProtocol 重叠）
  const roleInstruction =
    role === 'reviewer'
      ? [
          '你是代码审查员（Reviewer）。请对以下任务的实施结果进行代码评审。',
          '',
          '**完成协议——必须遵守**：',
          '1. 先直接读代码/查证据，不要只口头计划。禁止在第一轮就回复 end_turn。',
          '2. 必须先调用工具读取相关代码文件；如果代码不存在，明确标记"无法评审"。',
          '3. 结束前必须调用 submit_review 提交结构化结果：',
          '   - verdict: pass | fail',
          '   - items: [{ id, status: pass|fail, reason?, fileRefs? }]',
          '   - overallReason（可选）',
          '4. 只 mark_completed 或只写文字不算完成；hard 模式下缺少 submit_review 会 protocol-failure。',
          '5. 使用工具时必须传入完整参数，不允许空参数调用。',
        ].join('\n')
      : [
          '你是实施工程师（Executor）。请根据以下任务描述完成具体的代码实现或文档编写。',
          '',
          '**完成协议——必须遵守**：',
          '1. 第一轮必须调用工具——先读取相关文件，再写入/修改文件。禁止在第一轮就回复 end_turn。',
          '2. 使用 write/submit_patch/edit 产出实际文件；不要只回复文字描述。',
          '3. 结束前必须调用 submit_execution_result 提交硬契约：',
          '   - taskId / status / changedFiles',
          '   - checklist: [{ id, status: pass|fail|blocked, evidence }]',
          '   - summary / verification',
          '4.【自验证】checklist 覆盖任务验收条件；未覆盖标 fail/blocked，不要假 pass。',
          '5. 只 mark_completed 或只写文字不算完成；hard 模式下缺少 submit_execution_result 会 protocol-failure。',
          '6. 使用工具时必须传入完整参数，不允许空参数调用。',
        ].join('\n');

  const userMessage = [
    roleInstruction,
    buildTaskProfilePromptFragment(taskProfile),
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

  // 从 DB 读取 handoff 的 retry_count，用于生成唯一的 clientRequestId。
  // 如果 handoff 被 recoveryTick reclaim 后重新执行，retry_count 会递增，
  // 确保每次执行用不同的 clientRequestId，避免触发 replay。
  const handoffRetryRow = sqliteGet<{ retry_count: number }>(
    `SELECT retry_count FROM handoff_records WHERE id = ? LIMIT 1`,
    [input.handoff.id],
  );
  const handoffRetryCount = handoffRetryRow?.retry_count ?? 0;
  const streamClientRequestId = createHandoffStreamClientRequestId(
    input.handoff.id,
    handoffRetryCount,
  );

  // 解析 team root session id，让 stream 管线自动注入 resume context。
  // 执行层（executor/reviewer）需要知道整个任务树的未完成状态，
  // 避免重复执行已完成任务、能感知上下游进度。
  let teamResumeRootSessionId: string | undefined;
  try {
    const { resolveTeamRootSessionId } = await import('../../team/team-resume-context.js');
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
      signal: input.signal,
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

  // 失败判定：抛异常 或 返回 stopReason==='error' 或 stopReason 缺失。
  // 两者都视为本层执行失败。
  // 对于非 cancelled 的失败，先等 5 秒重试一次（LLM API 偶发 5xx/超时很常见），
  // 重试仍失败才抛异常让 watcher 走 failHandoff。
  // 注意：handleStreamRequest 的某些 early-return 路径（如 model route 解析失败、
  // replay 命中）返回不含 stopReason 的结果，这种"静默失败"必须被捕获，
  // 否则会走到 collectExecutionCompletionEvidence 并抛出"缺少 artifact"——
  // 错误消息不明确，不利于诊断。
  const streamFailed =
    streamThrew !== null ||
    !streamResult ||
    streamResult.stopReason === 'error' ||
    !streamResult.stopReason;
  if (streamFailed) {
    const reason =
      streamThrew instanceof Error
        ? streamThrew.message
        : typeof streamThrew === 'string'
          ? streamThrew
          : !streamResult
            ? 'stream 执行返回空结果（handleStreamRequest 可能未正确启动）'
            : !streamResult.stopReason
              ? `stream 执行返回无 stopReason（statusCode=${streamResult.statusCode ?? 'unknown'}），可能模型路由解析失败或 replay 命中`
              : (streamResult.errorSummary ?? '模型流式执行返回错误（stopReason=error）');

    // 重试一次——等 5 秒让模型服务恢复（比 3 秒更稳妥，
    // "模型服务内部错误"通常需要几秒恢复）
    console.warn(`[${role}-runner] stream 首次失败（${reason}），5 秒后重试一次…`);
    await new Promise<void>((resolve) => setTimeout(resolve, 5000));
    if (input.signal.aborted) return;

    // 检查是否有残留的 in-flight 请求（SESSION_ALREADY_RUNNING 场景）。
    // 如果有，等待它结束，避免重试被 single-flight 拒绝。
    try {
      const { getAnyInFlightStreamRequestForSession } =
        await import('../../routes/stream-cancellation.js');
      let waitCount = 0;
      while (waitCount < 10) {
        const inFlight = getAnyInFlightStreamRequestForSession({
          sessionId: input.toSessionId,
          userId: input.handoff.userId,
          excludeClientRequestId: streamClientRequestId,
        });
        if (!inFlight) break;
        console.warn(
          `[${role}-runner] 等待 session ${input.toSessionId} 的残留 in-flight 请求结束…`,
        );
        await new Promise<void>((resolve) => setTimeout(resolve, 1000));
        waitCount++;
      }
    } catch {
      /* best-effort */
    }

    // 如果 statusCode=409，尝试多种降级策略：
    // 1. 清除 session metadata 中的 modelId/providerId（模型绑定不可用场景）
    // 2. 解析辅助 LLM 配置，在 requestData 中显式传入 providerId/model（绕过 metadata 绑定）
    // 3. 清除 teamDefinition 中的模型绑定（防止 hasAuthoritativeTeamModel 仍为 true）
    let retryProviderId: string | undefined;
    let retryModel: string | undefined;
    if (streamResult?.statusCode === 409) {
      try {
        const metaRow = sqliteGet<{ metadata_json: string | null }>(
          `SELECT metadata_json FROM sessions WHERE id = ? LIMIT 1`,
          [input.toSessionId],
        );
        if (metaRow?.metadata_json) {
          const meta = JSON.parse(metaRow.metadata_json) as Record<string, unknown>;
          let changed = false;
          // 清除 session 级模型绑定
          if (meta['modelId']) {
            delete meta['modelId'];
            changed = true;
          }
          if (meta['providerId']) {
            delete meta['providerId'];
            changed = true;
          }
          // 清除 teamRoleInstance 中的模型绑定
          const roleInst = meta['teamRoleInstance'];
          if (typeof roleInst === 'object' && roleInst !== null) {
            const ri = roleInst as Record<string, unknown>;
            if (ri['modelId']) {
              delete ri['modelId'];
              changed = true;
            }
            if (ri['providerId']) {
              delete ri['providerId'];
              changed = true;
            }
          }
          // 清除 teamDefinition 中的成员模型绑定
          const teamDef = meta['teamDefinition'];
          if (typeof teamDef === 'object' && teamDef !== null) {
            const td = teamDef as Record<string, unknown>;
            if (Array.isArray(td['memberSlots'])) {
              td['memberSlots'] = (td['memberSlots'] as Array<Record<string, unknown>>).map(
                (slot) => {
                  const { modelId: _m, providerId: _p, ...rest } = slot;
                  void _m;
                  void _p;
                  return rest;
                },
              );
              changed = true;
            }
          }
          if (changed) {
            sqliteRun(`UPDATE sessions SET metadata_json = ? WHERE id = ?`, [
              JSON.stringify(meta),
              input.toSessionId,
            ]);
            console.warn(`[${role}-runner] 检测到 409，已清除 session metadata 中所有模型绑定`);
          }
        }

        // 解析辅助 LLM 配置，作为重试的显式 providerId/model
        const executorMemberModel = resolveMemberModelForSessionLayer({
          sessionId: input.toSessionId,
          layer: role,
        });
        const auxConfig = await resolveAuxiliaryLlmConfig(
          input.handoff.userId,
          executorMemberModel,
        );
        if (auxConfig) {
          retryProviderId = auxConfig.providerType ?? undefined;
          retryModel = auxConfig.model;
          console.warn(`[${role}-runner] 409 降级：重试将使用辅助 LLM 配置（model=${retryModel}）`);
        }
      } catch {
        /* best-effort */
      }
    }

    const retryStreamClientRequestId = `${streamClientRequestId}:retry`;
    try {
      const retryResult = await runSessionInBackground({
        sessionId: input.toSessionId,
        userId: input.handoff.userId,
        ...(teamResumeRootSessionId ? { teamResumeRootSessionId } : {}),
        requestData: {
          message: userMessage,
          model: retryModel ?? 'default',
          ...(retryProviderId ? { providerId: retryProviderId } : {}),
          clientRequestId: retryStreamClientRequestId,
          teamTaskThreadId: retryStreamClientRequestId,
        },
      });
      if (input.signal.aborted) return;
      if (
        retryResult.stopReason !== 'error' &&
        retryResult.stopReason !== 'cancelled' &&
        retryResult.stopReason
      ) {
        // 重试成功（有有效 stopReason 且非 error/cancelled）
        streamResult = retryResult;
        streamThrew = null;
      } else {
        // 重试也失败 → 抛异常
        const retryReason =
          retryResult.errorSummary ??
          `重试后仍 stopReason=${retryResult.stopReason ?? 'undefined'}`;
        throw new Error(`${role} 层执行失败（重试后仍失败）：${retryReason}`);
      }
    } catch (retryErr) {
      if (input.signal.aborted) return;
      throw new Error(
        `${role} 层执行失败（重试也失败）：${retryErr instanceof Error ? retryErr.message : String(retryErr)}`,
      );
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
    handoffId: input.handoff.id,
  });
  if (!completionEvidence.ok) {
    throw new Error(`${role} 层执行未产出可评审结果：${completionEvidence.reason}`);
  }

  // submit_execution_result 的 status=failed/blocked 视为执行层失败，
  // 不能把 substate 标成 completed，否则上层会把失败当成功收口。
  const submittedStatus =
    completionEvidence.resultJson && typeof completionEvidence.resultJson['status'] === 'string'
      ? completionEvidence.resultJson['status']
      : null;
  if (
    completionEvidence.protocol === SUBMIT_EXECUTION_RESULT_PROTOCOL &&
    (submittedStatus === 'failed' || submittedStatus === 'blocked')
  ) {
    setSubstate({
      sessionId: input.toSessionId,
      substate: 'failed',
      userId: input.handoff.userId,
      roleLayer: role,
    });
    const existing = completionEvidence.resultJson ?? {};
    sqliteRun(
      `UPDATE handoff_records SET result_json = ?, updated_at = datetime('now') WHERE id = ?`,
      [
        JSON.stringify({
          ...existing,
          role,
          taskTitle,
          summary: completionEvidence.summary,
          artifactCount: completionEvidence.artifactCount,
          evidenceSource: completionEvidence.source,
          completedAt: new Date().toISOString(),
          protocol: completionEvidence.protocol,
          protocolDegraded: false,
        }),
        input.handoff.id,
      ],
    );
    throw new Error(
      `${role} 层通过 submit_execution_result 报告 ${submittedStatus}：${completionEvidence.summary}`,
    );
  }

  // 设置完成 substate
  setSubstate({
    sessionId: input.toSessionId,
    substate: 'completed',
    userId: input.handoff.userId,
    roleLayer: role,
  });

  // 写入 handoff result_json：
  // - 若已有 submit_* protocol，合并 runner 元数据，不覆盖 checklist/items
  // - soft 兼容路径写入 protocolDegraded
  const existing = completionEvidence.resultJson ?? {};
  const mergedResult = {
    ...existing,
    role,
    taskTitle,
    summary: completionEvidence.summary,
    artifactCount: completionEvidence.artifactCount,
    evidenceSource: completionEvidence.source,
    completedAt: new Date().toISOString(),
    protocol:
      completionEvidence.protocol ??
      (completionEvidence.protocolDegraded ? 'stream-degraded' : 'stream'),
    protocolDegraded: completionEvidence.protocolDegraded,
  };
  sqliteRun(
    `UPDATE handoff_records SET result_json = ?, updated_at = datetime('now') WHERE id = ?`,
    [JSON.stringify(mergedResult), input.handoff.id],
  );
}

function collectExecutionCompletionEvidence(input: {
  role: 'executor' | 'reviewer';
  sessionId: string;
  userId: string;
  handoffId?: string;
}):
  | {
      ok: true;
      summary: string;
      artifactCount: number;
      source: 'artifact+summary' | 'artifact' | 'summary' | 'submit_protocol';
      protocol: string | null;
      protocolDegraded: boolean;
      resultJson: Record<string, unknown> | null;
    }
  | { ok: false; reason: string } {
  const handoffRow = input.handoffId
    ? sqliteGet<{ result_json: string | null }>(
        `SELECT result_json FROM handoff_records WHERE id = ? LIMIT 1`,
        [input.handoffId],
      )
    : sqliteGet<{ result_json: string | null }>(
        `SELECT result_json FROM handoff_records
          WHERE to_session_id = ? AND user_id = ?
          ORDER BY updated_at DESC LIMIT 1`,
        [input.sessionId, input.userId],
      );

  let resultJson: Record<string, unknown> | null = null;
  if (handoffRow?.result_json) {
    try {
      const parsed = JSON.parse(handoffRow.result_json) as unknown;
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        resultJson = parsed as Record<string, unknown>;
      }
    } catch {
      resultJson = null;
    }
  }

  const protocol = getResultProtocol(resultJson);
  const requiredProtocol =
    input.role === 'executor' ? SUBMIT_EXECUTION_RESULT_PROTOCOL : SUBMIT_REVIEW_REPORT_PROTOCOL;
  const mode = resolveSubmitProtocolMode();
  const hasSubmitProtocol = protocol === requiredProtocol;

  const summaryFromProtocol =
    resultJson && typeof resultJson['summary'] === 'string' ? resultJson['summary'] : '';

  const summaryFromMessages = extractLatestChildSessionSummary(
    listSessionMessagesV2({
      sessionId: input.sessionId,
      userId: input.userId,
      statuses: ['final'],
    }),
  );
  const summary = summaryFromProtocol.trim() || summaryFromMessages;
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

  if (hasSubmitProtocol) {
    return {
      ok: true,
      summary: hasSummary
        ? summary
        : input.role === 'reviewer'
          ? '已提交结构化评审结果。'
          : '已提交结构化执行结果。',
      artifactCount,
      source: 'submit_protocol',
      protocol,
      protocolDegraded: false,
      resultJson,
    };
  }

  // 缺硬契约
  if (mode === 'hard') {
    return {
      ok: false,
      reason: `缺少 ${requiredProtocol} 硬契约提交（OPENAWORK_TEAM_REQUIRE_SUBMIT_PROTOCOL=hard）`,
    };
  }

  // soft：兼容旧 artifact/summary 路径
  if (!hasSummary && !hasArtifact) {
    return {
      ok: false,
      reason: `缺少 ${requiredProtocol}，且缺少 artifact/有效 assistant 总结`,
    };
  }

  return {
    ok: true,
    summary: hasSummary
      ? summary
      : input.role === 'reviewer'
        ? '已提交评审 artifact。'
        : '已提交实现 artifact。',
    artifactCount,
    source: hasSummary && hasArtifact ? 'artifact+summary' : hasArtifact ? 'artifact' : 'summary',
    protocol: protocol,
    protocolDegraded: true,
    resultJson,
  };
}

function createHandoffStreamClientRequestId(handoffId: string, retryCount?: number): string {
  // 加入 retryCount 避免 handoff 被 recoveryTick reclaim 后重新执行时
  // 触发 replay（同一 clientRequestId 会命中 replayPersistedAssistantResponse，
  // 返回 { statusCode: 200 } 无 stopReason，导致 executor 判定为失败）。
  return retryCount && retryCount > 0
    ? `handoff:${handoffId}:r${retryCount}`
    : `handoff:${handoffId}`;
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
    typeof payload?.['resumeRootSessionId'] === 'string' ? payload['resumeRootSessionId'] : null;
  const qualityFeedback =
    typeof payload?.['qualityFeedback'] === 'string' ? payload['qualityFeedback'] : null;
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
          {
            type: 'text',
            text: `🔴 已退回重新规划 ${escalationRound} 轮仍未通过 PM2 检查，停止自动重试，等待用户介入。`,
          },
        ],
        clientRequestId: `pm1:${input.handoff.id}:escalation-limit-notice`,
      });
    } catch {
      /* best-effort */
    }
    return;
  }

  // 如果是质量评审退回的重新规划，在 PM1 session 和 reception session 各写一条消息，
  // 让前端对话流能清楚区分"首次规划"和"根据反馈修正的重新规划"。
  // PM1 session 的消息记录 PM1 内部的规划上下文；reception session 的消息让用户
  // 在接待层对话流中看到 PM1 正在根据反馈重新规划。
  if (isQualityFeedback && qualityFeedback) {
    try {
      const { appendSessionMessageV2 } = await import('../../message/message-v2-adapter.js');
      // 1. PM1 session 内部消息
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

      // 2. 向 reception session 写消息，让用户在接待层对话流中看到
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
              text: [
                `🔄 PM1 规划层正在根据 PM2 的反馈重新规划（第 ${escalationRound} 轮）…`,
                '',
                '**PM2 反馈的问题**：',
                qualityFeedback,
                '',
                'PM1 将针对以上问题修正 spec/plan/tasks，完成后重新提交给 PM2 审查。',
              ].join('\n'),
            },
          ],
          clientRequestId: `handoff:${input.handoff.id}:quality-feedback-reception`,
        });
      }
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
          {
            type: 'text',
            text: '⚠️ PM1 暂无可用的辅助 LLM 配置。请检查 AI API Key 设置。系统会自动重试。',
          },
        ],
        clientRequestId: `handoff:${input.handoff.id}:no-llm`,
      });
    } catch {
      /* best-effort */
    }
    throw new Error(
      'PM1 artifact chain: 无可用 LLM 配置（auxiliary-llm-config 未设置），等待自动重试',
    );
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
      const { buildTeamResumeSystemPrompt, buildTeamResumeContext } =
        await import('../../team/team-resume-context.js');
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
          .map((task, index) => `${index + 1}. ✅ ${task.title}（${task.roleLayer ?? 'unknown'}）`);
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
      const workingDir =
        typeof meta['workingDirectory'] === 'string' ? meta['workingDirectory'] : null;
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
