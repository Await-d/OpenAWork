import { randomBytes, createHash } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import type { PairingSession, ClientInfo, PairingManager } from './types.js';

const TOKEN_TTL_MS = 30_000;
const PAIRING_PROTOCOL_VERSION = '1';

function generateToken(): string {
  return createHash('sha256').update(randomBytes(32)).digest('hex').slice(0, 32);
}

function buildQRData(hostUrl: string, token: string): string {
  return JSON.stringify({ hostUrl, token, version: PAIRING_PROTOCOL_VERSION });
}

function detectLocalAddress(): string {
  try {
    const nets = networkInterfaces();
    for (const list of Object.values(nets)) {
      for (const iface of list ?? []) {
        if (iface.family === 'IPv4' && !iface.internal) {
          return iface.address;
        }
      }
    }
  } catch (_e) {
    void _e;
  }
  return '127.0.0.1';
}

export class PairingManagerImpl implements PairingManager {
  private port: number;
  private pendingClients = new Map<
    string,
    { resolve: (c: ClientInfo) => void; timer: ReturnType<typeof setTimeout> }
  >();
  private connectedHost: string | null = null;
  private connectionVerified = false;

  constructor(port = 3000) {
    this.port = port;
  }

  async generatePairingCode(): Promise<PairingSession> {
    const token = generateToken();
    const hostUrl = `http://${detectLocalAddress()}:${this.port}`;
    const qrData = buildQRData(hostUrl, token);
    const expiresAt = Date.now() + TOKEN_TTL_MS;

    const timer = setTimeout(() => {
      const pending = this.pendingClients.get(token);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingClients.delete(token);
      }
    }, TOKEN_TTL_MS);

    this.pendingClients.set(token, {
      resolve: () => undefined,
      timer,
    });

    return { token, qrData, hostUrl, expiresAt };
  }

  async waitForClient(token: string, timeoutMs = TOKEN_TTL_MS): Promise<ClientInfo> {
    return new Promise((resolve, reject) => {
      const existing = this.pendingClients.get(token);
      if (existing) clearTimeout(existing.timer);

      const timer = setTimeout(() => {
        this.pendingClients.delete(token);
        reject(new Error('Pairing timeout — QR code expired'));
      }, timeoutMs);

      this.pendingClients.set(token, { resolve, timer });
    });
  }

  confirmClient(token: string, client: ClientInfo): boolean {
    const pending = this.pendingClients.get(token);
    if (!pending) return false;
    clearTimeout(pending.timer);
    this.pendingClients.delete(token);
    pending.resolve(client);
    return true;
  }

  async connectWithToken(hostUrl: string, token: string): Promise<void> {
    const res = await fetch(`${hostUrl}/pairing/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, deviceName: 'Mobile Client', platform: 'web' }),
    });

    if (!res.ok) throw new Error(`Pairing connection failed: ${res.status}`);
    this.connectedHost = hostUrl;
    this.connectionVerified = true;
  }

  async verifyConnection(): Promise<boolean> {
    if (!this.connectedHost) return false;
    try {
      const res = await fetch(`${this.connectedHost}/pairing/ping`, { method: 'GET' });
      return res.ok;
    } catch {
      return false;
    }
  }

  async disconnect(): Promise<void> {
    this.connectedHost = null;
    this.connectionVerified = false;
    for (const { timer } of this.pendingClients.values()) clearTimeout(timer);
    this.pendingClients.clear();
  }

  get isConnected(): boolean {
    return this.connectionVerified;
  }
}

export type { PairingSession, ClientInfo };
