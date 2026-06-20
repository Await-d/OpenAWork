/**
 * 260518-team-l1.3 · Reception → PM1 自动编排器（B1）
 *
 * 当 reception session 收到第一条 `user_input` 时，自动：
 *   1. 调 interaction-agent LLM 把自然语言意图改写为结构化指令
 *   2. 创建 handoff(reception → pm1)，把改写后的意图写入 payload
 *   3. 把 reception 的 substate 推到 'dispatching'，方便前端 UI 反馈
 *
 * 与 `POST /team/interaction-agent/rewrite` 路由的区别：
 *   - 路由是显式 HTTP 入口（前端可直接调）
 *   - 本模块是在 inbound submit 路径里调用的"隐式"编排
 *   - 二者共用 prompt + LLM 调用，避免分叉
 *
 * 关联文档：
 *   - docs/team-architecture-deferred-decisions.md D26（b 直答 vs 走 c 路由）
 *   - docs/team-architecture-l1-3-streaming-handoff-spec.md §1.1.3
 */

import { sqliteAll, sqliteGet, sqliteRun as dbSqliteRun } from '../../infra/db.js';
import { createHash, randomUUID } from 'node:crypto';
import { resolveAuxiliaryLlmConfig } from '../../provider/auxiliary-llm-config.js';
import { resolveMemberModelForSessionLayer } from '../bus/resolve-member-model.js';
import { createHandoff } from '../store/handoff-store.js';
import { publishHandoffEvent, publishTeamEvent } from '../bus/team-events-bus.js';
import { recordLatency } from '../bus/latency-monitor.js';
import { setSubstate, SUBSTATES_RECEPTION } from '../store/substate-store.js';
import { appendSessionMessageV2 } from '../../message/message-v2-adapter.js';
import { routeByRules, routeByLlm, type RouteResult, type RouteLlmContext } from './reception-router.js';
import {
  buildTeamResumeContext,
  resolveTeamRootSessionId,
  type TeamResumeContext,
} from '../../team/team-resume-context.js';
import {
  buildAuxiliaryTeamInstructionPrefix,
  prependAuxiliaryTeamInstructionPrefix,
} from '../../team/team-auxiliary-instruction-stack.js';

const INTERACTION_AGENT_PROMPT_TEMPLATE = (
  intent: string,
  contextBlock: string,
) => `你是一个团队协作交互代理（interaction-agent）。你的任务是将用户的自然语言意图改写为结构化的团队任务指令。

改写要求：
1. 保留用户原始意图的核心语义
2. 将模糊需求拆解为可执行的子任务
3. 为每个子任务推荐合适的执行角色（planner/researcher/executor/reviewer）
4. 给出推荐的下一步动作
5. 用中文输出

【收敛而非回问】
- 默认替用户补全合理的默认假设，让团队能直接开工，不要把可自行判断的细节留成开放问题。
- 对能从常识 / 行业惯例 / 项目上下文推断的点（技术选型、命名、范围边界等），直接在改写结果里写明「假设：……」，不要作为待澄清项抛回。
- 只有当核心目标本身缺失或自相矛盾、无任何合理默认值时，才在改写结果里点出唯一一个真正需要用户确认的关键点。

用户意图：${intent}${contextBlock}

请按以下格式输出：
【改写结果】<改写后的结构化意图，含已采用的关键假设>
【推荐角色】<planner/researcher/executor/reviewer>
【下一步】<推荐的下一步动作>`;

function extractField(text: string, label: string): string | null {
  const pattern = new RegExp(`【${label}】(.+?)(?:【|$)`, 's');
  const match = pattern.exec(text);
  return match?.[1]?.trim() ?? null;
}

function normalizeReceptionStreamClientRequestId(raw: string): string {
  if (raw.length <= 128) {
    return raw;
  }

  const digest = createHash('sha256').update(raw).digest('hex').slice(0, 48);
  return `reception-client:${digest}`;
}

function createReceptionStreamClientRequestId(input: {
  clientIdempotencyKey?: string | null;
  streamClientRequestId?: string | null;
}): string {
  const explicitStreamId = input.streamClientRequestId?.trim();
  if (explicitStreamId && explicitStreamId.length > 0) {
    return normalizeReceptionStreamClientRequestId(explicitStreamId);
  }

  const legacyIdempotencyKey = input.clientIdempotencyKey?.trim();
  if (legacyIdempotencyKey && legacyIdempotencyKey.length > 0) {
    return normalizeReceptionStreamClientRequestId(legacyIdempotencyKey);
  }

  return `reception:${randomUUID()}`;
}

