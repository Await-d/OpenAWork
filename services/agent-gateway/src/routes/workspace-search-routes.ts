/**
 * 工作区检索路由：按文件名定位（`/workspace/find-by-name`）与内容 grep
 * （`/workspace/search`）。
 *
 * 从 `routes/workspace.ts` 拆出：这两个路由各自带完整的递归扫描实现，与主文件
 * 的路径守卫只是「共用」关系而非「内聚」关系，合在一起会让 workspace.ts 越过
 * 2000 行硬性拆分线。
 *
 * 守卫（路径合法性 / ignore 规则 / 用户 allowlist）由主文件以 {@link
 * WorkspaceSearchRouteDeps} 注入：守卫只有一份实现，既避免两处漂移，也避免
 * 两个路由文件互相 import 形成环。
 *
 * 两条路由都在任何本地路径校验之前先走 SSH 分支 —— 远端 POSIX 工作区在网关
 * 运行于 Windows 时，本地 `validateWorkspacePathForRequest` 会直接 400
 * （「当前网关运行在 Windows，无法访问 POSIX 路径：…」）。
 */
import { promises as fsp, type Dirent, type Stats } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { defaultIgnoreManager } from '@openAwork/agent-core';
import type { JwtPayload } from '../infra/auth.js';
import { requireAuth } from '../infra/auth.js';
import { parseQuery } from '../infra/parse-request.js';
import { startRequestWorkflow } from '../runtime/request-workflow.js';
import { handleSshWorkspaceOp, sshIdentityFrom } from '../workspace/workspace-ssh-routes.js';

/** 递归扫描时跳过的目录 / 文件名，与本地忽略清单同口径。 */
const IGNORED = new Set(['node_modules', '.git', 'dist', '.next', '__pycache__', '.DS_Store']);

/** 单次检索返回上限，防止大工作区把网关内存拖爆。 */
const MAX_SEARCH_RESULTS = 50;

/**
 * 单文件扫描上限：超过则跳过而不读取。
 *
 * 与 `routes/workspace.ts` 的同名常量同值（512KB），但各自独立 ——
 * 检索路由不依赖主文件的私有常量，避免又一条跨文件耦合。
 */
const MAX_SEARCH_FILE_BYTES = 512 * 1024;

/** 403 文案。由主文件注入以保证两处逐字一致。 */
export interface WorkspaceSearchRouteDeps {
  checkUserWorkspaceAccess: (
    request: FastifyRequest,
    reply: FastifyReply,
    safePath: string,
  ) => boolean;
  ensureIgnoreRulesLoadedForPath: (path: string) => Promise<void>;
  validateWorkspacePathForRequest: (path: string) => string | null;
  forbiddenPathMessage: string;
}

