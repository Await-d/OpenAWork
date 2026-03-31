import { randomBytes, createHash } from 'node:crypto';
import { networkInterfaces } from 'node:os';

export interface PairingSession {
  token: string;
  qrData: string;
  hostUrl: string;
  expiresAt: number;
}

export interface ClientInfo {
  deviceName: string;
  platform: 'ios' | 'android' | 'web';
  connectedAt: number;
}

export interface PairingManager {
  generatePairingCode(): Promise<PairingSession>;
  waitForClient(token: string, timeoutMs?: number): Promise<ClientInfo>;
  connectWithToken(hostUrl: string, token: string): Promise<void>;
  verifyConnection(): Promise<boolean>;
  disconnect(): Promise<void>;
}

export type PairingStatus = 'idle' | 'waiting' | 'connecting' | 'connected' | 'expired' | 'failed';

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
  private activeSession: PairingSession | null = null;
  private connectedHost: string | null = null;
  private connectionVerified = false;
  private pendingClients = new Map<string, Array<(client: ClientInfo) => void>>();

  constructor(port = 3000) {
    this.port = port;
  }

  async generatePairingCode(): Promise<PairingSession> {
    if (this.activeSession) {
      return this.activeSession;
    }
    const token = generateToken();
    const hostUrl = `http://${detectLocalAddress()}:${this.port}`;
    const qrData = buildQRData(hostUrl, token);
    this.activeSession = { token, qrData, hostUrl, expiresAt: Infinity };
    return this.activeSession;
  }

  verifyToken(token: string): boolean {
    return this.activeSession?.token === token;
  }

  getActiveSession(): PairingSession | null {
    return this.activeSession ? { ...this.activeSession } : null;
  }

  async waitForClient(token: string, _timeoutMs?: number): Promise<ClientInfo> {
    return new Promise((resolve) => {
      const pending = this.pendingClients.get(token) ?? [];
      pending.push(resolve);
      this.pendingClients.set(token, pending);
    });
  }

  confirmClient(token: string, client: ClientInfo): boolean {
    if (!this.verifyToken(token)) {
      return false;
    }
    const pending = this.pendingClients.get(token) ?? [];
    for (const resolve of pending) {
      resolve(client);
    }
    this.pendingClients.delete(token);
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
    this.pendingClients.clear();
  }

  get isConnected(): boolean {
    return this.connectionVerified;
  }
}
