/**
 * Team runtime 客户端：interaction-agent 改写、team-leader 分派。
 *
 * 这两个端点都是 LLM 驱动的"问答-改写"链路，错误时返回 `null` 让上层走 fallback。
 */

import { jsonAuthHeaders } from './http.js';

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
  /** POST `/team/interaction-agent/rewrite`。失败返回 `null`，由调用方走 fallback。 */
  rewriteIntent(
    token: string,
    input: InteractionAgentRewriteRequest,
  ): Promise<InteractionAgentRewriteResponse | null>;
  /** POST `/team/leader/dispatch`。失败返回 `null`。 */
  dispatch(
    token: string,
    input: TeamLeaderDispatchRequest,
  ): Promise<TeamLeaderDispatchResponse | null>;
}

export function createTeamRuntimeClient(baseUrl: string): TeamRuntimeClient {
  return {
    async rewriteIntent(token, input) {
      try {
        const headers = token ? jsonAuthHeaders(token) : { 'Content-Type': 'application/json' };
        const response = await fetch(`${baseUrl}/team/interaction-agent/rewrite`, {
          method: 'POST',
          headers,
          body: JSON.stringify(input),
        });
        if (!response.ok) {
          return null;
        }
        return (await response.json()) as InteractionAgentRewriteResponse;
      } catch {
        return null;
      }
    },

    async dispatch(token, input) {
      try {
        const headers = token ? jsonAuthHeaders(token) : { 'Content-Type': 'application/json' };
        const response = await fetch(`${baseUrl}/team/leader/dispatch`, {
          method: 'POST',
          headers,
          body: JSON.stringify(input),
        });
        if (!response.ok) {
          return null;
        }
        return (await response.json()) as TeamLeaderDispatchResponse;
      } catch {
        return null;
      }
    },
  };
}
