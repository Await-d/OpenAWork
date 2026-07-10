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

type PairingRouteErrorCode =
  'invalid_pairing_token' | 'default_admin_not_found' | 'pairing_qr_forbidden';

const PAIRING_ROUTE_ERROR_MESSAGES: Record<PairingRouteErrorCode, string> = {
  invalid_pairing_token: '配对令牌无效或已过期。',
  default_admin_not_found: '默认管理员账号不存在。',
  pairing_qr_forbidden: '当前账号无权生成配对二维码。',
};

function pairingRouteErrorPayload(code: PairingRouteErrorCode): { code: string; error: string } {
  return {
    code,
    error: PAIRING_ROUTE_ERROR_MESSAGES[code],
  };
}

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
      return reply.status(401).send(pairingRouteErrorPayload('invalid_pairing_token'));
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
      return reply.status(401).send(pairingRouteErrorPayload('invalid_pairing_token'));
    }

    const user = sqliteGet<{ id: string; email: string }>(
      'SELECT id, email FROM users WHERE email = ? LIMIT 1',
      [ADMIN_EMAIL],
    );
    if (!user) {
      return reply.status(404).send(pairingRouteErrorPayload('default_admin_not_found'));
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
      return reply.status(401).send(pairingRouteErrorPayload('pairing_qr_forbidden'));
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
