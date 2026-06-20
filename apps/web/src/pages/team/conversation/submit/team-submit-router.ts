/**
 * team-submit-router · team 端 composer 提交路由
 *
 * 决定用户在 team session 中按下回车时，输入应该走哪条写入路径：
 *
 * - `stream`：开启普通 chat SSE/WS 流（pm1/pm2/executor/reviewer 等 chat 风格
 *   session 都支持）。
 *
 * - `inbound`：通过 L1.3 反向通道
 *   `POST /team/sessions/:id/inbound-messages` 投递。reception 根会话使用它
 *   触发后端团队编排；clarifying 会话的普通 composer 也投递 `user_input`，
 *   具体带 questionId 的澄清回答由 ClarificationsPanel 处理。
 *
 * **演化历史**：从 `pages/team/runtime/shell/session-view/TeamSessionView.tsx`
 * 的 `resolveSubmitStrategy` 抽出，并收敛为当前真实可用的 stream / inbound
 * 两条写入路径。
 *
 * 关联文档：
 * - `.agentdocs/workflow/260518-team-conversation-decouple-plan.md` §6.4
 * - `docs/chat-conversation-reuse-plan.md` v1.5 D5 决策
 * - `docs/team-architecture-l1-3-streaming-handoff-spec.md` §1.3
 */

export type TeamSubmitStrategy =
  | { kind: 'stream' }
  | {
      kind: 'inbound';
      messageType: 'user_input';
    };

/**
 * 根据当前 session 的 roleLayer 与 substate 决定 composer 提交走哪条路径。
 *
 * 当前规则：
 * - `substate === 'clarifying'` → inbound:user_input（普通 composer 无 questionId）
 * - `roleLayer === 'reception'` → inbound:user_input
 * - 其它（pm1/pm2/executor/reviewer 普通对话） → stream
 *
 * 暴露为 pure function 便于单测。
 */
export function resolveTeamSubmitStrategy(
  roleLayer: string | null,
  substate: string | null,
): TeamSubmitStrategy {
  // c session 处于澄清环节：普通 composer 没有 questionId，不能伪造成
  // clarification_answer；带 questionId 的正式澄清回答由 ClarificationsPanel 处理。
  if (substate === 'clarifying') {
    return { kind: 'inbound', messageType: 'user_input' };
  }

  // reception 根会话是团队入口：用户输入应先走 inbound user_input，由
  // team-inbound → reception-orchestrator 决定是派发下游还是少量直答。
  if (roleLayer === 'reception') {
    return { kind: 'inbound', messageType: 'user_input' };
  }

  // 其它路径（pm1/pm2/executor/reviewer）走普通 chat stream。
  return { kind: 'stream' };
}
