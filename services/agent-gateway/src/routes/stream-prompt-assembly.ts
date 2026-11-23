/**
 * stream-prompt-assembly.ts — `handleStreamRequest` 的 `stream.prepare-sync` 区提示词 / 上下文组装
 *
 * 职责：把「模型路由解析完成之后、重放与单飞冲突检查之前」这一段纯组装逻辑收拢为一个
 * 可单测的模块：companion / 能力目录 / 动态编排器提示词 / 关键词检测 / start-work /
 * 命令模板 / LSP 指引 / 对话与 YOLO 模式提示词 / websearch 开关 / 动态工作区工具加载。
 *
 * 依赖方向：只依赖叶子模块与 `stream-system-prompts` / `capabilities`，
 * **不得反向 `import ... from './stream.js'`**（避免运行时循环）。
 *
 * 语义约束（改动必须逐字保持）：
 * 1. 所有 `build*` / `detect*` / IO 调用的**求值顺序**与调用点原实现一致；
 * 2. `dynamicToolDefsPromise` 在函数**返回前**创建（立刻启动），不因返回值消费方
 *    的 await 时点变化而延后——它是在本区末尾、`clearStaleReplayRequestArtifacts`
 *    之前启动的并发提速手段，提前 / 延后都会改变并发与副作用顺序；
 * 3. `startWorkContext` 的 `try/catch` 边界与异常类型不变：失败时记录 worklog 失败
 *    后**原样重抛**，由调用方沿用既有的 `failReservation(error)` 收尾。
 */

import type { DialogueMode } from '@openAwork/shared';
import { KeywordDetectorImpl } from '@openAwork/agent-core';
import { logGatewayWarn } from '../infra/gateway-logger.js';
import { buildDynamicOrchestratorPrompt } from '../agent/dynamic-agent-prompt-builder.js';
import { detectActiveCommandContext } from '../tools/command-templates.js';
import {
  loadDynamicToolsForWorkspace,
  type DynamicToolEntry,
} from '../tools/dynamic-tool-loader.js';
import { detectStartWorkKeyword, processStartWork } from '../workspace/start-work.js';
import {
  buildCompanionPrompt,
  loadCompanionSettingsForUser,
} from '../workspace/companion-settings.js';
import { resolveUnboundSessionWorkspaceFallback } from '../workspace/workspace-safety.js';
import { buildCapabilityContext } from './capabilities.js';
import {
  CLARIFY_LSP_TOOL_GUIDANCE_SYSTEM_PROMPT,
  LSP_TOOL_GUIDANCE_SYSTEM_PROMPT,
  ORCHESTRATOR_AGENT_IDS,
  YOLO_MODE_SYSTEM_PROMPT,
} from './stream-system-prompts.js';
import { resolveDialogueModePromptForRequest } from '../prompt/resolve-dialogue-mode-prompt.js';
import type { SessionRuntimePolicy } from '../session/session-runtime-policy.js';

// 编排型 Agent 集合（`sisyphus` / `atlas` / `zeus`）自 `stream-system-prompts.js` 中性真源导入，
// 与 `stream.ts` 共用同一份，杜绝同义常量漂移（无需反向 import `stream.js`，不成环）。

export interface StreamInteractionModesInput {
  dialogueMode?: DialogueMode;
  yoloMode: boolean;
}

/**
 * websearch 开关判定（与 `stream.ts` 的 `isWebSearchEnabled` 逐字同义）。
 *
 * 为什么不直接 import 那个函数：`stream.ts` 是门面本身，本模块反向 import 会成环。
 * 判定语义由 `__tests__/routes/stream-prompt-assembly.test.ts` 与
 * `stream.js` 的导出对拍锁定。
 */
export function resolveStreamPromptWebSearchEnabled(metadataJson: string): boolean {
  try {
    const meta = JSON.parse(metadataJson) as Record<string, unknown>;
    if (meta['webSearchEnabled'] === true) {
      return true;
    }

    const channel = meta['channel'];
    if (typeof channel === 'object' && channel !== null) {
      const tools = (channel as Record<string, unknown>)['tools'];
      if (typeof tools === 'object' && tools !== null) {
        return (tools as Record<string, unknown>)['web_search'] === true;
      }
    }

    return meta['webSearchEnabled'] === true;
  } catch {
    return false;
  }
}

