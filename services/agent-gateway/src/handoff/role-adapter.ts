/**
 * 260516-team-phase-e · T-03
 *
 * TeamRoleAdapter 接口 + 5 个内置 adapter。
 *
 * Adapter 的职责：把抽象的 role_layer 映射到具体的执行配置：
 *   - agentImplKey：使用哪个 agent 实现（对应 agent-catalog 中的 id）
 *   - promptTransform：对 system prompt 做的额外变换
 *   - contextBuilder：构建该层特有的上下文（如 PM1 需要 spec-kit 模板）
 *   - defaultToolsets：该层默认可用的工具类别
 */

import type { ToolsetCategory } from './dispatch-package.js';

export interface RoleAdapterResolution {
  /** agent 实现标识（对应 agent-catalog 中的 id） */
  agentImplKey: string;
  /** 额外注入到 system prompt 的内容 */
  promptSuffix: string;
  /** 该层默认可用的 toolset 类别 */
  defaultToolsets: ToolsetCategory[];
  /** 推荐的 LLM provider（可被 workflow binding 覆盖） */
  recommendedProvider: string | null;
  /** 推荐的 model（可被 workflow binding 覆盖） */
  recommendedModel: string | null;
}

export interface TeamRoleAdapter {
  /** adapter 唯一标识 */
  key: string;
  /** 显示名 */
  displayName: string;
  /** 解析该 adapter 的配置 */
  resolve(context: RoleAdapterContext): RoleAdapterResolution;
}

export interface RoleAdapterContext {
  userId: string;
  teamWorkspaceId: string | null;
  workflowId: string | null;
  /** 上游 step 的输出摘要（用于构建上下文） */
  upstreamSummary: string;
}

// ─── 5 个内置 Adapter ───────────────────────────────────────────────────────

const receptionAdapter: TeamRoleAdapter = {
  key: 'reception-default',
  displayName: '接待（默认）',
  resolve: (_ctx) => ({
    agentImplKey: 'interaction-agent',
    promptSuffix: '你是接待 Agent。把用户的自然语言意图改写为可执行的需求语言。',
    defaultToolsets: ['read', 'web'],
    recommendedProvider: null,
    recommendedModel: null,
  }),
};

const pm1Adapter: TeamRoleAdapter = {
  key: 'pm1-default',
  displayName: '任务规划 PM1（默认）',
  resolve: (_ctx) => ({
    agentImplKey: 'planner',
    promptSuffix: '你是 PM1 任务规划师。根据意图生成 spec → plan → tasks 产物链。',
    defaultToolsets: ['read', 'web', 'lsp'],
    recommendedProvider: null,
    recommendedModel: null,
  }),
};

const pm2Adapter: TeamRoleAdapter = {
  key: 'pm2-default',
  displayName: '开发管控 PM2（默认）',
  resolve: (_ctx) => ({
    agentImplKey: 'team-leader',
    promptSuffix: '你是 PM2 开发管控主管。解析 tasks 并拆分为 dispatch_packages 派发给执行层。',
    defaultToolsets: ['read', 'lsp'],
    recommendedProvider: null,
    recommendedModel: null,
  }),
};

const executorAdapter: TeamRoleAdapter = {
  key: 'executor-default',
  displayName: '执行（默认）',
  resolve: (_ctx) => ({
    agentImplKey: 'executor',
    promptSuffix: '你是执行 Agent。在明确任务下做出可工作的代码/文档/配置。',
    defaultToolsets: ['read', 'write', 'shell', 'lsp', 'test'],
    recommendedProvider: null,
    recommendedModel: null,
  }),
};

const reviewerAdapter: TeamRoleAdapter = {
  key: 'reviewer-default',
  displayName: '评审（默认）',
  resolve: (_ctx) => ({
    agentImplKey: 'reviewer',
    promptSuffix: '你是评审 Agent。对照验收标准和宪法检查产物质量。',
    defaultToolsets: ['read', 'lsp', 'review'],
    recommendedProvider: null,
    recommendedModel: null,
  }),
};

// ─── Registry ───────────────────────────────────────────────────────────────

const BUILTIN_ADAPTERS: readonly TeamRoleAdapter[] = [
  receptionAdapter,
  pm1Adapter,
  pm2Adapter,
  executorAdapter,
  reviewerAdapter,
];

const adapterRegistry = new Map<string, TeamRoleAdapter>(BUILTIN_ADAPTERS.map((a) => [a.key, a]));

export function getAdapter(key: string): TeamRoleAdapter | undefined {
  return adapterRegistry.get(key);
}

export function listAdapters(): TeamRoleAdapter[] {
  return Array.from(adapterRegistry.values());
}

export function registerAdapter(adapter: TeamRoleAdapter): void {
  adapterRegistry.set(adapter.key, adapter);
}

/**
 * 根据 adapter key 解析配置。找不到时返回 null。
 */
export function resolveAdapter(
  key: string,
  context: RoleAdapterContext,
): RoleAdapterResolution | null {
  const adapter = adapterRegistry.get(key);
  if (!adapter) return null;
  return adapter.resolve(context);
}
