/**
 * 快捷提示词 API 路由
 *
 * 端点：
 * - GET    /prompt-snippets/groups          列出所有分组
 * - POST   /prompt-snippets/groups          创建分组
 * - PUT    /prompt-snippets/groups/:groupId 更新分组
 * - DELETE /prompt-snippets/groups/:groupId 删除分组（级联删除其下提示词）
 * - GET    /prompt-snippets                 列出提示词（可选 ?groupId= 过滤）
 * - POST   /prompt-snippets                 创建提示词
 * - PUT    /prompt-snippets/:snippetId      更新提示词
 * - DELETE /prompt-snippets/:snippetId      删除提示词
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { JwtPayload } from '../infra/auth.js';
import { requireAuth } from '../infra/auth.js';
import { startRequestWorkflow } from '../runtime/request-workflow.js';
import {
  createGroup,
  createSnippet,
  deleteGroup,
  deleteSnippet,
  listGroups,
  listSnippets,
  migratePromptSnippetsTables,
  updateGroup,
  updateSnippet,
} from '../prompt-snippets/prompt-snippets-store.js';

// Run migration on import
migratePromptSnippetsTables();

export async function promptSnippetsRoutes(app: FastifyInstance): Promise<void> {
  // ─── Groups ─────────────────────────────────────────────────────────────

  app.get(
    '/prompt-snippets/groups',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'prompt-snippets.groups.list');
      const user = request.user as JwtPayload;

      const groups = listGroups(user.sub);
      step.succeed(undefined, { count: groups.length });
      return reply.send({ groups });
    },
  );

  app.post(
    '/prompt-snippets/groups',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'prompt-snippets.groups.create');
      const user = request.user as JwtPayload;

      const body = request.body as { name?: string; order?: number } | null;
      const name = typeof body?.name === 'string' ? body.name.trim() : '';
      if (!name) {
        step.fail('validation');
        return reply.status(400).send({ error: '分组名称不能为空' });
      }

      const group = createGroup(user.sub, { name, order: body?.order });
      step.succeed(undefined, { groupId: group.id });
      return reply.status(201).send({ group });
    },
  );

  app.put(
    '/prompt-snippets/groups/:groupId',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'prompt-snippets.groups.update');
      const user = request.user as JwtPayload;
      const { groupId } = request.params as { groupId: string };

      const body = request.body as { name?: string; order?: number } | null;
      const group = updateGroup(user.sub, groupId, {
        name: typeof body?.name === 'string' ? body.name.trim() : undefined,
        order: typeof body?.order === 'number' ? body.order : undefined,
      });

      if (!group) {
        step.fail('not found');
        return reply.status(404).send({ error: '分组不存在' });
      }

      step.succeed(undefined, { groupId });
      return reply.send({ group });
    },
  );

  app.delete(
    '/prompt-snippets/groups/:groupId',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'prompt-snippets.groups.delete');
      const user = request.user as JwtPayload;
      const { groupId } = request.params as { groupId: string };

      const deleted = deleteGroup(user.sub, groupId);
      if (!deleted) {
        step.fail('not found');
        return reply.status(404).send({ error: '分组不存在' });
      }

      step.succeed(undefined, { groupId });
      return reply.send({ ok: true });
    },
  );

  // ─── Snippets ───────────────────────────────────────────────────────────

  app.get(
    '/prompt-snippets',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'prompt-snippets.list');
      const user = request.user as JwtPayload;

      const query = request.query as { groupId?: string } | null;
      const groupId = typeof query?.groupId === 'string' ? query.groupId : undefined;

      const snippets = listSnippets(user.sub, groupId);
      step.succeed(undefined, { count: snippets.length });
      return reply.send({ snippets });
    },
  );

  app.post(
    '/prompt-snippets',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'prompt-snippets.create');
      const user = request.user as JwtPayload;

      const body = request.body as {
        groupId?: string;
        title?: string;
        content?: string;
        order?: number;
      } | null;

      const groupId = typeof body?.groupId === 'string' ? body.groupId.trim() : '';
      const title = typeof body?.title === 'string' ? body.title.trim() : '';
      const content = typeof body?.content === 'string' ? body.content : '';

      if (!groupId) {
        step.fail('validation');
        return reply.status(400).send({ error: '必须指定分组 groupId' });
      }
      if (!title) {
        step.fail('validation');
        return reply.status(400).send({ error: '标题不能为空' });
      }
      if (!content) {
        step.fail('validation');
        return reply.status(400).send({ error: '提示词内容不能为空' });
      }

      const snippet = createSnippet(user.sub, { groupId, title, content, order: body?.order });
      step.succeed(undefined, { snippetId: snippet.id });
      return reply.status(201).send({ snippet });
    },
  );

  app.put(
    '/prompt-snippets/:snippetId',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'prompt-snippets.update');
      const user = request.user as JwtPayload;
      const { snippetId } = request.params as { snippetId: string };

      const body = request.body as {
        title?: string;
        content?: string;
        groupId?: string;
        order?: number;
      } | null;

      const snippet = updateSnippet(user.sub, snippetId, {
        title: typeof body?.title === 'string' ? body.title.trim() : undefined,
        content: typeof body?.content === 'string' ? body.content : undefined,
        groupId: typeof body?.groupId === 'string' ? body.groupId.trim() : undefined,
        order: typeof body?.order === 'number' ? body.order : undefined,
      });

      if (!snippet) {
        step.fail('not found');
        return reply.status(404).send({ error: '提示词不存在' });
      }

      step.succeed(undefined, { snippetId });
      return reply.send({ snippet });
    },
  );

  app.delete(
    '/prompt-snippets/:snippetId',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'prompt-snippets.delete');
      const user = request.user as JwtPayload;
      const { snippetId } = request.params as { snippetId: string };

      const deleted = deleteSnippet(user.sub, snippetId);
      if (!deleted) {
        step.fail('not found');
        return reply.status(404).send({ error: '提示词不存在' });
      }

      step.succeed(undefined, { snippetId });
      return reply.send({ ok: true });
    },
  );
}