export interface OrchestrateReceptionInput {
  userId: string;
  /** reception session id（即 from_session_id） */
  receptionSessionId: string;
  /** 用户输入的原始 intent */
  userIntent: string;
  /** 可选上下文摘要 */
  context?: string | null;
  /** team workspace id（可选，会注入 handoff payload 让 c 拿到 constitution） */
  teamWorkspaceId?: string | null;
  /**
   * @deprecated 使用 persistUserMessage / persistAckMessage 替代
   *
   * 为兼容旧测试保留：true 时 user + ack 都写；false 时都不写。
   * 如果 persistUserMessage / persistAckMessage 显式给值，会以它们为准。
   */
  persistMessages?: boolean;
  /**
   * 是否在 LLM 之前同步写入用户消息。
   * 默认 true（让 reception session reload 能立刻看到用户输入）。
   * inbound HTTP 路径已在响应前同步写过，会传 false 避免重复。
   */
  persistUserMessage?: boolean;
  /**
   * 是否在 LLM 完成后写入 assistant ack 消息。
   * 默认 true（让用户看到团队的回应）。
   */
  persistAckMessage?: boolean;
  /**
   * 旧调用方传入的客户端幂等 key。这里仅作为 stream clientRequestId 的 fallback，
   * HTTP inbound 路径应优先传 streamClientRequestId。
   */
  clientIdempotencyKey?: string | null;
  /** stream/message 去重使用的 request id，必须满足 stream schema 的长度约束。 */
  streamClientRequestId?: string | null;
  /**
   * 任务派发前是否自动跑完未完成的初始化步骤（了解项目 / 提取记忆 / 绑定工具）。
   * 默认 true（周全性：用户直接提任务时也先让团队了解项目）。仅在 orchestrate
   * 路径（真任务）生效；direct / clarify（闲聊问候）不触发，避免无谓等待。
   */
  autoRunInit?: boolean;
}

export interface OrchestrateReceptionResult {
  /** 是否真的触发了编排（feature flag 关、已存在活跃 handoff 等情况会跳过） */
  triggered: boolean;
  reason?: string;
  handoffId?: string;
  rewrittenIntent?: string;
  recommendedRole?: string;
  recommendedNextStep?: string;
}

/**
 * 检查 reception session 是否已有活跃的 handoff（pending/claimed/running）。
 * 有的话就跳过，避免一次输入触发多个并行 c 链路。
 */
function hasActiveHandoffFor(receptionSessionId: string): boolean {
  const rows = sqliteAll<{ id: string }>(
    `SELECT id FROM handoff_records
     WHERE from_session_id = ?
       AND state IN ('pending', 'claimed', 'running')
     LIMIT 1`,
    [receptionSessionId],
  );
  return rows.length > 0;
}

/**
 * 同步写一条 reception 用户消息（不触发任何 LLM 或 handoff）。
 * 用于 HTTP 路径在响应前同步保证用户能看到自己的输入，避免依赖异步编排完成时机。
 */
