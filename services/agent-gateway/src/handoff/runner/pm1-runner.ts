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
  buildTeamRosterManifest,
  resolveMemberModelForSessionLayer,
} from '../bus/resolve-member-model.js';
import {
  buildTaskProfilePromptFragment,
  inferTaskProfile,
  taskProfileSchema,
} from '../capability/dispatch-package.js';

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
//   3. stream 完成后设置 substate='completed'
//   4. 写入 handoff result_json

async function runExecutionLayer(input: Parameters<HandoffTaskRunner>[0]): Promise<void> {
  const payload = input.handoff.payload as Record<string, unknown> | null;
  const taskTitle = typeof payload?.['title'] === 'string' ? payload['title'] : '未命名任务';
  const taskContext = typeof payload?.['context'] === 'string' ? payload['context'] : '';
  const role = input.handoff.toRoleLayer; // 'executor' | 'reviewer'
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
      ? '请对以下任务的实施结果进行代码评审，指出问题并给出改进建议。'
      : '请根据以下任务描述进行实施，给出具体的代码实现。';

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
  try {
    await runSessionInBackground({
      sessionId: input.toSessionId,
      userId: input.handoff.userId,
      requestData: {
        message: userMessage,
        model: 'default',
      },
    });
  } catch (err) {
    // stream 失败不一定是致命的（可能是 tool 执行失败等），
    // 消息可能已经部分写入了。记录错误但不阻塞 handoff 完成。
    console.warn(
      `[${role}-runner] stream 执行异常：${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (input.signal.aborted) return;

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
        completedAt: new Date().toISOString(),
        protocol: 'stream', // 标记使用了完整 stream 协议
      }),
      input.handoff.id,
    ],
  );
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

  const pm1MemberModel = resolveMemberModelForSessionLayer({
    sessionId: input.toSessionId,
    layer: 'pm1',
  });
  const llmConfig = await resolveAuxiliaryLlmConfig(input.handoff.userId, pm1MemberModel);
  if (!llmConfig) {
    throw new Error('PM1 artifact chain: 无可用 LLM 配置（auxiliary-llm-config 未设置）');
  }

  const { requestWorkflowLlmCompletion } = await import('../../routes/workflow-llm.js');
  // 动态注入「团队编制清单」：PM1 规划时也让它感知当前实时花名册（含自定义角色），
  // 据此把任务拆给真实存在的角色。reception/pm1/pm2 走辅助 LLM 路径，这里手动前置。
  const rosterManifest = buildTeamRosterManifest({
    fromSessionId: input.toSessionId,
    currentLayer: 'pm1',
  });
  const callLlm = async (systemPrompt: string, userMessage: string): Promise<string> => {
    if (input.signal.aborted) {
      throw new Error('aborted');
    }
    const systemWithRoster = rosterManifest
      ? `${systemPrompt}\n\n${rosterManifest}`
      : systemPrompt;
    return requestWorkflowLlmCompletion({
      apiBaseUrl: llmConfig.apiBaseUrl,
      apiKey: llmConfig.apiKey,
      model: llmConfig.model,
      ...(llmConfig.providerType ? { providerType: llmConfig.providerType } : {}),
      ...(llmConfig.upstreamProtocol ? { upstreamProtocol: llmConfig.upstreamProtocol } : {}),
      prompt: `${systemWithRoster}\n\n---\n\n${userMessage}`,
      temperature: 0.3,
    });
  };

  await runArtifactChain({
    userId: input.handoff.userId,
    sessionId: input.toSessionId,
    handoff: input.handoff,
    sourceIntent,
    rewrittenIntent,
    teamWorkspaceId,
    callLlm,
    signal: input.signal,
  });
}
