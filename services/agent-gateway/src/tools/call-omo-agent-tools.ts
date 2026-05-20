import type { ToolDefinition } from '@openAwork/agent-core';
import { z } from 'zod';

export const CALL_OMO_ALLOWED_AGENTS = [
  'explore',
  'librarian',
  'oracle',
  'hephaestus',
  'metis',
  'momus',
  'multimodal-looker',
  // scout：只读外部研究 agent。sisyphus / atlas / zeus 在需要调研用户
  // workspace 之外的依赖源码（npm 包源码、上游仓库实现细节、第三方
  // 文档）时可委派 scout。它走 repo_clone + repo_overview 工具链，
  // 绝不修改用户 workspace。加入白名单前 scout 仅有 catalog 注册而无
  // 任何派发路径，等同于死 agent。
  'scout',
] as const;

const callOmoAgentInputSchema = z.object({
  description: z.string().min(1).optional(),
  prompt: z.string().min(1),
  subagent_type: z.string().min(1),
  run_in_background: z.boolean().default(false),
  session_id: z.string().min(1).optional(),
});

// 把白名单 agent id 拼到工具描述里 —— LLM 第一次看到工具描述时就能
// 知道 subagent_type 可填哪些值，省去先猜后被错误消息纠正的开销。
// 维护成本低：CALL_OMO_ALLOWED_AGENTS 改动会同步反映到这里。
const CALL_OMO_AGENT_LIST = CALL_OMO_ALLOWED_AGENTS.join(' | ');

export const callOmoAgentToolDefinition: ToolDefinition<
  typeof callOmoAgentInputSchema,
  z.ZodString
> = {
  name: 'call_omo_agent',
  description: `按名直接调用内置子代理（subagent），支持同步 / 后台执行两种模式。可用 subagent_type：${CALL_OMO_AGENT_LIST}。`,
  inputSchema: callOmoAgentInputSchema,
  outputSchema: z.string(),
  timeout: 30000,
  execute: async () => {
    throw new Error('call_omo_agent must execute through the gateway-managed sandbox path');
  },
};