export async function workspaceSearchRoutes(
  app: FastifyInstance,
  deps: WorkspaceSearchRouteDeps,
): Promise<void> {
  const {
    checkUserWorkspaceAccess,
    ensureIgnoreRulesLoadedForPath,
    validateWorkspacePathForRequest,
    forbiddenPathMessage,
  } = deps;

  app.get(
    '/workspace/find-by-name',
    { preHandler: requireAuth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Resolve a bare filename (e.g. `create_quotation.py`) to all
      // file paths under `path` whose basename matches. Distinct from
      // `/workspace/search` which is a content grep — for "user clicked
      // a filename in chat, find the actual file" we need a basename
      // lookup, not a content lookup.
      //
      // Returns up to `maxResults` matches. Callers (notably the chat
      // path-ref click handler) should prefer the shortest path among
      // exact basename matches when multiple are returned.
      const { step, child } = startRequestWorkflow(request, 'workspace.find-by-name');
      const user = request.user as JwtPayload;
      const schema = z.object({
        name: z.string().min(1),
        path: z.string(),
        maxResults: z.coerce.number().int().min(1).max(50).default(8),
        workspaceRoot: z.string().optional(),
        sessionId: z.string().min(1).optional(),
        sshConnectionId: z.string().min(1).optional(),
      });
      const parsed = parseQuery(schema, request.query);

      if (
        (
          await handleSshWorkspaceOp({
            reply,
            user: user.sub,
            op: 'findByName',
            identity: sshIdentityFrom(parsed),
            path: parsed.path,
            name: parsed.name,
            maxResults: parsed.maxResults,
          })
        ).kind === 'handled'
      ) {
        return reply;
      }

      const safePath = validateWorkspacePathForRequest(parsed.path);
      if (!safePath) {
        step.fail('forbidden path');
        return reply.status(403).send({
          results: [],
          error: forbiddenPathMessage,
        });
      }
      if (!checkUserWorkspaceAccess(request, reply, safePath)) return;
      await ensureIgnoreRulesLoadedForPath(safePath);

      const { name, maxResults } = parsed;
      const results: Array<{ path: string }> = [];
      const scanStep = child('scan', undefined, { maxResults });

      async function walk(dirPath: string): Promise<void> {
        if (results.length >= maxResults) return;
        let entries: Dirent[];
        try {
          entries = await fsp.readdir(dirPath, { withFileTypes: true });
        } catch {
          return;
        }
        for (const entry of entries) {
          if (results.length >= maxResults) break;
          if (IGNORED.has(entry.name)) continue;
          const fullPath = join(dirPath, entry.name);
          if (defaultIgnoreManager.shouldIgnore(fullPath)) continue;
          if (entry.isDirectory()) {
            await walk(fullPath);
          } else if (entry.isFile() && entry.name === name) {
            results.push({ path: fullPath });
          }
        }
      }

      await walk(safePath);
      scanStep.succeed(undefined, { results: results.length });
      step.succeed(undefined, { results: results.length });
      return reply.send({ results });
    },
  );

  app.get(
    '/workspace/search',
    { preHandler: requireAuth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'workspace.search');
      const user = request.user as JwtPayload;
      const schema = z.object({
        q: z.string().min(1),
        path: z.string(),
        maxResults: z.coerce.number().int().min(1).max(MAX_SEARCH_RESULTS).default(20),
        workspaceRoot: z.string().optional(),
        sessionId: z.string().min(1).optional(),
        sshConnectionId: z.string().min(1).optional(),
      });

      const parseStep = child('parse-query');
      const parsed = parseQuery(schema, request.query);
      parseStep.succeed(undefined, { maxResults: parsed.maxResults });

      if (
        (
          await handleSshWorkspaceOp({
            reply,
            user: user.sub,
            op: 'search',
            identity: sshIdentityFrom(parsed),
            path: parsed.path,
            query: parsed.q,
            maxResults: parsed.maxResults,
          })
        ).kind === 'handled'
      ) {
        return reply;
      }

      const pathStep = child('path-safety');
      const safePath = validateWorkspacePathForRequest(parsed.path);
      if (!safePath) {
        pathStep.fail('forbidden path');
        step.fail('forbidden path');
        return reply.status(403).send({
          results: [],
          error: forbiddenPathMessage,
        });
      }
      pathStep.succeed();
      if (!checkUserWorkspaceAccess(request, reply, safePath)) return;
      await ensureIgnoreRulesLoadedForPath(safePath);

      const { maxResults, q } = parsed;
      const results: Array<{ path: string; line: number; text: string }> = [];
      let scannedFiles = 0;
      let skippedLargeFiles = 0;

      const scanStep = child('scan', undefined, { maxResults });
      async function searchDirectory(dirPath: string): Promise<void> {
        if (results.length >= maxResults) return;

        let entries: Dirent[];
        try {
          entries = await fsp.readdir(dirPath, { withFileTypes: true });
        } catch {
          return;
        }

        for (const entry of entries) {
          if (results.length >= maxResults) break;
          if (IGNORED.has(entry.name)) continue;

          const fullPath = join(dirPath, entry.name);
          if (defaultIgnoreManager.shouldIgnore(fullPath)) continue;
          if (entry.isDirectory()) {
            await searchDirectory(fullPath);
          } else if (entry.isFile()) {
            let stat: Stats;
            try {
              stat = await fsp.stat(fullPath);
            } catch {
              continue;
            }

            scannedFiles++;
            if (stat.size > MAX_SEARCH_FILE_BYTES) {
              skippedLargeFiles++;
              continue;
            }

            let content: string;
            try {
              content = await fsp.readFile(fullPath, 'utf8');
            } catch {
              continue;
            }

            const lines = content.split('\n');
            for (let index = 0; index < lines.length && results.length < maxResults; index++) {
              if (lines[index]!.includes(q)) {
                results.push({ path: fullPath, line: index + 1, text: lines[index]!.trim() });
              }
            }
          }
        }
      }

      await searchDirectory(safePath);
      scanStep.succeed(undefined, {
        results: results.length,
        scannedFiles,
        skippedLargeFiles,
      });
      step.succeed(undefined, {
        results: results.length,
        scannedFiles,
        skippedLargeFiles,
      });

      return reply.send({ results });
    },
  );
}
