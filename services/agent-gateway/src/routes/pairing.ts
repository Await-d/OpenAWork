import type { FastifyInstance } from 'fastify';
import QRCode from 'qrcode';
import { PairingManagerImpl } from '@openAwork/pairing';

export const pairingManager = new PairingManagerImpl(
  Number(globalThis.process?.env['GATEWAY_PORT'] ?? 3000),
);

export async function pairingRoutes(app: FastifyInstance): Promise<void> {
  app.post<{
    Body: { token: string; deviceName?: string; platform?: string };
  }>('/pairing/connect', async (request, reply) => {
    const { token, deviceName = 'unknown', platform = 'web' } = request.body;
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

  app.get('/pairing/qr', async (_request, reply) => {
    const session = await pairingManager.generatePairingCode();
    const dataUrl = await QRCode.toDataURL(session.qrData, { width: 256 });
    return reply.send({ dataUrl, hostUrl: session.hostUrl });
  });

  app.get('/pairing/status', async (_request, reply) => {
    const session = pairingManager.getActiveSession();
    if (!session) {
      return reply.send({ active: false });
    }
    return reply.send({
      active: true,
      hostUrl: session.hostUrl,
    });
  });
}
