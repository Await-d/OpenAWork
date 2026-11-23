import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth, type JwtPayload } from '../infra/auth.js';
import { sqliteGet } from '../infra/db.js';
import { parseBody } from '../infra/parse-request.js';
import {
  messageMaxCharsSchema,
  readMessageLimitsSnapshot,
  writeMessageMaxChars,
} from '../infra/message-limits-store.js';

const updateSchema = z.object({ maxChars: messageMaxCharsSchema }).strict();

function canEditMessageLimits(userId: string): boolean {
  const user = sqliteGet<{ email: string }>('SELECT email FROM users WHERE id = ?', [userId]);
  return user?.email === (process.env['ADMIN_EMAIL'] ?? 'admin@openAwork.local');
}

export async function registerSettingsMessageLimitsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/settings/message-limits', { onRequest: [requireAuth] }, async (request) => {
    return readMessageLimitsSnapshot(canEditMessageLimits((request.user as JwtPayload).sub));
  });

  app.put('/settings/message-limits', { onRequest: [requireAuth] }, async (request, reply) => {
    if (!canEditMessageLimits((request.user as JwtPayload).sub)) {
      return reply.status(403).send({ error: '仅管理员可以修改消息字符上限。' });
    }
    const { maxChars } = parseBody(updateSchema, request.body);
    writeMessageMaxChars(maxChars);
    return readMessageLimitsSnapshot(true);
  });
}