export interface AssembleStreamPromptContextInput {
  /** 当前会话 id（companion / capability / dynamic tools 的作用域）。 */
  sessionId: string;
  /** 用户身份：companion 绑定与能力目录都按用户读取。 */
  user: { sub: string; email: string };
  /** 会话上下文快照（命令模板 / websearch 开关判定用）。 */
  sessionContext: { metadataJson: string };
  /** 解析后的请求（总是带 `upstreamRetryMaxRetries` 的那份）：`requestData.message` 是提示词输入。 */
  requestData: {
    message: string;
    agentId?: string;
    webSearchEnabled?: boolean;
  };
  /**
   * 路由解析结果：只取 `effectiveAgentId`（companion 绑定 / 编排器提示词 / 显式
   * Agent 判定）。其余字段属于模型解析，不参与本区组装。
   */
  route: { effectiveAgentId?: string };
  /** 已解析的交互模式（对话模式 / 权限档位）。 */
  interactionModes: StreamInteractionModesInput;
  /** 会话运行时策略（控制能力目录 / LSP 指引 / 动态工具是否注入）。 */
  runtimePolicy: SessionRuntimePolicy;
  /** 会话工作区，`null` 时 start-work 与动态工具回退到未绑定默认目录。 */
  workspacePath: string | null;
  /**
   * 用户可见消息（团队恢复轮已按 `displayMessage` 兜底过）。必填：它是 companion
   * 提示词的实参，不能在本模块内悄悄回落到 `requestData.message`。
   */
  userVisibleMessage: string;
  /** worklog：start-work 失败时需要把 `stream.prepare-sync` 步标记为失败。 */
  workflow: { failPrepare: (reason: string) => void };
}

export interface AssembledStreamPromptContext {
  capabilityContext: string | null;
  commandContext: { actionKind: string; instruction: string } | null;
  companionPrompt: string | null;
  dialogueModePrompt: string | null;
  /**
   * 动态工作区工具加载（**已启动**的 Promise）。
   *
   * 必须在返回时已经启动：原实现在本区末尾调用 `loadDynamicToolsForWorkspace(...)`
   * 并立刻交给后续 `await`，若改为惰性（返回 thunk / getter）就会改变并发时机。
   */
  dynamicToolDefsPromise: Promise<DynamicToolEntry[]>;
  dynamicAgentPrompt: string | null;
  effectiveAgentId: string;
  injectedPrompt: string | null;
  lspGuidance: string | null;
  runtimePolicy: SessionRuntimePolicy;
  startWorkContext: string | null;
  webSearchEnabled: boolean;
  /**
   * start-work 与动态工具共用的工作区根：已绑定用会话路径，未绑定回退默认目录。
   * 调用方后续（ralph loop 续跑）仍会用到它。
   */
  workspaceRootForStartWork: string;
  yoloModePrompt: string | null;
}

/**
 * 组装 `stream.prepare-sync` 区的提示词与上下文。
 *
 * 求值顺序与原 handler 内联代码逐字对应：
 * companion → capability → 动态编排器 / 关键词检测 → start-work → 命令模板 → LSP →
 * 对话模式 / YOLO → websearch → 动态工具 Promise（立即启动）。
 */
