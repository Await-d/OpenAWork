/**
 * team-submit-router · team 端 composer 提交路由
 *
 * 决定用户在 team session 中按下回车时，输入应该走哪条写入路径：
 *
 * - `stream`：开启普通 chat SSE/WS 流（reception/pm1/pm2/executor/reviewer
 *   等 chat 风格 session 都支持）。reception session 走这条让 b agent 直
 *   接对话，由 b runner 异步驱动后续 orchestration。
 *
 * - `inbound`：通过 L1.3 反向通道
 *   `POST /team/sessions/:id/inbound-messages` 投递。当 substate 为
 *   `clarifying` 时使用，因为 c session 正处于 LLM 循环中，不能直接注入
 *   user message，必须由 c runner 主动 consume inbound 队列。
 *
 * - `handoff`（预留）：将来 team 内某些路径可能会显式触发 handoff 链路而
 *   非投递消息（例如用户在 reception 显式批准 spec / plan 时）。当前未使用。
 *
 * **演化历史**：从 `pages/team/runtime/shell/session-view/TeamSessionView.tsx`
 * 的 `resolveSubmitStrategy` 抽出，扩展 handoff 路径预留位。
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
      /**
       * inbound 消息类型。当前仅用 `clarification_answer`（c session 澄清问题
       * 的回答）；预留 `user_input` / `spec_revision` / `plan_approval` 等
       * future message types，等 L1.3 spec 落地后启用。
       */
      messageType: 'clarification_answer' | 'user_input' | 'spec_revision' | 'plan_approval';
    }
  | {
      kind: 'handoff';
      /** 目标层级（pm1 / pm2 / executor / reviewer）。 */
      targetLayer: string;
    };

/**
 * 根据当前 session 的 roleLayer 与 substate 决定 composer 提交走哪条路径。
 *
 * 当前规则（与 D5 决策对齐）：
 * - `substate === 'clarifying'` → inbound:clarification_answer
 * - 其它（含 reception 普通对话 / pm1/pm2/executor/reviewer 普通对话） → stream
 *
 * 暴露为 pure function 便于单测。
 */
export function resolveTeamSubmitStrategy(
  roleLayer: string | null,
  substate: string | null,
): TeamSubmitStrategy {
  // c session 处于澄清环节：必须通过 inbound 队列由 c runner 消费，不能注入 stream。
  if (substate === 'clarifying') {
    return { kind: 'inbound', messageType: 'clarification_answer' };
  }

  // 其它路径（含 reception 与各执行层）走普通 chat stream。
  // 注意：roleLayer 当前只参与 default placeholder 选择（在 view 层），
  // 不参与 strategy 决策。保留参数是为了将来根据 layer 区分写路径。
  void roleLayer;

  return { kind: 'stream' };
}
