import type { FastifyInstance, FastifyRequest } from 'fastify';
import QRCode from 'qrcode';
import { PairingManagerImpl } from '@openAwork/pairing';
import { z } from 'zod';
import { hasValidDesktopAuthToken, issueTokenPair, type JwtPayload } from '../infra/auth.js';
import { sqliteGet } from '../infra/db.js';

const pairingRequestSchema = z.object({
  token: z.string().min(1),
  deviceName: z.string().min(1).max(80).optional(),
  platform: z.enum(['ios', 'android', 'web']).optional(),
});
import { parseBody } from '../infra/parse-request.js';

const ADMIN_EMAIL = globalThis.process?.env['ADMIN_EMAIL'] ?? 'admin@openAwork.local';

export const pairingManager = new PairingManagerImpl(
  Number(globalThis.process?.env['GATEWAY_PORT'] ?? 3000),
);

async function canGeneratePairingQr(request: FastifyRequest): Promise<boolean> {
  if (hasValidDesktopAuthToken(request)) {
    return true;
  }

  try {
    await request.jwtVerify();
    const payload = request.user as JwtPayload;
    return payload.email === ADMIN_EMAIL;
  } catch (_error) {
    return false;
  }
}

export async function pairingRoutes(app: FastifyInstance): Promise<void> {
  app.post<{
    Body: { token: string; deviceName?: string; platform?: string };
  }>('/pairing/connect', async (request, reply) => {
    const parsed = parseBody(pairingRequestSchema, request.body);

    const { token, deviceName = 'unknown', platform = 'web' } = parsed;
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
    const parsed = parseBody(pairingRequestSchema, request.body);

    const { token, deviceName = 'unknown', platform = 'web' } = parsed;
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

  app.get('/pairing/qr', async (request, reply) => {
    if (!(await canGeneratePairingQr(request))) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

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