export async function assembleStreamPromptContext(
  input: AssembleStreamPromptContextInput,
): Promise<AssembledStreamPromptContext> {
  const { requestData, runtimePolicy, userVisibleMessage } = input;

  // 用**生效**的 Agent（含会话绑定回退）解析 companion 绑定：否则同一会话的前台轮
  // （请求带 agentId）与后台续跑 / 唤醒 / 事件轮（请求不带）会命中不同的 companion
  // 配置，同一份历史在两种轮次下拿到不一致的语音与提示词绑定。
  const companionPrompt: string | null = buildCompanionPrompt(
    loadCompanionSettingsForUser(
      input.user.sub,
      input.user.email,
      input.route.effectiveAgentId ?? requestData.agentId,
    ),
    userVisibleMessage,
  );
  const capabilityContext = runtimePolicy.includeCapabilityContext
    ? buildCapabilityContext(input.user.sub, input.sessionId)
    : null;
  // Dynamic agent prompt (oh-my-opencode dynamic-agent-prompt-builder pattern):
  // For orchestrator agents (sisyphus, atlas, zeus), inject delegation table,
  // tool selection table, key triggers, and agent-specific sections.
  const effectiveAgentId = input.route.effectiveAgentId ?? requestData.agentId ?? '';
  const dynamicAgentPrompt = ORCHESTRATOR_AGENT_IDS.has(effectiveAgentId)
    ? buildDynamicOrchestratorPrompt()
    : null;
  const detector = new KeywordDetectorImpl();
  const detection = detector.detect(requestData.message);
  const injectedPrompt = detection.injectedPrompt ?? null;

  // Start-work (oh-my-opencode start-work pattern):
  // Detect "ultrawork/ulw" keyword and inject plan context + create boulder state.
  let startWorkContext: string | null = null;
  // 已绑定：用会话路径；未绑定：回退到桌面端默认目录（禁止 process.cwd() 落到盘符根）。
  const workspaceRootForStartWork = input.workspacePath ?? resolveUnboundSessionWorkspaceFallback();
  if (detectStartWorkKeyword(requestData.message)) {
    try {
      startWorkContext = await processStartWork(
        workspaceRootForStartWork,
        input.sessionId,
        requestData.message,
      );
    } catch (error) {
      input.workflow.failPrepare('start-work 失败');
      throw error;
    }
  }

  // Command templates (oh-my-opencode builtin-commands pattern):
  // Detect active command context from session metadata and inject workflow instructions.
  const commandContext = detectActiveCommandContext(input.sessionContext.metadataJson);
  const lspGuidance =
    runtimePolicy.includeLspGuidance && input.interactionModes.dialogueMode !== undefined
      ? input.interactionModes.dialogueMode === 'clarify'
        ? CLARIFY_LSP_TOOL_GUIDANCE_SYSTEM_PROMPT
        : LSP_TOOL_GUIDANCE_SYSTEM_PROMPT
      : null;
  const dialogueModePrompt = resolveDialogueModePromptForRequest({
    userId: input.user.sub,
    dialogueMode: input.interactionModes.dialogueMode,
    effectiveAgentId: input.route.effectiveAgentId,
  });
  const yoloModePrompt = input.interactionModes.yoloMode === true ? YOLO_MODE_SYSTEM_PROMPT : null;
  const webSearchEnabled =
    requestData.webSearchEnabled ??
    resolveStreamPromptWebSearchEnabled(input.sessionContext.metadataJson);

  // 立即启动（不 await）：与原实现一致——本区结束时创建，后续 `await` 才有并发收益。
  const dynamicToolDefsPromise: Promise<DynamicToolEntry[]> =
    runtimePolicy.includeDynamicWorkspaceTools
      ? loadDynamicToolsForWorkspace(workspaceRootForStartWork, input.sessionId).catch(
          (error: unknown) => {
            logGatewayWarn(
              `[stream] Failed to load dynamic tools for ${workspaceRootForStartWork}: ${error instanceof Error ? error.message : String(error)}`,
            );
            return [] as DynamicToolEntry[];
          },
        )
      : Promise.resolve([] as DynamicToolEntry[]);

  return {
    capabilityContext,
    commandContext,
    companionPrompt,
    dialogueModePrompt,
    dynamicToolDefsPromise,
    dynamicAgentPrompt,
    effectiveAgentId,
    injectedPrompt,
    lspGuidance,
    runtimePolicy,
    startWorkContext,
    webSearchEnabled,
    workspaceRootForStartWork,
    yoloModePrompt,
  };
}
