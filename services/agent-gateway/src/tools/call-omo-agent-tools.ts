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
  // web-researcher：只读联网检索 agent（新闻 / 资讯 / 公开网页）。
  // 加入白名单前，模型做联网资讯检索时**没有正确的委派对象**，只能把
  // 任务塞给语义最近的 scout（历史现象：新闻检索全部派给 scout）。
  // 它只读、不碰 workspace，与 scout 的「依赖源码研究」边界互补。
  'web-researcher',
] as const;

const optionalSessionIdSchema = z.preprocess((value) => {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}, z.string().trim().min(1).optional());

const callOmoAgentInputSchema = z.object({
  description: z.string().min(1).optional(),
  prompt: z.string().min(1),
  subagent_type: z.string().min(1),
  run_in_background: z.boolean().default(false),
  session_id: optionalSessionIdSchema,
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
  description: `按名直接调用内置子代理（subagent），支持同步 / 后台执行两种模式。可用 subagent_type：${CALL_OMO_AGENT_LIST}。选型：explore=代码库搜索定位；librarian=代码库与官方文档检索；scout=外部依赖源码、上游仓库与第三方文档的只读研究；web-researcher=联网新闻、资讯与公开网页检索（多来源交叉比对，只读）；oracle/metis/momus=只读顾问与计划审查；hephaestus=自主深度实施；multimodal-looker=多模态媒体解读。**联网资讯/新闻检索派 web-researcher，不要派 scout**（也可由主会话直接用 websearch / webfetch）。`,
  inputSchema: callOmoAgentInputSchema,
  outputSchema: z.string(),
  timeout: 30000,
  execute: async () => {
    throw new Error('call_omo_agent must execute through the gateway-managed sandbox path');
  },
};
