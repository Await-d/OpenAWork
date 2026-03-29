import { randomBytes } from 'crypto';

export interface PairingToken {
  value: string;
  expiresAt: number;
  used: boolean;
}

const TOKEN_TTL_MS = 5 * 60 * 1000;
const QR_BASE_URL = 'openwork://pair';

export class PairingManager {
  private storedToken: PairingToken | null = null;

  generatePairingToken(): PairingToken {
    const token: PairingToken = {
      value: randomBytes(32).toString('hex'),
      expiresAt: Date.now() + TOKEN_TTL_MS,
      used: false,
    };
    this.storedToken = token;
    return token;
  }

  generateQRCodeData(token: PairingToken): string {
    const params = new URLSearchParams({
      token: token.value,
      expires: String(token.expiresAt),
    });
    return `${QR_BASE_URL}?${params.toString()}`;
  }

  verifyToken(inputToken: string): boolean {
    if (this.storedToken === null) {
      return false;
    }
    if (this.storedToken.used) {
      return false;
    }
    if (Date.now() > this.storedToken.expiresAt) {
      return false;
    }
    if (this.storedToken.value !== inputToken) {
      return false;
    }
    this.storedToken.used = true;
    return true;
  }

  isTokenExpired(): boolean {
    if (this.storedToken === null) return true;
    return Date.now() > this.storedToken.expiresAt;
  }

  clearToken(): void {
    this.storedToken = null;
  }

  getStoredToken(): PairingToken | null {
    return this.storedToken ? { ...this.storedToken } : null;
  }
}
