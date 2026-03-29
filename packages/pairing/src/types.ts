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
