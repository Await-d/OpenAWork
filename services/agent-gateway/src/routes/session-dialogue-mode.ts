import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  confirmGrill,
  CONFIRM_NODE_ID,
  parseGrillState,
  serializeGrillState,
} from '@openAwork/agent-core';
import { requireAuth, type JwtPayload } from '../infra/auth.js';
import { ApiError } from '../infra/error-response.js';
import { sqliteGet } from '../infra/db.js';
import { startRequestWorkflow } from '../runtime/request-workflow.js';
import { parseSessionMetadataJson } from '../session/session-workspace-metadata.js';
import { switchSessionDialogueModeToCoding } from '../session/dialogue-mode-switch.js';

interface SessionMetadataRow {
  metadata_json: string;
}

/**
 * 用户在界面上显式确认「方案设计完成」并切换到编程模式（chat 页面的「确认转换」按钮）。
 *
 * 与自动门控（`routes/questions.ts` 的确认节点 / ExitPlanMode）的关系：
 *   - 都走 `switchSessionDialogueModeToCoding`，因此状态、审计字段与幂等语义一致；
 *   - 本路由额外把澄清确认门控（`clarificationState` 的确认节点）**在同一次写入里**结算掉
 *     ——用户点按钮本身就是"共识已确认"的表达，避免留下"已进入编程模式但确认节点仍未决"
 *     的中间态；两次独立写库会互相覆盖字段，所以走 `metadataPatch` 合流。
 *
 * 幂等：非澄清模式（已在编程 / 程序员模式）直接返回当前模式，不做任何写操作。
 */
export async function sessionDialogueModeRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/sessions/:sessionId/clarify/confirm',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtPayload;
      const { sessionId } = request.params as { sessionId: string };
      const { step } = startRequestWorkflow(
        request,
        'session.dialogue-mode.confirm-clarify',
        undefined,
        { sessionId },
      );

      const session = sqliteGet<SessionMetadataRow>(
        'SELECT metadata_json FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
        [sessionId, user.sub],
      );
      if (!session) {
        step.fail('session not found');
        throw ApiError.notFound('目标会话不存在。');
      }

      const metadata = parseSessionMetadataJson(session.metadata_json);
      const currentMode = metadata['dialogueMode'];
      if (currentMode !== 'clarify') {
        // 幂等：不在澄清模式时无需切换（其他入口已切，或用户已手动切走）。
        step.succeed(undefined, { alreadySwitched: true });
        return reply.send({
          ok: true,
          switched: false,
          ...(typeof currentMode === 'string' ? { dialogueMode: currentMode } : {}),
        });
      }

      const settledClarificationState = settleClarifyConfirmationGate(metadata);
      const switchResult = switchSessionDialogueModeToCoding({
        reason: 'user_confirmed',
        sessionId,
        ...(settledClarificationState
          ? { metadataPatch: { clarificationState: settledClarificationState } }
          : {}),
      });

      step.succeed(undefined, { switched: switchResult.switched });
      return reply.send({
        ok: true,
        switched: switchResult.switched,
        ...(switchResult.dialogueMode ? { dialogueMode: switchResult.dialogueMode } : {}),
      });
    },
  );
}

/**
 * 计算结算确认门控后的 `clarificationState` 序列化值（纯函数，不写库）。
 * 无 grill 状态、无确认节点、或已确认时返回 null（表示无需写入）。
 */
function settleClarifyConfirmationGate(metadata: Record<string, unknown>): string | null {
  const rawState = metadata['clarificationState'];
  if (typeof rawState !== 'string') {
    return null;
  }

  const state = parseGrillState(rawState);
  if (!state || state.confirmedAt !== undefined) {
    return null;
  }
  if (!state.nodes.some((node) => node.id === CONFIRM_NODE_ID)) {
    return null;
  }

  return serializeGrillState(confirmGrill(state));
}
