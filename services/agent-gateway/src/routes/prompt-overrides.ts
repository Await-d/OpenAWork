/**
 * 对话模式提示词覆盖 HTTP 契约。
 *
 * 边界：本路由只管理「模式提示词文本」，不涉及 Agent 目录（内置 Agent 的提示词覆盖
 * 复用既有 `PUT /agents/:agentId`）。用户身份只取已认证主体（`request.user.sub`），
 * 不接受 body 里的 owner，避免越权改他人配置。
 *
 * 日志约定：只记录模式、长度与错误码，**不记录提示词正文**。
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { JwtPayload } from '../infra/auth.js';
import { requireAuth } from '../infra/auth.js';
import { parseBody, parseParams } from '../infra/parse-request.js';
import {
  PROMPT_OVERRIDE_ERROR_MESSAGES,
  readPromptOverrideSnapshot,
  resetDialogueModePromptOverride,
  writeDialogueModePromptOverride,
} from '../prompt/prompt-override-store.js';
import { startRequestWorkflow } from '../runtime/request-workflow.js';

/** 错误文案与 store 同源，避免两处措辞漂移。 */
export const PROMPT_OVERRIDE_ROUTE_ERROR_MESSAGES = {
  unknownMode: PROMPT_OVERRIDE_ERROR_MESSAGES.unknownMode,
  emptyText: PROMPT_OVERRIDE_ERROR_MESSAGES.emptyText,
  tooLong: PROMPT_OVERRIDE_ERROR_MESSAGES.tooLong,
  invalidCharacters: PROMPT_OVERRIDE_ERROR_MESSAGES.invalidCharacters,
} as const;

export function mapPromptOverrideError(error: unknown): { error: string; statusCode: number } {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes(PROMPT_OVERRIDE_ERROR_MESSAGES.unknownMode)) {
    return { statusCode: 400, error: PROMPT_OVERRIDE_ERROR_MESSAGES.unknownMode };
  }
  if (message.includes(PROMPT_OVERRIDE_ERROR_MESSAGES.emptyText)) {
    return { statusCode: 400, error: PROMPT_OVERRIDE_ERROR_MESSAGES.emptyText };
  }
  if (message.includes(PROMPT_OVERRIDE_ERROR_MESSAGES.tooLong)) {
    return { statusCode: 400, error: PROMPT_OVERRIDE_ERROR_MESSAGES.tooLong };
  }
  if (message.includes(PROMPT_OVERRIDE_ERROR_MESSAGES.invalidCharacters)) {
    return { statusCode: 400, error: PROMPT_OVERRIDE_ERROR_MESSAGES.invalidCharacters };
  }

  // 其余错误（DB 故障、磁盘错误等）属基础设施问题，不能伪装成「参数无效」——
  // 既误导用户改输入，也会把内部错误细节泄露给客户端。
  return {
    statusCode: 500,
    error: '模式提示词操作失败，请稍后重试。',
  };
}

const modeParamsSchema = z.object({ mode: z.string().trim().min(1).max(32) });

/**
 * 只校验「text 是字符串」，不 trim、不设 min/max。
 *
 * 长度、空白与非法控制字符统一由 store 判定，否则 schema 会先一步拦截，
 * 使响应文案变成框架的通用文案、而 store 的明确文案与 `mapPromptOverrideError`
 * 对应分支永远不可达（复查修复）。超大请求仍由 Fastify bodyLimit 保护。
 */
const writePromptOverrideSchema = z.object({
  text: z.string(),
});

export async function promptOverridesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/prompt-overrides', { onRequest: [requireAuth] }, async (request, reply) => {
    const { step } = startRequestWorkflow(request, 'prompt-overrides.read');
    const user = request.user as JwtPayload;
    const snapshot = readPromptOverrideSnapshot(user.sub);
    step.succeed(undefined, {
      modeCount: snapshot.modes.length,
      configState: snapshot.configState,
    });
    return reply.send(snapshot);
  });

  app.put(
    '/prompt-overrides/dialogue-modes/:mode',
    { onRequest: [requireAuth] },
    async (request, reply) => {
      const { step } = startRequestWorkflow(request, 'prompt-overrides.write');
      const user = request.user as JwtPayload;
      const params = parseParams(modeParamsSchema, request.params ?? {});
      const body = parseBody(writePromptOverrideSchema, request.body ?? {});

      try {
        const promptOverride = writeDialogueModePromptOverride(user.sub, params.mode, body.text);
        step.succeed(undefined, {
          mode: promptOverride.mode,
          length: promptOverride.effectiveText.length,
        });
        return reply.send({ promptOverride });
      } catch (error) {
        const mapped = mapPromptOverrideError(error);
        step.fail(error instanceof Error ? error.message : 'write failed');
        return reply.status(mapped.statusCode).send({ error: mapped.error });
      }
    },
  );

  app.post(
    '/prompt-overrides/dialogue-modes/:mode/reset',
    { onRequest: [requireAuth] },
    async (request, reply) => {
      const { step } = startRequestWorkflow(request, 'prompt-overrides.reset');
      const user = request.user as JwtPayload;
      const params = parseParams(modeParamsSchema, request.params ?? {});

      try {
        const promptOverride = resetDialogueModePromptOverride(user.sub, params.mode);
        step.succeed(undefined, { mode: promptOverride.mode });
        return reply.send({ promptOverride });
      } catch (error) {
        const mapped = mapPromptOverrideError(error);
        step.fail(error instanceof Error ? error.message : 'reset failed');
        return reply.status(mapped.statusCode).send({ error: mapped.error });
      }
    },
  );
}
