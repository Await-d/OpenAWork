/**
 * Claude Code `Agent` 兼容入口的可委派 agent 白名单。
 *
 * 背景（D2-a 裁决）：`call_omo_agent` 入口收敛为规范名 `subagent` 后，原生
 * `subagent`（/ `task`）入口维持「任意内置 / 自定义 agent」的产品能力，**不得**收窄；
 * 而 Claude Code 兼容入口（呈报名 `Agent`）历史上受 9 人白名单约束，语义必须保持不变。
 * 因此白名单校验从 `tools/sandbox/handlers/delegation.ts` 的 `call_omo_agent` 分支体
 * **迁移**到 Claude Code 的 `Agent` 输入适配层（`claude-code-input-adapters.ts` 的
 * `case 'Agent'`），常量改中性名 `CLAUDE_CODE_AGENT_ALLOWED_AGENTS`。
 *
 * 谁还受名单约束：Claude Code 侧发来的 `Agent` 调用（含其 `subagent_type` 字段）。
 * 谁不受约束：原生 `subagent` / `task` 委派（走 `resolveDelegatedAgent`，接受任意
 * 内置或用户自定义 agent）。
 */
export const CLAUDE_CODE_AGENT_ALLOWED_AGENTS = [
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

export type ClaudeCodeAllowedAgent = (typeof CLAUDE_CODE_AGENT_ALLOWED_AGENTS)[number];

/** 名单大小写 / 空白不敏感判定。 */
export function isClaudeCodeAllowedAgent(candidate: string): boolean {
  const normalized = candidate.trim().toLowerCase();
  return CLAUDE_CODE_AGENT_ALLOWED_AGENTS.includes(normalized as ClaudeCodeAllowedAgent);
}