export function persistReceptionUserMessage(input: {
  userId: string;
  receptionSessionId: string;
  userIntent: string;
  streamClientRequestId?: string | null;
}): void {
  if (input.userIntent.trim().length === 0) return;
  try {
    appendSessionMessageV2({
      sessionId: input.receptionSessionId,
      userId: input.userId,
      role: 'user',
      content: [{ type: 'text', text: input.userIntent }],
      clientRequestId: input.streamClientRequestId ?? null,
    });
  } catch (err) {
    console.warn(
      `[reception-orchestrator] persistReceptionUserMessage 失败：${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * In-process guard against concurrent reception→pm1 orchestration for the SAME
 * reception session. `hasActiveHandoffFor` (a DB read) and the eventual
 * `createHandoff` are separated by up to two LLM round-trips (the router, up to
 * 3s, plus the interaction-agent rewrite, up to 60s). Two `user_input` submits
 * that arrive without a shared `clientIdempotencyKey` (rapid double-send, two
 * tabs) both fire this fire-and-forget orchestrate, both pass the
 * active-handoff check (neither has created a handoff yet), and both
 * `createHandoff(reception→pm1)` — spawning two parallel pm1 chains, exactly
 * what the active-handoff guard is meant to prevent. A status read can't close
 * that window because the two reads interleave before either write. An
 * in-flight Set keyed by (userId, receptionSessionId) makes the second caller a
 * deterministic no-op (mirrors `inFlightPm2QualityReviews`). Cleared in
 * `finally`, so a crash releases the key instead of wedging the session.
 */
const inFlightReceptionOrchestrations = new Set<string>();

/**
 * 主入口：自动把 reception 的 user_input 转换为 handoff(reception → pm1)。
 *
 * 失败时不抛错（会通过 result.reason 返回），让调用方决定是否要把错误透给客户端。
 * 这里的设计原则是"orchestration 失败不阻塞 inbound 入库"——inbound 仍然落库了，
 * 用户可以通过 UI 重试 / 手动调 /team/interaction-agent/rewrite 兜底。
 */
export async function orchestrateReceptionInput(
  input: OrchestrateReceptionInput,
): Promise<OrchestrateReceptionResult> {
  // persistMessages（旧）作为默认值；若 persistUserMessage / persistAckMessage 显式给值则以它们为准
  const defaultPersist = input.persistMessages !== false;
  const persistUser = input.persistUserMessage ?? defaultPersist;
  const persistAck = input.persistAckMessage ?? defaultPersist;
  const streamClientRequestId = createReceptionStreamClientRequestId({
    clientIdempotencyKey: input.clientIdempotencyKey,
    streamClientRequestId: input.streamClientRequestId,
  });

  // 1. 立刻把用户输入写入消息流（仅在 persistUser=true 时）
  if (persistUser) {
    persistReceptionUserMessage({
      userId: input.userId,
      receptionSessionId: input.receptionSessionId,
      userIntent: input.userIntent,
      streamClientRequestId,
    });
  }

  if (hasActiveHandoffFor(input.receptionSessionId)) {
    if (persistAck) {
      writeAck(input.userId, input.receptionSessionId, FALLBACK_ACK_HANDOFF_ACTIVE);
    }
    return { triggered: false, reason: 'handoff-active' };
  }

  // §0.145 concurrent-orchestration guard: a second submit that lands while the
  // first is still inside its router / rewrite LLM calls must NOT create a
  // second reception→pm1 handoff. Treat it like an already-active handoff.
  const inFlightKey = `${input.userId}::${input.receptionSessionId}`;
  if (inFlightReceptionOrchestrations.has(inFlightKey)) {
    if (persistAck) {
      writeAck(input.userId, input.receptionSessionId, FALLBACK_ACK_HANDOFF_ACTIVE);
    }
    return { triggered: false, reason: 'orchestration-in-flight' };
  }
  inFlightReceptionOrchestrations.add(inFlightKey);
  try {
    return await runReceptionOrchestrationBody(input, persistAck, streamClientRequestId);
  } finally {
    inFlightReceptionOrchestrations.delete(inFlightKey);
  }
}

async function runReceptionOrchestrationBody(
  input: OrchestrateReceptionInput,
  persistAck: boolean,
  streamClientRequestId: string,
): Promise<OrchestrateReceptionResult> {
  const receptionMemberModel = resolveMemberModelForSessionLayer({
    sessionId: input.receptionSessionId,
    layer: 'reception',
  });
  const llmConfig = await resolveAuxiliaryLlmConfig(input.userId, receptionMemberModel);
  if (!llmConfig) {
    if (persistAck) {
      writeAck(input.userId, input.receptionSessionId, FALLBACK_ACK_NO_LLM);
    }
    return { triggered: false, reason: 'no-llm-config' };
  }
  const instructionPrefix = await buildAuxiliaryTeamInstructionPrefix({
    userId: input.userId,
    sessionId: input.receptionSessionId,
    teamWorkspaceId: input.teamWorkspaceId ?? null,
    roleLayer: 'reception',
  });

  // ─── L1.2 b.router：意图路由判断 ─────────────────────────────────────────
  // 规则做确定性预筛（问候/致谢→direct，空/极短→clarify），其余交给 LLM。
  // LLM 同时看到用户输入和历史任务上下文，判断是 resume / orchestrate / direct / clarify。
  let routeResult: RouteResult | null = routeByRules(input.userIntent);
  if (!routeResult) {
    // 构建 LLM 路由上下文：让 LLM 看到上次任务的状态，从而判断是否需要续接
    const routeLlmContext = await buildRouteLlmContext({
      userId: input.userId,
      receptionSessionId: input.receptionSessionId,
    });

    const { requestWorkflowLlmCompletion } = await import('../../routes/workflow-llm.js');
    routeResult = await routeByLlm(
      input.userIntent,
      async (prompt) => {
        return requestWorkflowLlmCompletion({
          apiBaseUrl: llmConfig.apiBaseUrl,
          apiKey: llmConfig.apiKey,
          model: llmConfig.model,
          ...(llmConfig.providerType ? { providerType: llmConfig.providerType } : {}),
          ...(llmConfig.upstreamProtocol ? { upstreamProtocol: llmConfig.upstreamProtocol } : {}),
          prompt: prependAuxiliaryTeamInstructionPrefix({
            instructionPrefix,
            prompt,
          }),
          temperature: 0.1,
          usageContext: {
            userId: input.userId,
            sessionId: input.receptionSessionId,
            layer: 'reception',
            ...(typeof llmConfig.inputPricePerMillion === 'number'
              ? { inputPricePerMillion: llmConfig.inputPricePerMillion }
              : {}),
            ...(typeof llmConfig.outputPricePerMillion === 'number'
              ? { outputPricePerMillion: llmConfig.outputPricePerMillion }
              : {}),
          },
        });
      },
      routeLlmContext,
    );
  }

  // 写 audit log（L1.4 要求）——路由决策只记录到审计日志，不展示给用户
  logRouteDecision(input.userId, input.receptionSessionId, routeResult);

  // 路由决策过程消息不写入 message_v2——用户不需要看到"路由判断：orchestrate"
  // 这样的内部过程信息。路由失败时静默降级继续，由后续路径（direct/orchestrate/
  // clarify/resume）的处理逻辑决定给用户展示什么。

  // ─── 路径 A：direct → b.companion 直接回答（走 stream） ─────────────────
  if (routeResult.decision === 'direct') {
    setSubstate({
      sessionId: input.receptionSessionId,
      substate: SUBSTATES_RECEPTION.CHATTING,
      userId: input.userId,
      roleLayer: 'reception',
    });
    const directStartedAt = Date.now();
    try {
      const { runSessionInBackground } = await import('../../routes/stream-runtime.js');
      // 使用与 inbound 端点相同的 clientRequestId，这样 stream 管线的
      // persistStreamUserMessage 会检测到已有该 requestId 的消息并跳过，
      // 避免用户消息重复写入（Fix #1/#2）。
      await runSessionInBackground({
        sessionId: input.receptionSessionId,
        userId: input.userId,
        requestData: {
          message: input.userIntent,
          model: 'default',
          clientRequestId: streamClientRequestId,
        },
      });
    } catch (err) {
      console.warn(
        `[reception-orchestrator] direct stream 失败：${err instanceof Error ? err.message : String(err)}`,
      );
      if (persistAck) {
        writeAck(input.userId, input.receptionSessionId, '直接回答时出错，请重试。');
      }
    } finally {
      recordLatency('a_to_b_direct', Date.now() - directStartedAt, input.userId);
    }
    setSubstate({
      sessionId: input.receptionSessionId,
      substate: SUBSTATES_RECEPTION.IDLE,
      userId: input.userId,
      roleLayer: 'reception',
    });
    return { triggered: false, reason: 'direct-answer' as never };
  }

  // ─── 路径 B：clarify → b.companion 追问 ────────────────────────────────
  if (routeResult.decision === 'clarify') {
    if (persistAck) {
      const clarifyText =
        routeResult.clarifyKind === 'too_short'
          ? `你这次输入的内容太少了，我还没法准确判断你是想提问、查资料，还是要我直接开始做事。请再补一句更具体的目标，例如“帮我解释 XX”“帮我修复 XX”“帮我实现 XX”。\n\n_（路由判断：${routeResult.reason}）_`
          : `我需要更多信息才能帮你。能否详细描述一下你想做什么？\n\n_（路由判断：${routeResult.reason}）_`;
      writeAck(
        input.userId,
        input.receptionSessionId,
        clarifyText,
      );
    }
    return { triggered: false, reason: 'clarify-needed' as never };
  }

  // ─── 路径 D：resume → 续接上次未完成任务，跳过 LLM 意图改写 ─────────────
  //
  // 用户表达"继续/接着/往下"等延续意图时，先检查是否存在未完成任务。
  // 如果有 → 直接创建 handoff(reception→pm1)，在 payload 中标记 isResume=true，
  //           PM1 收到后会优先读取已有 spec/plan/tasks 产物并续接，而非重新规划。
  // 如果没有 → 降级为路径 C（orchestrate），让 PM1 正常规划新任务。
  if (routeResult.decision === 'resume') {
    const resumeResult = await tryResumePreviousWork({
      userId: input.userId,
      receptionSessionId: input.receptionSessionId,
      userIntent: input.userIntent,
      teamWorkspaceId: input.teamWorkspaceId ?? null,
      persistAck,
      streamClientRequestId,
    });

    if (resumeResult.handled) {
      return resumeResult.result;
    }
    // 没有可恢复的工作 → 降级走路径 C
    if (persistAck && resumeResult.fallbackMessage) {
      writeAck(input.userId, input.receptionSessionId, resumeResult.fallbackMessage);
    }
  }

  // ─── 路径 C：orchestrate → 走 c→d→e/f/g 链路 ──────────────────────────

  // 自动初始化前置（周全性补强）：用户直接提了真任务但初始化还没做完时，
  // 先把未完成的初始化步骤自动跑完（了解项目 / 提取记忆 / 绑定工具），再派发任务。
  // best-effort：失败不阻塞任务。完成后用最新产物覆盖 context，让 pm1 拿到项目理解。
  let effectiveContext = input.context ?? null;
  if (input.autoRunInit !== false) {
    try {
      const { ensureTeamInitBeforeTask, buildInitContextFromState } =
        await import('../../team/init/team-init-autorun.js');
      const { loadTeamInitSessionContext } = await import('../../team/init/team-init-store.js');

      // 预检：若有未完成、且存在待执行（proposed）步骤，先回一句「正在了解项目」让
      // 用户安心（自动初始化含 LLM 架构理解，可能耗时）。仅在确实要跑时写，避免噪音。
      const preCtx = loadTeamInitSessionContext(input.receptionSessionId, input.userId);
      const deferredEmptyProjectInit =
        preCtx?.teamInit?.projectKind === 'empty' &&
        preCtx.teamInit.phase !== 'skipped' &&
        input.userIntent.trim().length > 0 &&
        preCtx.teamInit.steps.some(
          (s) =>
            (s.key === 'bind-tools-per-layer' || s.key === 'scaffold-memory') &&
            s.status === 'not_applicable',
        );
      const willRunInit =
        preCtx?.teamInit != null &&
        preCtx.teamInit.phase !== 'skipped' &&
        (preCtx.teamInit.steps.some((s) => s.status === 'proposed') || deferredEmptyProjectInit);
      if (willRunInit && persistAck) {
        writeAck(
          input.userId,
          input.receptionSessionId,
          deferredEmptyProjectInit
            ? '收到。这个工作区目前是空项目，我会先根据你的目标准备项目记忆并绑定合适工具，然后开始处理需求…'
            : '收到，我先快速了解一下你的项目（读取结构 / 记忆、按需绑定工具），随后立刻开始处理你的需求…',
        );
      }

      const initResult = await ensureTeamInitBeforeTask({
        sessionId: input.receptionSessionId,
        userId: input.userId,
        taskGoal: input.userIntent,
      });
      if (initResult.ran) {
        const freshContext = buildInitContextFromState(initResult.state);
        if (freshContext) {
          effectiveContext = freshContext;
        }
        if (initResult.failedSteps.length > 0) {
          console.warn(
            `[reception-orchestrator] auto-init 部分步骤失败（${initResult.failedSteps.join(', ')}），继续派发任务`,
          );
        }
      }
    } catch (err) {
      console.warn(
        `[reception-orchestrator] auto-init 失败，跳过初始化继续派发：${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  setSubstate({
    sessionId: input.receptionSessionId,
    substate: SUBSTATES_RECEPTION.ROUTING,
    userId: input.userId,
    roleLayer: 'reception',
  });

  let rewritten = '';
  try {
    const { requestWorkflowLlmCompletion } = await import('../../routes/workflow-llm.js');
    const contextBlock = effectiveContext ? `\n\n当前工作区上下文摘要：\n${effectiveContext}` : '';
    rewritten = await requestWorkflowLlmCompletion({
      apiBaseUrl: llmConfig.apiBaseUrl,
      apiKey: llmConfig.apiKey,
      model: llmConfig.model,
      ...(llmConfig.providerType ? { providerType: llmConfig.providerType } : {}),
      ...(llmConfig.upstreamProtocol ? { upstreamProtocol: llmConfig.upstreamProtocol } : {}),
      prompt: prependAuxiliaryTeamInstructionPrefix({
        instructionPrefix,
        prompt: INTERACTION_AGENT_PROMPT_TEMPLATE(input.userIntent, contextBlock),
      }),
      temperature: 0.3,
      usageContext: {
        userId: input.userId,
        sessionId: input.receptionSessionId,
        layer: 'reception',
        ...(typeof llmConfig.inputPricePerMillion === 'number'
          ? { inputPricePerMillion: llmConfig.inputPricePerMillion }
          : {}),
        ...(typeof llmConfig.outputPricePerMillion === 'number'
          ? { outputPricePerMillion: llmConfig.outputPricePerMillion }
          : {}),
      },
    });
  } catch (err) {
    console.warn(
      `[reception-orchestrator] LLM 调用失败：${err instanceof Error ? err.message : String(err)}`,
    );
    setSubstate({
      sessionId: input.receptionSessionId,
      substate: SUBSTATES_RECEPTION.IDLE,
      userId: input.userId,
      roleLayer: 'reception',
    });
    if (persistAck) {
      writeAck(input.userId, input.receptionSessionId, FALLBACK_ACK_LLM_FAILED);
    }
    return { triggered: false, reason: 'llm-failed' };
  }

  const rewrittenIntent = extractField(rewritten, '改写结果') || rewritten;
  const recommendedRole = extractField(rewritten, '推荐角色') || 'planner';
  const recommendedNextStep =
    extractField(rewritten, '下一步') ||
    '可将这条改写结果继续落到 Team 任务、共享运行跟进项或执行角色分工。';

  // 创建 handoff(reception → pm1)，把意图 + workspace id 都塞进 payload，
  // pm1-runner 会从 payload 里读 teamWorkspaceId 来注入 constitution
  const handoff = createHandoff({
    userId: input.userId,
    fromSessionId: input.receptionSessionId,
    fromRoleLayer: 'reception',
    toRoleLayer: 'pm1',
    payload: {
      sourceIntent: input.userIntent,
      rewrittenIntent,
      recommendedRole,
      recommendedNextStep,
      teamWorkspaceId: input.teamWorkspaceId ?? null,
    },
  });

  publishHandoffEvent({
    type: 'handoff.created',
    record: handoff,
    payload: {
      orchestrator: 'reception-auto',
      sourceIntent: input.userIntent,
      rewrittenIntent,
    },
  });

  // 推到 dispatching → awaiting_downstream：前端 UI 能反馈"团队正在接管"
  setSubstate({
    sessionId: input.receptionSessionId,
    substate: SUBSTATES_RECEPTION.AWAITING_DOWNSTREAM,
    userId: input.userId,
    roleLayer: 'reception',
  });

  // 让前端订阅者能立刻看到事件
  publishTeamEvent({
    type: 'session.inbound.submitted',
    sessionId: input.receptionSessionId,
    taskId: handoff.id,
    layer: 'reception',
    timestamp: Date.now(),
    userId: input.userId,
    payload: {
      messageType: 'user_input',
      orchestratedHandoffId: handoff.id,
      rewrittenIntent,
      recommendedRole,
      recommendedNextStep,
    },
  });

  // 把"已派发给 c 层"的 ack 写入 reception 消息流
  if (persistAck) {
    writeAck(
      input.userId,
      input.receptionSessionId,
      buildSuccessAck({
        rewrittenIntent,
        recommendedRole,
        recommendedNextStep,
        handoffId: handoff.id,
      }),
    );
  }

  return {
    triggered: true,
    handoffId: handoff.id,
    rewrittenIntent,
    recommendedRole,
    recommendedNextStep,
  };
}

// ─── 内部：写 reception 端的 assistant ack 消息 ─────────────────────────────

const FALLBACK_ACK_HANDOFF_ACTIVE =
  '收到。当前已有进行中的任务，本条输入已记录，会在合适的节点合并到现有流程。';
const FALLBACK_ACK_NO_LLM = '收到。当前没有可用的辅助 LLM 配置，无法自动派发，请稍后重试。';
const FALLBACK_ACK_LLM_FAILED = '收到。意图改写失败，请稍后重试。';

function buildSuccessAck(input: {
  rewrittenIntent: string;
  recommendedRole: string;
  recommendedNextStep: string;
  handoffId: string;
}): string {
  return [
    '已收到你的需求，团队开始接管。',
    '',
    `**改写后的意图**：${input.rewrittenIntent}`,
    `**推荐起点角色**：${input.recommendedRole}`,
    `**下一步**：${input.recommendedNextStep}`,
    '',
    `_派发记录：handoff \`${input.handoffId.slice(0, 8)}\`_`,
  ].join('\n');
}

function writeAck(userId: string, sessionId: string, text: string): void {
  try {
    appendSessionMessageV2({
      sessionId,
      userId,
      role: 'assistant',
      agentId: 'interaction-agent',
      content: [{ type: 'text', text }],
    });
  } catch (err) {
    console.warn(
      `[reception-orchestrator] 写 ack 消息失败：${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// ─── 路径 D：resume 续接逻辑 ─────────────────────────────────────────────────

/**
 * 为 LLM 路由器构建任务上下文摘要。
 *
 * 查找当前 reception session 关联的 team root session，如果有未完成任务，
 * 把任务标题和状态做成简短摘要，让 LLM 能据此判断用户是否想续接。
 * 失败时返回 null（LLM 在无上下文情况下会默认走 orchestrate）。
 */
async function buildRouteLlmContext(input: {
  userId: string;
  receptionSessionId: string;
}): Promise<RouteLlmContext | null> {
  try {
    const sessionRow = sqliteGet<{ metadata_json: string | null }>(
      `SELECT metadata_json FROM sessions WHERE id = ? AND user_id = ? LIMIT 1`,
      [input.receptionSessionId, input.userId],
    );
    if (!sessionRow) {
      return null;
    }

    const rootSessionId = resolveTeamRootSessionId({
      metadataJson: sessionRow.metadata_json,
      sessionId: input.receptionSessionId,
      userId: input.userId,
    });
    if (!rootSessionId) {
      return null;
    }

    const resumeContext = await buildTeamResumeContext({
      rootSessionId,
      userId: input.userId,
    });
    if (!resumeContext || resumeContext.incompleteTasks.length === 0) {
      return { previousTaskSummary: null, incompleteTaskCount: 0 };
    }

    const summary = resumeContext.incompleteTasks
      .slice(0, 5)
      .map(
        (task, index) =>
          `${index + 1}. ${task.title}（${taskStatusLabel(task.status)}${task.roleLayer ? ` / ${task.roleLayer}` : ''}）`,
      )
      .join('\n');

    return {
      previousTaskSummary: summary,
      incompleteTaskCount: resumeContext.incompleteTasks.length,
    };
  } catch (err) {
    console.warn(
      `[reception-orchestrator] 构建 LLM 路由上下文失败：${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

interface TryResumeResult {
  handled: boolean;
  result?: OrchestrateReceptionResult;
  /** 当 handled=false 时，给用户的降级提示（可选） */
  fallbackMessage?: string;
}

/**
 * 尝试续接上次未完成任务。
 *
 * 流程：
 *   1. 从 reception session 的 metadata 解析出 team root session id
 *   2. 构建 team resume context（未完成任务 / 活跃 handoff / 已有产物）
 *   3. 如果有可恢复的工作 → 创建 handoff(reception→pm1)，payload 标记 isResume=true，
 *      把 resume context 摘要注入 payload，PM1 收到后优先续接而非重新规划
 *   4. 如果没有可恢复的工作 → 返回 handled=false，降级走路径 C
 */
async function tryResumePreviousWork(input: {
  userId: string;
  receptionSessionId: string;
  userIntent: string;
  teamWorkspaceId: string | null;
  persistAck: boolean;
  streamClientRequestId: string;
}): Promise<TryResumeResult> {
  // 1. 解析 root session id
  const sessionRow = sqliteGet<{ metadata_json: string | null }>(
    `SELECT metadata_json FROM sessions WHERE id = ? AND user_id = ? LIMIT 1`,
    [input.receptionSessionId, input.userId],
  );
  if (!sessionRow) {
    return { handled: false };
  }

  const rootSessionId = resolveTeamRootSessionId({
    metadataJson: sessionRow.metadata_json,
    sessionId: input.receptionSessionId,
    userId: input.userId,
  });
  if (!rootSessionId) {
    // 没有 team metadata → 不是 team session，无法续接
    return { handled: false };
  }

  // 2. 构建 resume context
  let resumeContext: TeamResumeContext | null = null;
  try {
    resumeContext = await buildTeamResumeContext({
      rootSessionId,
      userId: input.userId,
    });
  } catch (err) {
    console.warn(
      `[reception-orchestrator] 构建 resume context 失败：${err instanceof Error ? err.message : String(err)}`,
    );
    return { handled: false };
  }

  // 3. 检查是否有可恢复的工作
  if (!resumeContext || !hasRecoverableWork(resumeContext)) {
    return {
      handled: false,
      fallbackMessage: `当前没有未完成的任务可以续接。我会把你的输入当作新需求处理。`,
    };
  }

  // 4. 有可恢复的工作 → 创建 resume handoff，跳过 LLM 意图改写
  const incompleteTaskSummary = resumeContext.incompleteTasks
    .slice(0, 5)
    .map(
      (task, index) =>
        `${index + 1}. ${task.title}（${taskStatusLabel(task.status)}${task.roleLayer ? ` / ${task.roleLayer}` : ''}）`,
    )
    .join('\n');

  const handoff = createHandoff({
    userId: input.userId,
    fromSessionId: input.receptionSessionId,
    fromRoleLayer: 'reception',
    toRoleLayer: 'pm1',
    payload: {
      sourceIntent: input.userIntent,
      rewrittenIntent: `【续接模式】用户请求继续上次未完成的任务。\n\n未完成任务概览：\n${incompleteTaskSummary}`,
      recommendedRole: 'planner',
      recommendedNextStep: '读取已有 spec/plan/tasks 产物，续接未完成任务，不要重新规划已完成的部分。',
      teamWorkspaceId: input.teamWorkspaceId,
      isResume: true,
      resumeRootSessionId: rootSessionId,
    },
  });

  publishHandoffEvent({
    type: 'handoff.created',
    record: handoff,
    payload: {
      orchestrator: 'reception-resume',
      sourceIntent: input.userIntent,
      rewrittenIntent: '续接上次未完成任务',
    },
  });

  setSubstate({
    sessionId: input.receptionSessionId,
    substate: SUBSTATES_RECEPTION.AWAITING_DOWNSTREAM,
    userId: input.userId,
    roleLayer: 'reception',
  });

  publishTeamEvent({
    type: 'session.inbound.submitted',
    sessionId: input.receptionSessionId,
    taskId: handoff.id,
    layer: 'reception',
    timestamp: Date.now(),
    userId: input.userId,
    payload: {
      messageType: 'user_input',
      orchestratedHandoffId: handoff.id,
      rewrittenIntent: '续接上次未完成任务',
      recommendedRole: 'planner',
      recommendedNextStep: '续接未完成任务',
      isResume: true,
    },
  });

  if (input.persistAck) {
    const taskCount = resumeContext.incompleteTasks.length;
    const handoffCount = resumeContext.activeHandoffs.length;
    writeAck(
      input.userId,
      input.receptionSessionId,
      [
        '收到，续接上次未完成的工作。',
        '',
        `**当前状态**：${taskCount} 个未完成任务，${handoffCount} 个活跃交接`,
        '',
        '**未完成任务**：',
        incompleteTaskSummary,
        ...(resumeContext.incompleteTasks.length > 5
          ? [`- 另有 ${resumeContext.incompleteTasks.length - 5} 个未完成任务已省略。`]
          : []),
        '',
        `_续接记录：handoff \`${handoff.id.slice(0, 8)}\`_`,
      ].join('\n'),
    );
  }

  return {
    handled: true,
    result: {
      triggered: true,
      handoffId: handoff.id,
      rewrittenIntent: '续接上次未完成任务',
      recommendedRole: 'planner',
      recommendedNextStep: '续接未完成任务',
    },
  };
}

function hasRecoverableWork(context: TeamResumeContext): boolean {
  return context.incompleteTasks.length > 0 || context.activeHandoffs.length > 0;
}

function taskStatusLabel(status: string): string {
  switch (status) {
    case 'running':
      return '运行中';
    case 'blocked':
      return '阻塞';
    case 'pending':
      return '待执行';
    case 'failed':
      return '失败待管控';
    default:
      return status;
  }
}

// ─── L1.4 audit log（路由决策记录） ─────────────────────────────────────────

function logRouteDecision(userId: string, sessionId: string, route: RouteResult): void {
  try {
    dbSqliteRun(
      `INSERT INTO team_audit_logs (
         id,
         user_id,
         action,
         entity_type,
         entity_id,
         session_id,
         summary,
         detail,
         created_at
       )
       VALUES (?, ?, 'route_decision', 'session', ?, ?, ?, ?, datetime('now'))`,
      [
        randomUUID(),
        userId,
        sessionId,
        sessionId,
        `b.router: ${route.decision} (${route.decisionSource})`,
        JSON.stringify({
          decision: route.decision,
          decisionSource: route.decisionSource,
          reason: route.reason,
          ...(route.llmRawOutput ? { llmRawOutput: route.llmRawOutput.slice(0, 500) } : {}),
        }),
      ],
    );
  } catch {
    // audit log 写入失败不阻塞主流程
  }
}
