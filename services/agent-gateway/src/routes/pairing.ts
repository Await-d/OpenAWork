import type { FastifyInstance } from 'fastify';
import QRCode from 'qrcode';
import { PairingManagerImpl } from '@openAwork/pairing';
import { z } from 'zod';
import { issueTokenPair } from '../auth.js';
import { sqliteGet } from '../db.js';

const pairingRequestSchema = z.object({
  token: z.string().min(1),
  deviceName: z.string().min(1).max(80).optional(),
  platform: z.enum(['ios', 'android', 'web']).optional(),
});

const ADMIN_EMAIL = globalThis.process?.env['ADMIN_EMAIL'] ?? 'admin@openAwork.local';

export const pairingManager = new PairingManagerImpl(
  Number(globalThis.process?.env['GATEWAY_PORT'] ?? 3000),
);

export async function pairingRoutes(app: FastifyInstance): Promise<void> {
  app.post<{
    Body: { token: string; deviceName?: string; platform?: string };
  }>('/pairing/connect', async (request, reply) => {
    const parsed = pairingRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid input', issues: parsed.error.issues });
    }

    const { token, deviceName = 'unknown', platform = 'web' } = parsed.data;
    if (!pairingManager.verifyToken(token)) {
      return reply.status(401).send({ error: 'Invalid pairing token' });
    }
    const session = pairingManager.getActiveSession();
    return reply.send({
      ok: true,
      hostUrl: session?.hostUrl ?? '',
      deviceName,
      platform,
    });
  });

  app.post<{
    Body: { token: string; deviceName?: string; platform?: string };
  }>('/pairing/login', async (request, reply) => {
    const parsed = pairingRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid input', issues: parsed.error.issues });
    }

    const { token, deviceName = 'unknown', platform = 'web' } = parsed.data;
    if (!pairingManager.verifyToken(token)) {
      return reply.status(401).send({ error: 'Invalid pairing token' });
    }

    const user = sqliteGet<{ id: string; email: string }>(
      'SELECT id, email FROM users WHERE email = ? LIMIT 1',
      [ADMIN_EMAIL],
    );
    if (!user) {
      return reply.status(404).send({ error: 'Default admin user not found' });
    }

    pairingManager.confirmClient(token, {
      deviceName,
      platform,
      connectedAt: Date.now(),
    });

    return reply.send(issueTokenPair(app, user));
  });

  app.get('/pairing/qr', async (_request, reply) => {
    const session = await pairingManager.generatePairingCode();
    const dataUrl = await QRCode.toDataURL(session.qrData, { width: 256 });
    return reply.send({
      dataUrl,
      expiresAt: session.expiresAt,
      hostUrl: session.hostUrl,
      qrData: session.qrData,
    });
  });

  app.get('/pairing/status', async (_request, reply) => {
    const session = pairingManager.getActiveSession();
    if (!session) {
      return reply.send({ active: false });
    }
    return reply.send({
      active: true,
      expiresAt: session.expiresAt,
      hostUrl: session.hostUrl,
    });
  });
}
