/**
 * 渠道能力分组规则 —— **已上移至 `@openAwork/shared`**（唯一事实来源）。
 *
 * 本文件保留为再导出垫片，目的有二：
 * 1. 既有 import 路径（如 `routes/capabilities.ts`）无需改动；
 * 2. 明确「规则只有一份」——前端同名模块同样从 `@openAwork/shared` 引入，
 *    不再各自手写，杜绝 2026-11-02 那类「只在一侧登记规范名 `subagent`」的漂移。
 */
export {
  DEFAULT_CHANNEL_CAPABILITY_CONTEXT_TOOL_PROMPT_INJECTIONS,
  normalizeChannelCapabilityContextToolPromptInjections,
  resolveChannelCapabilityToolGroup,
} from '@openAwork/shared';
export type {
  ChannelCapabilityContextToolPromptInjections,
  NormalizedChannelCapabilityContextToolPromptInjections,
} from '@openAwork/shared';
