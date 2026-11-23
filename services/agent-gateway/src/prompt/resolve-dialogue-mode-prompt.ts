/**
 * 对话模式提示词的门控解析入口。
 *
 * 背景：模式提示词的注入受两个前置条件门控 —— （1）本轮**没有**显式 Agent（有 Agent 时
 * 只注入该 Agent 的提示词，模式提示词被抑制）；（2）指定了对话模式。
 * 历史实现把这两个判断散落在各请求入口内联复写，
 * 权限审批恢复入口（`stream-runtime.ts`）一度缺失显式 Agent 抑制。
 *
 * 本模块是**唯一**门控解析入口：两个入口（普通请求 / 权限审批恢复）都必须经此调用，
 * 杜绝抑制语义再次漂移。保持既有行为：
 * 1. 显式 Agent 为真值时返回 `null`，且**不得读库**（避免无谓 IO 与覆盖误注入）；
 * 2. 未指定对话模式时返回 `null`，且不得读库；
 * 3. 否则按「覆盖优先、默认兜底」解析（`resolveDialogueModePromptText`）。
 *
 * 必须是叶子模块：不得 import `stream.ts` / `stream-runtime.ts` / `stream-prompt-assembly.ts`，
 * 只允许依赖 store 与模式提示词常量真源。
 */
import type { DialogueMode } from '@openAwork/shared';
import { resolveDialogueModePromptText } from './prompt-override-store.js';

export interface ResolveDialogueModePromptInput {
  userId: string;
  /** 已解析的对话模式；undefined = 未指定 */
  dialogueMode: DialogueMode | undefined;
  /** 已解析的显式 Agent（会话绑定或请求指定） */
  effectiveAgentId: string | undefined;
}

/**
 * 门控解析本轮应注入的对话模式提示词。
 *
 * @returns 注入文本；被抑制时返回 `null`。
 */
export function resolveDialogueModePromptForRequest(
  input: ResolveDialogueModePromptInput,
): string | null {
  if (input.effectiveAgentId) {
    return null;
  }
  if (input.dialogueMode === undefined) {
    return null;
  }
  return resolveDialogueModePromptText(input.userId, input.dialogueMode);
}
