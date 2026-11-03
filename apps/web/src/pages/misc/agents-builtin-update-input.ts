/**
 * 内置 Agent 的「模型 + 提示词」差异提交构造（纯函数，从 `AgentsPage.tsx` 抽出）。
 *
 * 为什么必须做差异提交：内置 Agent 的表单预填的是**当前有效提示词**（默认值或已有覆盖）。
 * 若无条件随模型一起提交，「只改模型」也会写入一条等于当前默认值的提示词覆盖 ——
 * 该覆盖此后不再随版本升级更新，属于静默固化的用户可见错误。
 *
 * 语义：
 *   - 未改动提示词 → 不提交 `systemPrompt`（`undefined` = 服务端保持现值）；
 *   - 改为非空文本 → 提交该文本（保留原始空白，仅用 trim 判空）；
 *   - 清空/纯空白   → 提交 `null`（服务端删除覆盖、回落当前默认）；
 *   - 与当前默认值相同 → 同样提交 `null`：见下方 `equalsDefault` 的说明。
 */
import type { ManagedAgentRecord, UpdateManagedAgentInput } from '@openAwork/shared';
import { parseAliases } from '../../components/agents/agents-editor-state.js';
import type { AgentEditorState } from '../../components/agents/agents-editor-state.js';

export function toBuiltinUpdateInput(
  state: AgentEditorState,
  agent: ManagedAgentRecord,
): UpdateManagedAgentInput {
  const input: UpdateManagedAgentInput = {
    model: state.model.trim() || undefined,
    variant: state.variant.trim() || undefined,
    fallbackModels: parseAliases(state.fallbackModelsText),
  };
  const baseline = agent.systemPrompt ?? '';
  if (state.systemPrompt !== baseline) {
    const defaultText = agent.promptMetadata?.defaultText ?? '';
    // 「与当前默认值一致」与「无覆盖」语义等价，必须按 null 提交而不是原样提交。
    // 服务端删除覆盖记录的条件是**四个字段全等于默认**（sameAsDefault）；用户若同时
    // 改了模型，这段等于默认值的文本就会被写进覆盖记录，当下 `hasPromptOverride` 仍
    // 比较为 false（看不出来），但等上游默认提示词升级后它就变成一条陈旧的「覆盖」，
    // 该 Agent 从此静默停止跟随升级 —— 与本模块要防的固化为同一后果，只是推迟暴露。
    const equalsDefault = defaultText.length > 0 && state.systemPrompt === defaultText;
    input.systemPrompt =
      state.systemPrompt.trim().length === 0 || equalsDefault ? null : state.systemPrompt;
  }
  return input;
}
