/**
 * Team runtime 客户端：legacy stub。
 *
 * 历史背景：
 *   - v1 暴露了 `interaction-agent/rewrite` + `team-leader/dispatch` 两个 LLM-driven 端点
 *   - v2（260518）引入五层架构 + handoff 协议后，这些端点被新路径（reception-orchestrator
 *     + watcher 自动链）完全替代
 *   - L1.4 §1.4.4 退出策略：旧路径已删除，本 client 保留接口形状但永远返回 `null`
 *
 * 为什么还保留这个文件：
 *   - apps/web 的 team-runtime-shell（老 UI）仍在用 `interaction-agent-flow.ts` /
 *     `team-leader-flow.ts` 调用本 client。删除会引发大面积级联破坏。
 *   - 新 UI（TeamSessionView）不依赖本 client，它走 inbound + 后端编排。
 *   - 本 stub 让老 UI 优雅降级（fallback 路径已存在，会落到 ack 消息）
 *
 * 长期规划：迁移老 UI → 删除本 client（连同 `*-flow.ts`）。
 */

export interface InteractionAgentRewriteRequest {
  intent: string;
  context?: string;
}

export interface InteractionAgentRewriteResponse {
  createdAt: number;
  recommendedNextStep: string;
  recommendedRole: string;
  rewrittenIntent: string;
  sourceIntent: string;
  status: 'completed';
}

export interface TeamLeaderDispatchedTask {
  assigneeRole: string;
  assigneeAgentId: string;
  priority: 'low' | 'medium' | 'high';
  taskId: string;
  title: string;
}

export interface TeamLeaderRosterMember {
  role: string;
  agentId: string;
  agentLabel: string;
  capability?: string;
}

export interface TeamLeaderDispatchRequest {
  context?: string;
  recommendedRole?: string;
  rewrittenIntent: string;
  sourceIntent: string;
  teamRoster: TeamLeaderRosterMember[];
}

export interface TeamLeaderDispatchResponse {
  dispatchedTasks: TeamLeaderDispatchedTask[];
  leaderAnalysis: string;
  status: 'completed';
}

export interface TeamRuntimeClient {
  /**
   * @deprecated 老路径已移除。永远返回 `null`。新代码请走
   * `POST /team/sessions/:id/inbound-messages`（messageType='user_input'），
   * 由 reception-orchestrator 自动派发到 PM1。
   */
  rewriteIntent(
    token: string | null,
    input: InteractionAgentRewriteRequest,
  ): Promise<InteractionAgentRewriteResponse | null>;
  /**
   * @deprecated 老路径已移除。永远返回 `null`。新代码请走 watcher 自动 pm1→pm2
   * 链 + d.dispatch_package 内置指令。
   */
  dispatch(
    token: string | null,
    input: TeamLeaderDispatchRequest,
  ): Promise<TeamLeaderDispatchResponse | null>;
}

/**
 * @deprecated Legacy stub。所有方法返回 `null` 让老 UI 走 fallback 路径。
 */
export function createTeamRuntimeClient(_baseUrl: string): TeamRuntimeClient {
  return {
    async rewriteIntent() {
      return null;
    },
    async dispatch() {
      return null;
    },
  };
}
