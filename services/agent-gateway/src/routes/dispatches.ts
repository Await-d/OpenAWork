import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireAuth, type JwtPayload } from '../infra/auth.js';
import { ApiError } from '../infra/error-response.js';
import { parseBody, parseParams, parseQuery } from '../infra/parse-request.js';
import {
  dispatchAttemptRef,
  dispatchConfirm,
  dispatchCursor,
  dispatchDraftInput,
  dispatchEdit,
  dispatchId,
  dispatchQuestion,
} from '../dispatch/dispatch-contract.js';
import { assertDispatchModelAvailable, planDispatch } from '../dispatch/dispatch-generation.js';
import {
  dispatchScheduler,
  isDispatchEnabled,
  type DispatchScheduler,
} from '../dispatch/dispatch-scheduler.js';
import {
  actOnDispatch,
  confirmDispatch,
  createDispatch,
  editDispatch,
  getDispatch,
  getDispatchRow,
  listDispatches,
} from '../dispatch/dispatch-store.js';

interface DispatchRouteOptions {
  enabled?: () => boolean;
  scheduler?: DispatchScheduler;
  plan?: typeof planDispatch;
  validateModel?: typeof assertDispatchModelAvailable;
}

const batchParams = z.object({ id: dispatchId });
const itemParams = batchParams.extend({ itemId: dispatchId });
const querySchema = z.object({ cursor: z.string().max(100).optional() }).strict();

function ownerOf(request: FastifyRequest): string {
  return (request.user as JwtPayload).sub;
}

function decodeCursor(text: string) {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw ApiError.badRequest('分页游标无效。');
  }
  const cursor = dispatchCursor.safeParse(value);
  if (!cursor.success) throw ApiError.badRequest('分页游标无效。');
  return cursor.data;
}

export async function registerDispatchRoutes(
  app: FastifyInstance,
  options: DispatchRouteOptions = {},
): Promise<void> {
  const enabled = options.enabled ?? isDispatchEnabled;
  const scheduler = options.scheduler ?? dispatchScheduler;
  const plan = options.plan ?? planDispatch;
  const validateModel = options.validateModel ?? assertDispatchModelAvailable;
  const auth = { onRequest: [requireAuth] };
  const planningOwners = new Set<string>();

  function requireEnabled() {
    if (!enabled()) throw new ApiError(503, 'InternalError', '当前网关未启用派工助手。');
  }

  // Keep API paths separate from the authenticated SPA page and its deep links.
  const root = '/dispatch-assistant';
  app.get(root, auth, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const { cursor } = parseQuery(querySchema, request.query);
    return {
      enabled: enabled(),
      ...listDispatches(ownerOf(request), cursor === undefined ? undefined : decodeCursor(cursor)),
    };
  });

  app.get(`${root}/:id`, auth, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const { id } = parseParams(batchParams, request.params);
    return getDispatch(ownerOf(request), id);
  });

  app.post(`${root}/drafts`, { ...auth, bodyLimit: 128 * 1024 }, async (request, reply) => {
    requireEnabled();
    reply.header('Cache-Control', 'no-store');
    const owner = ownerOf(request);
    const input = parseBody(dispatchDraftInput, request.body);
    if (planningOwners.has(owner) || planningOwners.size >= 4) {
      throw new ApiError(429, 'Conflict', '草稿生成繁忙，请稍后重试。');
    }
    planningOwners.add(owner);
    const controller = new AbortController();
    const abort = () => controller.abort();
    reply.raw.once('close', abort);
    try {
      const { selection, plan: draft } = await plan(owner, input, controller.signal);
      controller.signal.throwIfAborted();
      requireEnabled();
      return createDispatch(owner, input, selection, draft);
    } finally {
      reply.raw.off('close', abort);
      planningOwners.delete(owner);
    }
  });

  app.patch(`${root}/:id/draft`, { ...auth, bodyLimit: 64 * 1024 }, async (request, reply) => {
    requireEnabled();
    reply.header('Cache-Control', 'no-store');
    const { id } = parseParams(batchParams, request.params);
    return editDispatch(ownerOf(request), id, parseBody(dispatchEdit, request.body));
  });

  app.post(`${root}/:id/confirm`, { ...auth, bodyLimit: 1024 }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const { id } = parseParams(batchParams, request.params);
    const { revision } = parseBody(dispatchConfirm, request.body);
    const owner = ownerOf(request);
    const row = getDispatchRow(owner, id);
    if (row.confirmedAt !== null || row.revision !== revision)
      return confirmDispatch(owner, id, revision);
    requireEnabled();
    await validateModel(owner, row);
    requireEnabled();
    const detail = confirmDispatch(owner, id, revision);
    scheduler.wake();
    return detail;
  });

  for (const kind of ['follow-up', 'retry', 'cancel'] as const) {
    app.post(
      `${root}/:id/items/:itemId/${kind}`,
      { ...auth, bodyLimit: 16 * 1024 },
      async (request, reply) => {
        reply.header('Cache-Control', 'no-store');
        const { id, itemId } = parseParams(itemParams, request.params);
        const owner = ownerOf(request);
        const action =
          kind === 'follow-up'
            ? { kind, ...parseBody(dispatchQuestion, request.body) }
            : { kind, ...parseBody(dispatchAttemptRef, request.body) };
        const detail = actOnDispatch(owner, id, itemId, action, requireEnabled);
        if (kind === 'cancel') scheduler.cancel(action.expectedAttemptId);
        scheduler.wake();
        return detail;
      },
    );
  }
}
